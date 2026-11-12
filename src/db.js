// 저장소는 Firestore다. 브라우저는 Firestore에 직접 접근하지 않고(firestore.rules에서 전부 차단),
// 서버가 Admin SDK로 읽고 쓴 뒤 역할에 맞는 정보만 내보낸다.
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

if (!getApps().length) {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none'; // 에뮬레이터에서는 클라우드 메타데이터 서버를 찾지 않는다.
    // 로컬 에뮬레이터: 인증 정보 없이 임의의 프로젝트 ID로 붙는다.
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'demo-hsrp' });
  } else {
    // 실제 프로젝트: Firebase/Google Cloud 실행 환경의 기본 자격 증명,
    // 또는 GOOGLE_APPLICATION_CREDENTIALS 가 가리키는 서비스 계정 키를 쓴다.
    initializeApp(process.env.FIREBASE_PROJECT_ID ? { projectId: process.env.FIREBASE_PROJECT_ID } : undefined);
  }
}

const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

// 컬렉션 이름. 문서 필드는 모두 snake_case, 시각은 ms 단위 정수(Date.now())다.
//   users        사용자. 이름·휴대전화(pii_enc)와 매칭 정보(profile_enc)는 암호문
//   studies      연구. doc(제목·설명문·동의서·설문지·조건·보상·안내 문구)와 slots(예약 시간) 포함
//   enrollments  참여 기록. 문서 ID = `${study_id}__${user_id}` (한 사람이 한 연구에 한 번만)
//   messages     알림함(플랫폼이 보낸 이메일·문자 사본)
//   send_logs    발송 기록 / inquiries 문의 / audit 처리 기록
//   files        첨부 파일(본문은 files/{id}/chunks 에 나눠 저장)
//   sessions     로그인 세션 / email_codes 인증번호 / outbox 발송 대기·이력
const col = (name) => db.collection(name);
const snapToRow = (snap) => (snap.exists ? { id: snap.id, ...snap.data() } : null);
const rows = (querySnap) => querySnap.docs.map((d) => ({ id: d.id, ...d.data() }));

async function getDoc(name, id) {
  if (!id) return null;
  return snapToRow(await col(name).doc(String(id)).get());
}
const find = async (query) => rows(await query.get());
const count = async (query) => (await query.count().get()).data().count;

module.exports = { db, col, getDoc, find, count, rows, snapToRow, FieldValue };
