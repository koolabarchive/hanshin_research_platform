// 운영용 첫 관리자(연구윤리지원팀) 계정 만들기:
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run create-admin
try { process.loadEnvFile(require('node:path').join(__dirname, '..', '.env')); } catch {}
const { get, run } = require('../src/db');
const { hashPassword, encryptJSON } = require('../src/security');

const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || '';
if (!email || password.length < 12) {
  console.error('ADMIN_EMAIL 과 12자 이상의 ADMIN_PASSWORD 환경변수를 지정해 주세요.');
  process.exit(1);
}
if (get('SELECT 1 FROM users WHERE email = ?', email)) {
  console.error('이미 있는 이메일입니다.');
  process.exit(1);
}
run(`INSERT INTO users (role, email, password_hash, pii_enc, verified, joined_at) VALUES ('admin', ?, ?, ?, 1, ?)`,
  email, hashPassword(password), encryptJSON({ name: process.env.ADMIN_NAME || '연구윤리지원팀', phone: '' }), Date.now());
console.log(`관리자 계정을 만들었습니다: ${email}`);
