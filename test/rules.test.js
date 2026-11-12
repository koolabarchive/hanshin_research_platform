// 보안 규칙 테스트. 브라우저용 SDK로 각 역할로 로그인해, 허용되어야 할 일과 막혀야 할 일을 직접 시도한다.
// npm test 가 Auth·Firestore 에뮬레이터를 띄운 뒤 이 파일을 실행한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp: adminInit } = require('firebase-admin/app');
const { getFirestore: adminDb } = require('firebase-admin/firestore');
const { getAuth: adminAuth } = require('firebase-admin/auth');
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, setDoc, updateDoc, collection, query, where, writeBatch, terminate, setLogLevel } = require('firebase/firestore');
setLogLevel('silent'); // 막혀야 할 요청이 막힐 때마다 SDK가 찍는 경고를 끈다.

const PROJECT = 'demo-hsrp';
const FS = process.env.FIRESTORE_EMULATOR_HOST;
const AU = process.env.FIREBASE_AUTH_EMULATOR_HOST;
process.env.METADATA_SERVER_DETECTION = 'none';
const PW = 'test-password-1';
const year = new Date().getFullYear();
let admin;
const apps = [];

// 한 사람 = 앱 인스턴스 하나. 그 사람으로 로그인한 Firestore 핸들을 돌려준다.
async function as(email) {
  const app = initializeApp({ apiKey: 'demo', projectId: PROJECT }, `u-${apps.length}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AU}`, { disableWarnings: true });
  const [host, port] = FS.split(':');
  const db = getFirestore(app);
  connectFirestoreEmulator(db, host, Number(port));
  if (email) await signInWithEmailAndPassword(auth, email, PW);
  return db;
}
const allowed = (p, msg) => assert.doesNotReject(p, msg);
const denied = async (p, msg) => assert.equal(await p.then(() => 'allowed', (e) => e.code), 'permission-denied', msg);

const pool = (pid, o = {}) => ({ pid, birthYear: year - 25, gender: '여성', status: '학외 일반인', dept: '학외', year: '해당 없음', interests: [], times: [], sms: true, joined: true, paused: false, since: 1, wantJoin: true, phoneTail: '1234', ...o });
const study = (ownerUid, o = {}) => ({
  ownerUid, owner: { name: '김연구', program: '석사과정', dept: '심리학과' }, status: 'recruiting', title: '연구', summary: '요약', type: 'program', minutes: 60, target: 5, doneCount: 0, slotCount: 1,
  start: '2026-01-01', end: '2099-01-01', irbUntil: '2099-01-01', irbNo: 'IRB-1', explanation: {}, consent: ['동의'], survey: [], notices: [], templates: { remind3: true },
  criteria: { ageMin: 19, ageMax: 60, statuses: ['학외 일반인'], genders: [], depts: [] }, reward: { type: '모바일 상품권', amount: 1000 }, location: '상담실', ...o,
});
const enr = (sid, uid, pid, ownerUid, o = {}) => ({ studyId: sid, uid, pid, ownerUid, status: 'invited', source: 'self', invitedAt: 1, pstatus: '학외 일반인', ageBand: '20대 중반', phoneTail: '1234', ...o });

