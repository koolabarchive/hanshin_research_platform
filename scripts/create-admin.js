// 연구윤리지원팀(관리자) 지정: 이미 가입·로그인할 수 있는 계정의 이메일을 관리자로 표시한다.
//   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json ADMIN_EMAIL=... node scripts/create-admin.js
// 관리자 여부는 Firestore의 admins/{uid} 문서로 정해진다(firestore.rules). 이 문서는 화면에서 만들 수 없고,
// 이 스크립트나 Firebase 콘솔에서만 만들 수 있다. 관리자 계정은 Firebase 콘솔 > Authentication 에서 먼저 만들어 둔다.
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

async function main() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!email) throw new Error('ADMIN_EMAIL 환경변수를 지정해 주세요.');
  initializeApp();
  const user = await getAuth().getUserByEmail(email);
  if (!user.emailVerified) await getAuth().updateUser(user.uid, { emailVerified: true });
  await getFirestore().collection('admins').doc(user.uid).set({ email, createdAt: Date.now() });
  console.log(`관리자로 지정했습니다: ${email} (${user.uid})`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
