// Firebase Functions 진입점. (직접 서버를 띄울 때는 쓰지 않는다: npm start → src/server.js)
//   app   Firebase Hosting이 /api/** 요청을 넘겨 주는 HTTP 함수
//   jobs  30분마다 도는 주기 작업(자동 리마인더, 모집 마감 등)
// 암호화 키와 발송 계정 정보는 코드나 저장소가 아니라 Secret Manager에 둔다:
//   firebase functions:secrets:set DATA_KEY
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');

const DATA_KEY = defineSecret('DATA_KEY');
const region = 'asia-northeast3'; // 서울. Firestore 데이터베이스도 같은 리전에 만든다.

// 비밀 값은 함수가 호출될 때 환경변수로 들어오므로, 서버 코드는 그때 불러온다.
exports.app = onRequest({ region, secrets: [DATA_KEY], memory: '512MiB', maxInstances: 5 }, (req, res) => require('./src/server')(req, res));

exports.jobs = onSchedule({ schedule: 'every 30 minutes', timeZone: 'Asia/Seoul', region, secrets: [DATA_KEY], memory: '512MiB' }, async () => {
  await require('./src/jobs').runJobs();
});