test.before(async () => {
  assert.ok(FS && AU, 'npm test 로 실행해야 한다(에뮬레이터 필요).');
  await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://${AU}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  adminInit({ projectId: PROJECT });
  admin = adminDb();
  const mk = (uid, email, emailVerified = true) => adminAuth().createUser({ uid, email, password: PW, emailVerified });
  await Promise.all([mk('R', 'r@hs.ac.kr'), mk('R2', 'r2@hs.ac.kr'), mk('A', 'a@hs.ac.kr'), mk('P', 'p@example.com'), mk('P2', 'p2@example.com'), mk('NEW', 'new@example.com', false), mk('STU', 'stu@hs.ac.kr')]);
  const b = admin.batch();
  const set = (path, data) => b.set(admin.doc(path), data);
  set('admins/A', { createdAt: 1 });
  for (const r of ['R', 'R2']) set(`users/${r}`, { role: 'researcher', name: '김연구', program: '석사과정', dept: '심리학과', advisor: '박', verified: r === 'R', createdAt: 1 });
  for (const [u, pid] of [['P', 'P-1111'], ['P2', 'P-2222']]) {
    set(`users/${u}`, { role: 'participant', pid, affiliation: 'external', createdAt: 1 });
    set(`pids/${pid}`, { uid: u });
    set(`users/${u}/private/contact`, { name: u === 'P' ? '박참여' : '이참여', phone: '010-1111-1234', email: `${u.toLowerCase()}@example.com` });
    set(`pool/${u}`, pool(pid));
  }
  set('studies/S1', study('R'));
  set('studies/S1/slots/a', { at: Date.now() + 864e5, cap: 1, booked: 0 });
  set('studies/S2', study('R2', { criteria: { ageMin: 40, ageMax: 60, statuses: ['학부생'], genders: [], depts: [] } }));
  set('studies/DRAFT', study('R', { status: 'draft' }));
  set('studies/REVIEW', study('R', { status: 'review' }));
  set('enrollments/S2__P', enr('S2', 'P', 'P-1111', 'R2', { status: 'completed', completedAt: 2, responses: { q1: 3 } }));
  set('enrollments/S2__P/private/consent', { signature: '박참여', items: ['동의'], title: '연구', irbNo: 'IRB-1', at: 1 });
  set('messages/m1', { toUid: 'P', studyId: 'S1', kind: 'invite', channel: 'email', subject: 's', body: 'b', at: 1, read: false });
  set('stats/landing', { participants: 2 });
  await b.commit();
});
test.after(async () => {
  for (const app of apps) { await terminate(getFirestore(app)); await deleteApp(app); }
});

test('로그인하지 않으면 통계 문서만 읽을 수 있다', async () => {
  const db = await as(null);
  await allowed(getDoc(doc(db, 'stats/landing')));
  await denied(getDocs(collection(db, 'studies')));
  await denied(getDoc(doc(db, 'pool/P')));
});

test('연구자: 대기풀·연락처·서명·남의 연구는 읽을 수 없다', async () => {
  const db = await as('r@hs.ac.kr');
  await allowed(getDocs(query(collection(db, 'studies'), where('ownerUid', '==', 'R'))));
  await denied(getDocs(collection(db, 'pool')), '대기풀 목록');
  await denied(getDoc(doc(db, 'pool/P')), '대기풀 한 건');
  await denied(getDoc(doc(db, 'users/P')), '참여자 계정 문서');
  await denied(getDoc(doc(db, 'users/P/private/contact')), '이름·연락처');
  await denied(getDocs(query(collection(db, 'enrollments'), where('studyId', '==', 'S2'))), '남의 연구 참여 기록');
  await denied(getDoc(doc(db, 'enrollments/S2__P/private/consent')), '서명');
  await denied(getDocs(query(collection(db, 'messages'), where('toUid', '==', 'P'))), '남의 알림함');
});

test('연구자: 스스로 승인하거나 집계·확인 표시를 바꿀 수 없다', async () => {
  const db = await as('r@hs.ac.kr');
  await denied(updateDoc(doc(db, 'studies/DRAFT'), { status: 'recruiting' }), '직접 공개');
  await denied(updateDoc(doc(db, 'studies/REVIEW'), { title: '몰래 수정' }), '심사 중 수정');
  await denied(updateDoc(doc(db, 'studies/S1'), { doneCount: 99 }), '완료 인원 조작');
  await denied(updateDoc(doc(db, 'studies/S1'), { title: '공개 후 제목 변경' }), '공개 후 내용 변경');
  await allowed(updateDoc(doc(db, 'studies/S1'), { 'templates.remind3': false, updatedAt: 2 }), '리마인더 설정');
  await denied(setDoc(doc(db, 'messages/x'), { toUid: 'P', body: 'spam', at: 1, read: false }), '알림함에 직접 쓰기');
  await denied(setDoc(doc(db, 'admins/R'), { x: 1 }), '관리자 지정');
  const r2 = await as('r2@hs.ac.kr');
  await denied(updateDoc(doc(r2, 'users/R2'), { verified: true }), '스스로 연구자 확인');
  await denied(updateDoc(doc(r2, 'studies/DRAFT'), { status: 'closed' }), '남의 연구 변경');
  await denied(setDoc(doc(r2, 'studies/NEW'), study('R2', { status: 'recruiting' })), '공개 상태로 생성');
});

