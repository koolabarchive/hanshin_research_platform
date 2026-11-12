// 서버를 실제로 띄워(저장소는 Firestore 에뮬레이터) 가입부터 참여까지 한 바퀴 돌리며, "누가 무엇을 볼 수 있는가"를 확인한다.
// Firestore 에뮬레이터가 필요하다: npm test 가 에뮬레이터를 띄운 뒤 이 파일을 실행한다.
process.env.NODE_ENV = 'test';
process.env.DATA_KEY = require('node:crypto').randomBytes(32).toString('base64');

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/server');
const { db, col, find, getDoc } = require('../src/db');
const { hashPassword, encryptJSON } = require('../src/security');

const one = async (query) => (await find(query))[0];

const PDF = Buffer.from('%PDF-1.4\ntest').toString('base64');
let base;
let server;

// 쿠키와 CSRF 토큰을 기억하는 간단한 클라이언트(사용자 한 명 = 인스턴스 하나)
class Client {
  constructor() { this.cookies = {}; this.csrf = ''; }
  async req(path, body) {
    const res = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf, Cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ') },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); this.cookies[kv.slice(0, i)] = kv.slice(i + 1); }
    const json = await res.json();
    if (json.csrf) this.csrf = json.csrf;
    return { status: res.status, ...json };
  }
  state() { return this.req('/api/state'); }
  act(name, body = {}) { return this.req(`/api/act/${name}`, body); }
  async signup(fields) {
    await this.state();
    const sent = await this.act('sendCode', { email: fields.email, purpose: 'signup', role: fields.role });
    const code = (sent.toast.match(/\d{6}/) || [])[0];
    return this.act('signup', { name: '테스트', phone: '010-1111-2222', pw: 'long-password-1', a1: true, a2: true, code, ...fields });
  }
}

const year = new Date().getFullYear();
const participantFields = (email, o = {}) => ({ role: 'participant', email, by: year - 25, gender: '여성', status: '학외 일반인', ...o });

