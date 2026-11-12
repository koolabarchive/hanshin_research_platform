try {
  process.loadEnvFile(require('node:path').join(__dirname, '..', '.env'));
} catch {
  // .env 파일이 없으면 환경변수만 사용한다.
}

const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const helmet = require('helmet');
const { get } = require('./db');
const D = require('./domain');
const st = require('./store');
const auth = require('./auth');
const { buildState } = require('./state');
const { runAction, UPLOAD_DIR } = require('./actions');
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

const api = express.Router();
api.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store'); // 개인정보가 담긴 응답을 브라우저·프록시가 저장하지 않게 한다.
  next();
});
api.use(express.json({ limit: '8mb' })); // 이수증·승인 통지서(최대 5MB)를 base64로 받는다.
api.use(auth.sessionMiddleware);

const send = (req, res, user, extra = {}) => res.json({ ...extra, csrf: req.csrf, S: buildState(user) });

api.get('/state', (req, res) => send(req, res, req.user));

api.post('/act/:name', auth.requireCsrf, (req, res) => {
  const ctx = { req, res, user: req.user };
  try {
    const result = runAction(req.params.name, ctx, req.body);
    // 동작으로 내 정보가 바뀌었을 수 있으니 다시 읽어서 최신 화면 데이터를 돌려준다.
    send(req, res, ctx.user ? st.userById(ctx.user.id) : null, result);
  } catch (err) {
    if (!(err instanceof st.AppError)) console.error(err);
    const status = err instanceof st.AppError ? err.status : 500;
    res.status(status).json({ error: err instanceof st.AppError ? err.message : '일시적인 오류가 발생했어요. 잠시 후 다시 시도해 주세요.', csrf: req.csrf, S: buildState(req.user) });
  }
});

// 등록 화면에서 조건을 바꿀 때마다 부르는 "조건에 맞는 대기풀 인원".
// 조건을 마음대로 좁혀 가며 개인을 짚어내지 못하도록 적은 수는 정확히 알려 주지 않는다.
api.post('/pool-count', auth.requireCsrf, (req, res) => {
  if (!req.user || req.user.role !== 'researcher') return res.status(403).json({ error: '연구자만 볼 수 있어요.' });
  if (!auth.rateLimit(`pc:${req.user.id}`, 240, 3600e3)) return res.status(429).json({ error: '조회가 너무 잦아요.' });
  const draft = D.sanitizeDraft({ criteria: (req.body || {}).criteria });
  const n = st.poolMatchCount(draft);
  res.json({ text: n === 0 ? '0명' : n < D.MIN_COUNT ? `${D.MIN_COUNT}명 미만` : `${n}명` });
});

// 첨부 파일은 올린 본인과 연구지원팀만 받을 수 있다.
api.get('/file/:id', (req, res) => {
  const f = get('SELECT * FROM files WHERE id = ?', req.params.id);
  if (!req.user || !f || !(req.user.role === 'admin' || f.owner_id === req.user.id)) return res.status(404).json({ error: '파일을 찾을 수 없어요.' });
  if (req.user.role === 'admin') st.log(req.user, `첨부 파일 열람: ${f.name}`);
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(path.join(UPLOAD_DIR, path.basename(f.path))).on('error', () => res.status(404).end()).pipe(res);
});

api.use((req, res) => res.status(404).json({ error: '알 수 없는 요청이에요.' }));
// eslint-disable-next-line no-unused-vars
api.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: '파일이 너무 커요. 5MB 이하로 올려 주세요.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: '요청 형식이 올바르지 않아요.' });
  console.error(err);
  res.status(500).json({ error: '일시적인 오류가 발생했어요.' });
});
app.use('/api', api);

// 화면은 한 장짜리 앱이다. 나머지 주소는 모두 같은 문서를 돌려준다.
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

runJobs();
setInterval(() => {
  try {
    runJobs();
  } catch (err) {
    console.error('[주기 작업 실패]', err);
  }
}, 30 * 60 * 1000).unref();

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`한신 리서치풀 — http://localhost:${port}`));
}

module.exports = app;