test('참여자: 조건에 맞는 모집 중 연구에만 신청할 수 있고, 남의 정보는 읽을 수 없다', async () => {
  const db = await as('p@example.com');
  await allowed(getDocs(query(collection(db, 'studies'), where('status', '==', 'recruiting'))));
  await denied(getDoc(doc(db, 'pool/P2')), '남의 매칭 정보');
  await denied(getDoc(doc(db, 'users/P2/private/contact')), '남의 연락처');
  await denied(getDocs(query(collection(db, 'enrollments'), where('studyId', '==', 'S1'))), '남의 참여 기록');
  await denied(getDoc(doc(db, 'studies/DRAFT')), '공개 전 연구');
  await denied(updateDoc(doc(db, 'pool/P'), { status: '교직원' }), '신분 변경');
  await denied(updateDoc(doc(db, 'pool/P'), { birthYear: year - 10 }), '출생연도 변경');
  await allowed(updateDoc(doc(db, 'pool/P'), { paused: true }), '안내 일시정지');
  await allowed(setDoc(doc(db, 'enrollments/S1__P'), enr('S1', 'P', 'P-1111', 'R')), '조건에 맞는 연구 신청');
  const p2 = await as('p2@example.com');
  await denied(setDoc(doc(p2, 'enrollments/S2__P2'), enr('S2', 'P2', 'P-2222', 'R2')), '조건(나이·신분)에 안 맞는 연구');
  await denied(setDoc(doc(p2, 'enrollments/S1__P2'), enr('S1', 'P2', 'P-1111', 'R')), '남의 가명 ID로 신청');
  await denied(setDoc(doc(p2, 'enrollments/DRAFT__P2'), enr('DRAFT', 'P2', 'P-2222', 'R')), '모집 전 연구에 신청');
});

test('참여자: 동의에는 서명이 필요하고, 예약은 정원을 넘지 못한다', async () => {
  const db = await as('p@example.com');
  const e = doc(db, 'enrollments/S1__P');
  await denied(updateDoc(e, { status: 'consented', consentAt: 5, consentVersion: 'v' }), '서명 없는 동의');
  await denied(updateDoc(e, { status: 'paid' }), '상태 건너뛰기');
  let b = writeBatch(db);
  b.update(e, { status: 'consented', consentAt: 5, consentVersion: 'v' });
  b.set(doc(db, 'enrollments/S1__P/private/consent'), { signature: '다른이름', items: ['동의'], title: '연구', irbNo: 'IRB-1', at: 5 });
  await denied(b.commit(), '가입한 이름과 다른 서명');
  b = writeBatch(db);
  b.update(e, { status: 'consented', consentAt: 5, consentVersion: 'v' });
  b.set(doc(db, 'enrollments/S1__P/private/consent'), { signature: '박참여', items: ['동의'], title: '연구', irbNo: 'IRB-1', at: 5 });
  await allowed(b.commit(), '서명과 함께 동의');
  await denied(updateDoc(doc(db, 'studies/S1/slots/a'), { booked: 1 }), '참여 기록 변경 없이 예약 수만 증가');
  await denied(updateDoc(e, { status: 'scheduled', slotId: 'a' }), '예약 수 증가 없이 일정 확정');
  b = writeBatch(db);
  b.update(doc(db, 'studies/S1/slots/a'), { booked: 1 });
  b.update(e, { status: 'scheduled', slotId: 'a' });
  await allowed(b.commit(), '예약');
  // 두 번째 사람은 정원(1명)이 차서 예약할 수 없다.
  await admin.doc('enrollments/S1__P2').set(enr('S1', 'P2', 'P-2222', 'R', { status: 'consented', consentAt: 5 }));
  const p2 = await as('p2@example.com');
  b = writeBatch(p2);
  b.update(doc(p2, 'studies/S1/slots/a'), { booked: 2 });
  b.update(doc(p2, 'enrollments/S1__P2'), { status: 'scheduled', slotId: 'a' });
  await denied(b.commit(), '정원 초과 예약');
  // 철회하면 자리가 돌아와야 한다.
  await denied(updateDoc(e, { status: 'withdrawn', withdrawnAt: 9, dataChoice: '폐기' }), '자리 반환 없는 철회');
  b = writeBatch(db);
  b.update(doc(db, 'studies/S1/slots/a'), { booked: 0 });
  b.update(e, { status: 'withdrawn', withdrawnAt: 9, dataChoice: '폐기' });
  await allowed(b.commit(), '철회와 자리 반환');
});

