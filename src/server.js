try {
  process.loadEnvFile(require('node:path').join(__dirname, '..', '.env'));
} catch {
  // .env 파일이 없으면 환경변수만 사용한다.
}

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const D = require('./domain');
const st = require('./store');
const auth = require('./auth');
const { buildState } = require('./state');
const { runAction, readFile } = require('./actions');
const { runJobs } = require('./jobs');
const { dataKey } = require('./security');

dataKey(); // 암호화 키가 없으면 요청을 받기 전에 바로 멈춘다.

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"], // 인라인 스크립트는 막는다.
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], // 화면이 style 속성을 쓴다.
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
      },
    },
    referrerPolicy: { policy: 'same-origin' },
    strictTransportSecurity: process.env.NODE_ENV === 'production',
  })
);
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '10m', index: false }));

// 비동기 처리 중 난 오류를 한곳(아래 오류 처리기)으로 모은다.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const api = express.Router();
api.use((req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store'); // 개인정보가 담긴 응답을 브라우저·CDN이 저장하지 않게 한다.
  next();
});
api.use(express.json({ limit: '8mb' })); // 이수증·승인 통지서(최대 5MB)를 base64로 받는다.
api.use(auth.sessionMiddleware);

const send = async (req, res, user, extra = {}) => res.json({ ...extra, csrf: req.csrf, S: await buildState(user) });

api.get('/state', wrap((req, res) => send(req, res, req.user)));

api.post('/act/:name', auth.requireCsrf, wrap(async (req, res) => {
  const ctx = { req, res, user: req.user };
  try {
    const result = await runAction(req.params.name, ctx, req.body);
    // 동작으로 내 정보가 바뀌었을 수 있으니 다시 읽어서 최신 화면 데이터를 돌려준다.
    await send(req, res, ctx.user ? await st.userById(ctx.user.id) : null, result);
  } catch (err) {
    if (!(err instanceof st.AppError)) throw err;
    res.status(err.status).json({ error: err.message, csrf: req.csrf, S: await buildState(req.user) });
  }
}));

// 등록 화면에서 조건을 바꿀 때마다 부르는 "조건에 맞는 대기풀 인원".
// 조건을 마음대로 좁혀 가며 개인을 짚어내지 못하도록 적은 수는 정확히 알려 주지 않는다.
api.post('/pool-count', auth.requireCsrf, wrap(async (req, res) => {
  if (!req.user || req.user.role !== 'researcher') return res.status(403).json({ error: '연구자만 볼 수 있어요.' });
  if (!auth.rateLimit(`pc:${req.user.id}`, 240, 3600e3)) return res.status(429).json({ error: '조회가 너무 잦아요.' });
  const n = await st.poolMatchCount(D.sanitizeDraft({ criteria: (req.body || {}).criteria }));
  res.json({ text: n === 0 ? '0명' : n < D.MIN_COUNT ? `${D.MIN_COUNT}명 미만` : `${n}명` });
}));

// 첨부 파일은 올린 본인과 연구지원팀만 받을 수 있다.
api.get('/file/:id', wrap(async (req, res) => {
  const f = req.user ? await readFile(req.params.id) : null;
  if (!f || !(req.user.role === 'admin' || f.owner_id === req.user.id)) return res.status(404).json({ error: '파일을 찾을 수 없어요.' });
  if (req.user.role === 'admin') {
    const w = st.writer();
    st.log(w, req.user, `첨부 파일 열람: ${f.name}`);
    await w.close();
  }
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(f.data);
}));

api.use((req, res) => res.status(404).json({ error: '알 수 없는 요청이에요.' }));
// eslint-disable-next-line no-unused-vars
api.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: '파일이 너무 커요. 5MB 이하로 올려 주세요.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: '요청 형식이 올바르지 않아요.' });
  console.error(err);
  res.status(500).json({ error: '일시적인 오류가 발생했어요. 잠시 후 다시 시도해 주세요.' });
});
app.use('/api', api);

// 화면은 한 장짜리 앱이다. 나머지 주소는 모두 같은 문서를 돌려준다.
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// 직접 실행(npm start)할 때만 포트를 열고 주기 작업을 돌린다.
// Firebase Functions에서는 index.js가 이 앱과 runJobs를 각각 함수로 내보낸다.
if (require.main === module) {
  const tick = () => runJobs().catch((err) => console.error('[주기 작업 실패]', err));
  tick();
  setInterval(tick, 30 * 60 * 1000).unref();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`한신 리서치풀 — http://localhost:${port}`));
}

module.exports = app;