test.before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, '에뮬레이터 없이 실행하면 실제 프로젝트의 데이터를 지우게 된다. npm test 로 실행할 것.');
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${db.projectId}/databases/(default)/documents`, { method: 'DELETE' });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  await col('users').doc().set({ role: 'admin', email: 'admin@hs.ac.kr', password_hash: hashPassword('admin-password-1'), pii_enc: encryptJSON({ name: '연구윤리지원팀', phone: '' }), status: 'active', synthetic: false, verified: true, joined_at: Date.now() });
});
test.after(async () => {
  server.close();
  await db.terminate();
});

test('가입부터 참여까지: 권한과 개인정보 노출 범위', async (t) => {
  const admin = new Client(); const researcher = new Client(); const alice = new Client(); const bob = new Client();
  await admin.state();
  assert.equal((await admin.act('login', { email: 'admin@hs.ac.kr', pw: 'admin-password-1' })).status, 200);

  await t.test('연구자는 학교 메일과 이수증이 있어야 가입된다', async () => {
    const c = new Client(); await c.state();
    assert.equal((await c.act('sendCode', { email: 'r@gmail.com', purpose: 'signup', role: 'researcher' })).status, 400);
    const noFile = await researcher.signup({ role: 'researcher', email: 'kim@hs.ac.kr', name: '김연구', rdept: '일반대학원 심리학과', adv: '박 교수', eth: '2026-01-10' });
    assert.equal(noFile.status, 400);
    const ok = await researcher.signup({ role: 'researcher', email: 'kim@hs.ac.kr', name: '김연구', rdept: '일반대학원 심리학과', adv: '박 교수', eth: '2026-01-10', ethFile: { name: '이수증.pdf', data: PDF } });
    assert.equal(ok.status, 200);
    assert.equal(ok.S.users[0].verified, false);
  });

  await t.test('교내 신분은 학교 메일로만, 학외 일반인은 개인 메일로 가입', async () => {
    const c = new Client();
    assert.equal((await c.signup(participantFields('x@gmail.com', { status: '학부생', dept: '경영학과' }))).status, 400);
    const a = await alice.signup(participantFields('alice@example.com', { name: '앨리스', phone: '010-9999-0001' }));
    assert.equal(a.status, 200);
    assert.equal(a.S.users[0].affiliation, 'external');
    assert.equal((await bob.signup(participantFields('bob@example.com', { name: '김밥', phone: '010-9999-0002' }))).status, 200);
    const minor = new Client();
    assert.equal((await minor.signup(participantFields('kid@example.com', { by: year - 17 }))).status, 400);
  });

  let studyId;
  await t.test('확인 전 연구자는 제출할 수 없고, 확인 후 제출 → 승인', async () => {
    const up = await researcher.act('uploadIrb', { file: { name: '승인통지서.pdf', data: PDF } });
    assert.equal(up.status, 200);
    assert.equal((await researcher.act('uploadIrb', { file: { name: 'x.pdf', data: Buffer.from('<html>').toString('base64') } })).status, 400);
    const at = Date.now() + 3 * 864e5;
    const draft = {
      title: '테스트 상담 프로그램', summary: '요약', type: 'program', minutes: 60, target: 5, location: '상담실습실', irbNo: 'IRB-1', irbFileId: up.file.id,
      explanation: { purpose: 'a', procedure: 'b', risks: 'c', benefits: 'd', privacy: 'e', withdraw: 'f', contact: 'g' }, consent: ['동의합니다.'],
      survey: [{ id: 'q1', type: 'likert', text: '문항', required: true }], slots: [{ at, cap: 1 }],
      criteria: { ageMin: 19, ageMax: 60, statuses: ['학외 일반인'], genders: [], depts: [] }, reward: { type: '모바일 상품권', amount: 10000, timing: '참여 완료 후 3일 이내' },
    };
    assert.equal((await researcher.act('submitStudy', { draft, pledge: true })).status, 400); // 아직 확인 전
    const saved = await researcher.act('saveDraft', { draft });
    studyId = saved.id;
    const rid = (await admin.state()).S.users.find((u) => u.role === 'researcher').id;
    assert.equal((await admin.act('verify', { id: rid })).status, 200);
    assert.equal((await researcher.act('submitStudy', { draft: { ...draft, id: studyId }, pledge: true })).status, 200);
    assert.equal((await researcher.act('saveDraft', { draft: { ...draft, id: studyId, title: '몰래 수정' } })).status, 400); // 심사 중 수정 불가
    assert.equal((await alice.state()).S.studies.length, 0); // 승인 전에는 참여자에게 보이지 않는다.
    const ap = await admin.act('approve', { id: studyId });
    assert.equal(ap.status, 200);
    assert.match(ap.toast, /대기풀 2명/);
  });

  await t.test('참여: 서명은 가입한 이름과 같아야 하고, 예약은 정원을 넘지 않는다', async () => {
    const s = (await alice.state()).S.studies[0];
    assert.equal(s.templates, undefined);
    await alice.act('apply', { studyId });
    assert.equal((await alice.act('consent', { studyId, checks: [true], signature: '다른이름' })).status, 400);
    assert.equal((await alice.act('consent', { studyId, checks: [false], signature: '앨리스' })).status, 400);
    assert.equal((await alice.act('consent', { studyId, checks: [true], signature: '앨리스' })).status, 200);
    assert.equal((await alice.act('finish', { studyId, slotId: s.slots[0].id, answers: {} })).status, 400); // 필수 문항 미응답
    assert.equal((await alice.act('finish', { studyId, slotId: s.slots[0].id, answers: { q1: 4 } })).status, 200);
    await bob.act('apply', { studyId });
    await bob.act('consent', { studyId, checks: [true], signature: '김밥' });
    const full = await bob.act('finish', { studyId, slotId: s.slots[0].id, answers: { q1: 2 } });
    assert.equal(full.status, 400);
    assert.match(full.error, /마감/);
    assert.equal((await getDoc('studies', studyId)).slots[0].booked, 1);
  });

  await t.test('연구자가 받는 데이터에는 이름·이메일·전체 번호·서명이 없다', async () => {
    const s = await researcher.state();
    const others = JSON.stringify({ ...s.S, users: s.S.users.slice(1) });
    for (const secret of ['앨리스', '김밥', 'alice@', 'bob@', '010-9999-0001', '010-9999-0002', 'signature', 'consentDoc']) assert.ok(!others.includes(secret), secret);
    const stub = s.S.users.find((u) => u.role === 'participant');
    assert.deepEqual(Object.keys(stub).sort(), ['id', 'phone', 'pid', 'profile', 'role']);
    assert.match(stub.phone, /^010-\*{4}-\d{4}$/);
    assert.deepEqual(Object.keys(stub.profile).sort(), ['ageBand', 'status']);
  });

  await t.test('참여자는 자기 기록만 받고, DB에는 평문 개인정보가 없다', async () => {
    const s = await bob.state();
    assert.equal(s.S.enrollments.length, 1);
    assert.equal(s.S.users.filter((u) => u.role === 'participant').length, 1);
    const row = await one(col('users').where('email', '==', 'alice@example.com'));
    assert.ok(!row.pii_enc.includes('앨리스') && !row.pii_enc.includes('010-9999') && !row.profile_enc.includes('학외'));
    const enr = await one(col('enrollments').where('user_id', '==', row.id));
    assert.ok(enr.responses_enc.startsWith('v1.') && enr.signature_enc.startsWith('v1.'));
  });

  await t.test('역할 밖의 동작과 남의 자원은 거부된다', async () => {
    assert.equal((await alice.act('approve', { id: studyId })).status, 403);
    assert.equal((await alice.act('sendInvites', { id: studyId, n: 5 })).status, 403);
    assert.equal((await researcher.act('rewardSent', { ids: ['x'] })).status, 403);
    assert.equal((await researcher.act('verify', { id: 'r-2' })).status, 403);
    const aliceEnr = (await alice.state()).S.enrollments[0];
    assert.equal((await bob.act('withdraw', { id: aliceEnr.id })).status, 404);
    const guest = new Client();
    assert.equal((await guest.act('login', { email: 'a', pw: 'b' })).status, 403); // CSRF 토큰 없이
    assert.equal((await guest.state()).S.users.length, 0);
    const other = new Client();
    await other.signup({ role: 'researcher', email: 'lee@hs.ac.kr', name: '이연구', rdept: '일반대학원', adv: '최 교수', eth: '2026-01-10', ethFile: { name: 'a.pdf', data: PDF } });
    assert.equal((await other.act('closeStudy', { id: studyId })).status, 404);
    assert.equal((await other.state()).S.enrollments.length, 0);
    const fileId = (await getDoc('studies', studyId)).irb_file_id;
    assert.equal((await researcher.req(`/api/state`)).status, 200);
    assert.equal((await other.req(`/api/file/${fileId}`)).status, 404);
    assert.equal((await alice.req(`/api/file/${fileId}`)).status, 404);
  });

  await t.test('완료 → 지급 → 상품권 발송: 전체 번호는 연구지원팀에게만, 발송 후에는 다시 가려진다', async () => {
    const enr = (await researcher.state()).S.enrollments.find((e) => e.status === 'scheduled');
    assert.equal((await researcher.act('markDone', { id: enr.id })).status, 200);
    assert.equal((await researcher.act('pay', { id: studyId, ids: [enr.id] })).status, 200);
    const q = (await admin.state()).S.rewardQueue;
    assert.equal(q.length, 1);
    assert.equal(q[0].phone, '010-9999-0001');
    assert.equal((await admin.act('rewardSent', { ids: [q[0].id] })).status, 200);
    assert.equal((await admin.state()).S.rewardQueue[0].phone, '010-****-0001');
    const inbox = (await alice.state()).S.messages.map((m) => m.kind);
    assert.ok(inbox.includes('reward') && inbox.includes('schedule') && inbox.includes('consent'));
  });

  await t.test('철회하면 응답이 폐기되고, 탈퇴하면 이름·연락처가 지워진다', async () => {
    const e = (await bob.state()).S.enrollments[0];
    assert.equal((await bob.act('withdraw', { id: e.id, choice: 'destroy' })).status, 200);
    assert.equal((await getDoc('enrollments', e.id)).responses_enc, null);
    assert.equal((await bob.act('deleteAccount')).status, 200);
    assert.equal((await find(col('users').where('email', '==', 'bob@example.com'))).length, 0);
    assert.equal((await bob.state()).S.session, null);
    const c = new Client(); await c.state();
    assert.equal((await c.act('login', { email: 'bob@example.com', pw: 'long-password-1' })).status, 400);
  });
});