test('보상: 연구자가 지급 처리하면 발송 요청이 생기고, 번호는 관리자만 본다', async () => {
  const r2 = await as('r2@hs.ac.kr');
  await denied(updateDoc(doc(r2, 'enrollments/S2__P'), { status: 'paid', paidAt: 3, rewardQueue: 'pending' }), '발송 요청 없는 상품권 지급');
  const b = writeBatch(r2);
  b.update(doc(r2, 'enrollments/S2__P'), { status: 'paid', paidAt: 3, rewardQueue: 'pending' });
  b.set(doc(r2, 'rewards/S2__P'), { uid: 'P', pid: 'P-1111', studyId: 'S2', ownerUid: 'R2', study: '연구', amount: 1000, paidAt: 3, sentAt: null });
  await allowed(b.commit(), '지급 처리 + 발송 요청');
  await denied(updateDoc(doc(r2, 'rewards/S2__P'), { sentAt: 4 }), '연구자가 발송 완료 표시');
  const a = await as('a@hs.ac.kr');
  await allowed(getDoc(doc(a, 'users/P/private/contact')), '관리자의 연락처 열람');
  await allowed(updateDoc(doc(a, 'rewards/S2__P'), { sentAt: 4 }), '관리자의 발송 완료 표시');
  await denied(getDocs(query(collection(a, 'enrollments'), where('studyId', '==', 'S2'))), '관리자의 설문 응답 열람');
  await denied(getDocs(collection(a, 'pool')), '관리자의 대기풀 열람');
});

test('관리자: 심사 중인 연구만 승인·보완 요청하고, 연구자 확인을 한다', async () => {
  const a = await as('a@hs.ac.kr');
  await allowed(updateDoc(doc(a, 'users/R2'), { verified: true }), '연구자 확인');
  await denied(updateDoc(doc(a, 'studies/DRAFT'), { status: 'recruiting' }), '제출하지 않은 연구 승인');
  await denied(updateDoc(doc(a, 'studies/REVIEW'), { status: 'recruiting', title: '바꿔치기' }), '승인하며 내용 변경');
  await allowed(updateDoc(doc(a, 'studies/REVIEW'), { status: 'recruiting', approvedAt: 5, updatedAt: 5, notifyPool: true }), '승인');
});

test('가입: 이메일 인증 전에는 대기풀 안내 대상이 될 수 없고, 교내 신분은 학교 메일이 필요하다', async () => {
  const db = await as('new@example.com');
  const mkBatch = (o) => { const b = writeBatch(db); b.set(doc(db, 'pids/P-3333'), { uid: 'NEW' }); b.set(doc(db, 'users/NEW'), { role: 'participant', pid: 'P-3333', affiliation: 'external', createdAt: 1 }); b.set(doc(db, 'users/NEW/private/contact'), { name: '새사람', phone: '010-2222-3333', email: 'new@example.com' }); b.set(doc(db, 'pool/NEW'), pool('P-3333', { joined: false, phoneTail: '3333', ...o })); return b; };
  await denied(mkBatch({ joined: true }).commit(), '인증 전 대기풀 등록');
  await denied(mkBatch({ status: '학부생', dept: '경영학과' }).commit(), '개인 메일로 교내 신분');
  await denied(mkBatch({ birthYear: year - 17 }).commit(), '만 19세 미만');
  await allowed(mkBatch({}).commit(), '가입(안내는 인증 후)');
  await denied(getDocs(query(collection(db, 'studies'), where('status', '==', 'recruiting'))), '인증 전 연구 목록');
  await denied(setDoc(doc(db, 'users/NEW'), { role: 'researcher', name: '새사람', program: '석사과정', dept: 'x', advisor: 'y', verified: true, createdAt: 1 }), '역할 바꾸기');
  await denied(setDoc(doc(db, 'pids/P-1111'), { uid: 'NEW' }), '남의 가명 ID 가로채기');
  const stu = await as('stu@hs.ac.kr');
  await denied(setDoc(doc(stu, 'users/STU'), { role: 'researcher', name: '학생', program: '석사과정', dept: 'x', advisor: 'y', verified: true, createdAt: 1 }), '확인된 연구자로 가입');
  await allowed(setDoc(doc(stu, 'users/STU'), { role: 'researcher', name: '학생', program: '석사과정', dept: 'x', advisor: 'y', verified: false, createdAt: 1 }), '연구자 가입(확인 대기)');
});
