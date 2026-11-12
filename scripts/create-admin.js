// 첫 관리자(연구윤리지원팀) 계정 만들기:
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run create-admin
// 실제 프로젝트에 만들려면 GOOGLE_APPLICATION_CREDENTIALS(서비스 계정 키)와 DATA_KEY 가 설정되어 있어야 한다.
try { process.loadEnvFile(require('node:path').join(__dirname, '..', '.env')); } catch {}
const { col, find } = require('../src/db');
const { hashPassword, encryptJSON } = require('../src/security');

async function main() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || password.length < 12) throw new Error('ADMIN_EMAIL 과 12자 이상의 ADMIN_PASSWORD 환경변수를 지정해 주세요.');
  if ((await find(col('users').where('email', '==', email).limit(1))).length) throw new Error('이미 있는 이메일입니다.');
  await col('users').doc().set({
    role: 'admin', email, password_hash: hashPassword(password), pii_enc: encryptJSON({ name: process.env.ADMIN_NAME || '연구윤리지원팀', phone: '' }),
    status: 'active', synthetic: false, verified: true, joined_at: Date.now(),
  });
  console.log(`관리자 계정을 만들었습니다: ${email}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
