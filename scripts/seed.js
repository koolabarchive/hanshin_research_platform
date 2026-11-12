// 시연용 데이터: 가상의 참여자 341명, 연구자 3명, 연구 5건과 참여·발송 기록.
// Firebase 에뮬레이터(Auth + Firestore)에만 넣는다. 가상 계정에는 실제 메일·문자가 나가지 않는다.
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const D = require('../functions/domain');

const FS = process.env.FIRESTORE_EMULATOR_HOST;
const AU = process.env.FIREBASE_AUTH_EMULATOR_HOST;
// 가상 계정 수백 개를 실제 프로젝트에 넣는 실수를 막는다.
if (!FS || !AU) {
  console.error('시연용 데이터는 에뮬레이터에만 넣습니다. npm run emulators 를 띄운 뒤 다른 터미널에서 npm run seed 를 실행하세요.');
  process.exit(1);
}
process.env.METADATA_SERVER_DETECTION = 'none';
const PROJECT = 'demo-hsrp';
initializeApp({ projectId: PROJECT });
const db = getFirestore();
const col = (name) => db.collection(name);
const randomId = (prefix) => `${prefix}-${require('node:crypto').randomBytes(6).toString('base64url')}`;

const PASSWORD = 'demo-password-1234';
const r = D.mulberry32(1109);
const now = Date.now();
const DAY = D.DAY;
const pick = (a) => a[Math.floor(r() * a.length)];
const ymd = (o) => D.toYMD(now + o * DAY);

// 문서를 메모리에 모았다가 마지막에 한꺼번에 쓴다. [컬렉션, 문서 ID, 내용]
const writes = [];
const put = (name, id, data) => {
  writes.push([name, id, data]);
  return id;
};
// 로그인할 수 있는 시연 계정(Auth 에뮬레이터에 만든다).
const logins = [];
const login = (email, name) => {
  const uid = `demo-login-${logins.length + 1}`; // 실제 Firebase의 사용자 ID처럼 신원이 드러나지 않는 값
  logins.push({ uid, email, password: PASSWORD, emailVerified: true, displayName: name });
  return uid;
};
// 이름·연락처. synthetic 표시가 있으면 Functions가 실제 메일·문자를 보내지 않는다.
const contact = (uid, name, phone, email) => put(`users/${uid}/private`, 'contact', { name, phone, email, synthetic: true });
const owners = new Map();

async function main() {
  if (process.argv.includes('--reset')) {
    await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
    await fetch(`http://${AU}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  }
  if ((await col('users').limit(1).get()).size) {
    console.error('이미 데이터가 있습니다. npm run seed -- --reset 으로 비우고 다시 넣을 수 있습니다.');
    process.exit(1);
  }

  const adminId = login('research-ethics@hs.ac.kr', '연구윤리지원팀');
  put('admins', adminId, { createdAt: now });
  contact(adminId, '연구윤리지원팀', '', 'research-ethics@hs.ac.kr');
  const researcher = (email, name, phone, program, dept, advisor, ethOffset, file, verified, joined) => {
    const id = login(email, name);
    put('users', id, { seeded: true, role: 'researcher', name, program, dept, advisor, ethicsDate: ymd(ethOffset), ethicsFile: '', ethicsFileId: '', verified: !!verified, createdAt: now - joined * DAY });
    contact(id, name, phone, email);
    owners.set(id, { name, program, dept });
    return id;
  };
  const r1 = researcher('seoyun.kim@hs.ac.kr', '김서윤', '010-0000-3307', '박사과정', '일반대학원 심리학과 (임상및상담심리)', '박지훈 교수', -240, null, 1, 210);
  const r2 = researcher('minjae.jung@hs.ac.kr', '정민재', '010-0000-0458', '석사과정', '일반대학원 사회복지학과', '이수연 교수', -120, null, 1, 150);
  researcher('serin.oh@hs.ac.kr', '오세린', '010-0000-6621', '석사과정', '일반대학원 교육학과', '최윤호 교수', -9, null, 0, 1);

  const people = []; // {id, profile}
  const addParticipant = (email, name, phone, pid, profile, sms, paused, since) => {
    const id = email === 'haeun.lee@hs.ac.kr' ? login(email, name) : `demo-p-${pid.slice(2)}`;
    const tail = phone.replace(/\D/g, '').slice(-4);
    put('users', id, { seeded: true, role: 'participant', pid, affiliation: profile.status === D.EXTERNAL_STATUS ? 'external' : 'campus', createdAt: since });
    put('pids', pid, { uid: id });
    contact(id, name, phone, email);
    put('pool', id, { pid, ...profile, sms: !!sms, joined: true, paused: !!paused, since, wantJoin: true, phoneTail: tail });
    people.push({ id, pid, profile, tail, paused: !!paused });
    return id;
  };
  const me = addParticipant('haeun.lee@hs.ac.kr', '이하은', '010-0000-1284', 'P-1000',
    { birthYear: D.ageOf({ birthYear: 0 }, now) - 22, gender: '여성', status: '학부생', dept: '심리아동학부', year: '3학년', interests: ['심리·정서', '학습·교육'], times: ['평일 오후', '주말'] }, true, false, now - 120 * DAY);
  const thisYear = D.ageOf({ birthYear: 0 }, now);
  for (let i = 1; i <= 340; i++) {
    const x = r();
    const status = x < 0.7 ? '학부생' : x < 0.85 ? '대학원생' : x < 0.9 ? '교직원' : D.EXTERNAL_STATUS;
    const age = status === '학부생' ? 19 + Math.floor(r() * 7) : status === '대학원생' ? 24 + Math.floor(r() * 16) : status === '교직원' ? 30 + Math.floor(r() * 28) : 20 + Math.floor(r() * 35);
    const ints = D.INTERESTS.filter(() => r() < 0.33);
    if (!ints.length) ints.push(pick(D.INTERESTS));
    const tms = D.TIMES.filter(() => r() < 0.45);
    if (!tms.length) tms.push(pick(D.TIMES));
    const since = now - Math.floor(r() * 420) * DAY;
    const campus = status !== D.EXTERNAL_STATUS;
    addParticipant(campus ? `demo${1000 + i}@hs.ac.kr` : `demo${1000 + i}@example.com`, `가상참여자${i}`, `010-0000-${1000 + Math.floor(r() * 9000)}`, `P-${1000 + i}`, {
      birthYear: thisYear - age, gender: r() < 0.58 ? '여성' : '남성', status,
      dept: status === '대학원생' ? '일반대학원' : status === '교직원' ? '교직원' : campus ? pick(D.DEPTS_UG) : '학외',
      year: status === '학부생' ? pick(['1학년', '2학년', '3학년', '4학년']) : '해당 없음', interests: ints, times: tms,
    }, r() < 0.82, r() < 0.07, since);
  }

  const expl = (o) => ({
    purpose: o.purpose, procedure: o.procedure,
    risks: '일부 문항은 개인적인 경험을 떠올리게 하여 일시적으로 불편할 수 있습니다. 불편하면 언제든 응답을 멈출 수 있으며, 원하시면 한신대학교 학생상담센터 이용 방법을 안내해 드립니다.',
    benefits: '직접적인 이익은 없지만, 연구 결과는 대학생을 위한 지원 프로그램을 만드는 데 쓰입니다. 참여에 대한 감사의 뜻으로 보상을 드립니다.',
    privacy: '응답은 가명 ID로만 관리되며 연구 목적 외에는 사용하지 않습니다. 연구자는 참여자의 이름과 연락처를 볼 수 없습니다. 자료는 관련 법령에 따라 연구 종료 후 3년간 암호화하여 보관한 뒤 폐기합니다.',
    withdraw: '참여는 자발적입니다. 언제든 불이익 없이 철회할 수 있으며, 철회할 때 이미 수집된 자료를 폐기할지 직접 선택할 수 있습니다.',
    contact: o.contact,
  });
  const q = (id, type, text, options = [], required = true, sample) => ({ id, type, text, options, required, sample });
  const studies = [];
  const addStudy = (id, owner, status, o, slots = [], meta = {}) => {
    const samples = Object.fromEntries((o.survey || []).filter((x) => x.sample).map((x) => [x.id, x.sample]));
    const doc = {
      explanation: null, consent: D.defaultConsent(), consentCopy: true, survey: [], notices: [], templates: D.defaultTemplates(), location: '',
      criteria: { ageMin: 19, ageMax: 39, statuses: ['학부생'], genders: [], depts: [], exclude: '' }, reward: { type: '모바일 상품권', amount: 5000, timing: '참여 완료 후 3일 이내' }, ...o,
    };
    doc.survey = doc.survey.map(({ sample, ...rest }) => rest);
    const slotRows = slots.map((x) => ({ id: randomId('slot'), ...x, booked: 0 }));
    const row = {
      ...doc, ownerUid: owner, owner: owners.get(owner), status, slotCount: slotRows.length, doneCount: 0, irbFile: '', irbFileId: '',
      createdAt: now - 30 * DAY, updatedAt: now - 2 * DAY, ...(meta.submittedAt ? { submittedAt: meta.submittedAt } : {}), ...(meta.approvedAt ? { approvedAt: meta.approvedAt } : {}),
    };
    put('studies', id, row);
    const st = { id, ...doc, ownerUid: owner, slotRows, samples, row };
    studies.push(st);
    return st;
  };

  const s1 = addStudy('s-demo1', r1, 'recruiting', {
    title: '대학생의 주의집중 어려움과 학업 지연행동', summary: '수업과 과제 상황에서 주의가 흩어지는 경험과 미루기 습관을 묻는 20분 온라인 설문입니다.', type: 'survey', minutes: 20, target: 120,
    start: ymd(-24), end: ymd(29), irbNo: 'HS-IRB-DEMO-1043', irbUntil: ymd(300), advisor: '박지훈 교수', tint: 'sky',
    criteria: { ageMin: 19, ageMax: 35, statuses: ['학부생', '대학원생'], genders: [], depts: [], exclude: '현재 주의력 문제로 약물 치료를 받고 있는 경우' },
    explanation: expl({ purpose: '대학생이 수업과 과제 상황에서 겪는 주의집중의 어려움이 학업 지연행동과 어떤 관련이 있는지 알아보려는 연구입니다.', procedure: '온라인 설문 1회, 약 20분이 걸립니다. 학년, 주의집중 경험, 미루기 습관에 관한 문항에 답합니다. 정답이나 오답은 없습니다.', contact: '연구책임자 김서윤 (일반대학원 심리학과 박사과정)\n연구 관련 문의는 연구 화면의 \'연구자에게 문의하기\'로 보내 주세요.' }),
    survey: [
      q('q1', 'single', '현재 학년(과정)을 선택해 주세요.', ['1학년', '2학년', '3학년', '4학년', '대학원']),
      q('q2', 'likert', '과제를 마감 직전까지 미루는 편이다.'), q('q3', 'likert', '수업 중 다른 생각으로 주의가 자주 흩어진다.'),
      q('q4', 'likert', '해야 할 일을 시작하기까지 오래 걸린다.'), q('q5', 'likert', '계획한 공부 시간을 지키기 어렵다.'),
      q('q6', 'multi', '미루기를 줄이려고 써 본 방법을 모두 골라 주세요.', ['타이머(뽀모도로)', '스터디 그룹', '할 일 목록 앱', '휴대전화 잠금', '써 본 적 없음']),
      q('q7', 'long', '학업을 미루게 되는 상황을 자유롭게 적어 주세요.', [], false, ['시험 기간에 과제가 한꺼번에 몰릴 때', '아르바이트를 마치고 지쳐 있을 때', '휴대전화를 보다가 시간이 훌쩍 지나갈 때', '완벽하게 하고 싶어서 시작을 미룰 때', '과제 양이 많아 어디서부터 할지 막막할 때']),
    ],
    notices: [{ id: 'n-demo1', at: now - 3 * DAY, title: '설문 서버 점검 안내', body: '이번 주 새벽 2시부터 4시까지 설문 저장이 잠시 중단됩니다. 이 시간에는 응답을 미뤄 주세요.' }],
  }, [], { approvedAt: now - 25 * DAY });

  const slots2 = [];
  for (let d = 1; d <= 10; d++) {
    const dayStart = new Date(`${D.toYMD(now + d * DAY)}T00:00:00+09:00`).getTime();
    if ([0, 6].includes(new Date(dayStart + 9 * 3600e3).getUTCDay())) continue;
    for (const h of [10, 14]) slots2.push({ at: dayStart + h * 3600e3, cap: 3 });
  }
  const s2 = addStudy('s-demo2', r1, 'recruiting', {
    title: '짧은 마음챙김 호흡이 시험불안에 미치는 효과', summary: '실험실에서 10분 호흡 연습을 하고 간단한 과제를 수행합니다. 사전 설문 포함 약 50분.', type: 'lab', minutes: 50, target: 40,
    start: ymd(-12), end: ymd(18), irbNo: 'HS-IRB-DEMO-1078', irbUntil: ymd(200), advisor: '박지훈 교수', tint: 'mint',
    location: '한신대 오산캠퍼스 장공관 3층 심리실험실', reward: { type: '현금', amount: 20000, timing: '실험 참여 당일 지급' },
    criteria: { ageMin: 19, ageMax: 30, statuses: ['학부생'], genders: [], depts: [], exclude: '최근 6개월 안에 명상 프로그램에 참여한 경우' },
    explanation: expl({ purpose: '10분 정도의 짧은 마음챙김 호흡 연습이 시험을 앞둔 대학생의 불안을 낮추는지 확인하려는 실험 연구입니다.', procedure: '1) 플랫폼에서 사전 설문(약 5분)에 답합니다.\n2) 예약한 시간에 실험실을 방문해 10분 호흡 연습 또는 휴식을 합니다(무작위 배정).\n3) 짧은 계산 과제와 불안 설문을 마치면 끝납니다. 총 약 50분이 걸립니다.', contact: '연구책임자 김서윤 (일반대학원 심리학과 박사과정)\n실험실 위치: 장공관 3층' }),
    survey: [q('q1', 'likert', '시험 전날에는 잠들기 어렵다.'), q('q2', 'likert', '시험지를 받으면 머리가 하얘지는 느낌이 든다.'), q('q3', 'likert', '시험 결과를 지나치게 걱정한다.'), q('q4', 'single', '명상이나 호흡 연습을 해 본 적이 있나요?', ['없다', '한두 번 해 봤다', '가끔 한다', '규칙적으로 한다'])],
  }, slots2, { approvedAt: now - 13 * DAY });

  const slots3 = [];
  for (let d = 3; d <= 12; d += 3) slots3.push({ at: new Date(`${D.toYMD(now + d * DAY)}T15:00:00+09:00`).getTime(), cap: 2 });
  addStudy('s-demo3', r2, 'review', {
    title: '불안을 다루는 8회기 집단상담 프로그램: 참여 경험 면담', summary: '걱정과 불안을 자주 느끼는 성인이 사전 면담 후 집단상담 프로그램에 참여합니다. 교내 구성원과 학외 일반인 모두 지원할 수 있습니다.', type: 'program', minutes: 90, target: 12,
    start: ymd(2), end: ymd(30), irbNo: 'HS-IRB-DEMO-1102', irbUntil: ymd(240), advisor: '이수연 교수', tint: 'peach',
    location: '한신대 오산캠퍼스 만우관 상담실습실', reward: { type: '모바일 상품권', amount: 30000, timing: '모집 종료 후 일괄' },
    criteria: { ageMin: 19, ageMax: 45, statuses: ['학부생', '대학원생', D.EXTERNAL_STATUS], genders: [], depts: [], exclude: '현재 다른 상담이나 심리치료를 받고 있는 경우' },
    explanation: expl({ purpose: '불안을 다루는 집단상담 프로그램이 참여자에게 어떤 경험으로 남는지 이해하려는 연구입니다.', procedure: '사전 설문(3분) 후 예약한 시간에 사전 면담(30분)을 하고, 주 1회 90분씩 8회 집단상담에 참여합니다. 프로그램은 지도감독을 받는 수련 상담자가 진행합니다.', contact: '연구책임자 정민재 (일반대학원 사회복지학과 석사과정)' }),
    survey: [q('q1', 'likert', '요즘 걱정 때문에 일상에 집중하기 어렵다.'), q('q2', 'single', '상담이나 심리 프로그램에 참여해 본 적이 있나요?', ['없다', '한 번 있다', '여러 번 있다'])],
  }, slots3, { submittedAt: now - 1 * DAY });

  addStudy('s-demo4', r1, 'draft', {
    title: '대학원생 연구 소진 척도 개발 및 타당화', summary: '대학원생이 겪는 연구 소진을 측정하는 척도의 예비 문항을 검토합니다.', type: 'survey', minutes: 15, target: 300,
    start: ymd(20), end: ymd(80), irbNo: '', irbUntil: ymd(365), advisor: '박지훈 교수', tint: 'lav',
    criteria: { ageMin: 22, ageMax: 45, statuses: ['대학원생'], genders: [], depts: [], exclude: '' },
    explanation: expl({ purpose: '대학원생의 연구 소진을 측정하는 척도를 개발하고 타당도를 확인합니다.', procedure: '온라인 설문 1회, 약 15분.', contact: '연구책임자 김서윤' }),
    survey: [q('q1', 'likert', '연구실에 가기 전부터 지친 느낌이 든다.')],
  });

  const s5 = addStudy('s-demo5', r2, 'closed', {
    title: '대학생의 SNS 사용과 상향 사회비교', summary: '하루 SNS 사용 시간과 다른 사람과 자신을 비교하는 경험을 묻는 15분 설문입니다.', type: 'survey', minutes: 15, target: 150,
    start: ymd(-80), end: ymd(-20), irbNo: 'HS-IRB-DEMO-0871', irbUntil: ymd(100), advisor: '이수연 교수', tint: 'rose',
    criteria: { ageMin: 19, ageMax: 29, statuses: ['학부생'], genders: [], depts: [], exclude: '' }, reward: { type: '모바일 상품권', amount: 3000, timing: '참여 완료 후 3일 이내' },
    explanation: expl({ purpose: 'SNS 사용 습관과 상향 사회비교 경향의 관계를 알아봅니다.', procedure: '온라인 설문 1회, 약 15분.', contact: '연구책임자 정민재' }),
    survey: [q('q1', 'single', '하루 SNS 사용 시간', ['1시간 미만', '1~2시간', '2~4시간', '4시간 이상']), q('q2', 'likert', 'SNS에서 다른 사람의 일상을 보면 내 삶이 초라하게 느껴진다.'), q('q3', 'likert', '다른 사람의 게시물에 달린 반응 수를 자주 확인한다.')],
  }, [], { approvedAt: now - 82 * DAY });

  // ── 참여 기록 ──
  const genResp = (st) => {
    const a = {};
    for (const qq of st.survey) {
      if (qq.type === 'likert') a[qq.id] = Math.min(5, Math.max(1, Math.round(1 + r() * 2 + r() * 2)));
      else if (qq.type === 'single') a[qq.id] = pick(qq.options);
      else if (qq.type === 'multi') { const s = qq.options.filter(() => r() < 0.35); a[qq.id] = s.length ? s : [qq.options[0]]; }
      else if (r() < 0.7) a[qq.id] = pick(st.samples[qq.id] || ['특별히 없음']);
    }
    return a;
  };
  const byId = new Map(people.map((x) => [x.id, x]));
  const addEnr = (st, userId, e) => {
    const p = byId.get(userId);
    if (D.DONE.includes(e.status)) st.row.doneCount++;
    // 연구자에게 보이는 참여자 정보는 가명 ID·신분·연령대·전화번호 끝 네 자리뿐이다.
    put('enrollments', `${st.id}__${userId}`, { studyId: st.id, uid: userId, pid: p.pid, ownerUid: st.ownerUid, pstatus: p.profile.status, ageBand: D.ageBand(D.ageOf(p.profile, now)), phoneTail: p.tail, ...e });
  };
  const gen = (st, plan) => {
    const elig = D.shuffle(people.filter((u) => u.id !== me && D.matches(st, u.profile, now)), r);
    const st0 = new Date(`${st.start}T09:00:00+09:00`).getTime();
    const span = Math.max(DAY, Math.min(now, D.endTs(st.end)) - st0);
    let k = 0;
    for (const [status, n] of plan) {
      for (let i = 0; i < n && k < elig.length; i++) {
        const u = elig[k++];
        const inv = st0 + r() * span * 0.85;
        const e = { status, invitedAt: Math.round(inv), source: r() < 0.7 ? 'invite' : 'self' };
        if (status !== 'invited') {
          e.consentAt = Math.round(Math.min(now - 3600e3, inv + r() * 2 * DAY));
          e.consentVersion = D.fmtD(now - 2 * DAY);
        }
        if (!['invited', 'consented', 'withdrawn'].includes(status) && st.survey.length) e.responses = genResp(st);
        if (status === 'scheduled') {
          const sl = st.slotRows.find((s) => s.booked < s.cap);
          if (sl) { sl.booked++; e.slotId = sl.id; }
        }
        if (D.DONE.includes(status)) e.completedAt = Math.round(Math.min(now - 1800e3, e.consentAt + r() * DAY * 0.3));
        if (status === 'paid') { e.paidAt = Math.round(Math.min(now - 600e3, e.completedAt + r() * 4 * DAY)); e.rewardSentAt = e.paidAt + 3600e3; e.rewardQueue = 'sent'; }
        if (status === 'withdrawn') { e.withdrawnAt = e.consentAt + 3600e3; e.dataChoice = '폐기'; }
        addEnr(st, u.id, e);
      }
    }
  };
  gen(s1, [['invited', 34], ['consented', 6], ['completed', 22], ['paid', 44], ['withdrawn', 3]]);
  gen(s2, [['invited', 18], ['consented', 2], ['scheduled', 9], ['completed', 4], ['paid', 9], ['withdrawn', 1]]);
  gen(s5, [['paid', 150], ['withdrawn', 4]]);

  // 시연용 참여자(이하은)의 기록과 알림함
  addEnr(s5, me, { status: 'paid', invitedAt: now - 70 * DAY, consentAt: now - 70 * DAY + 3600e3, consentVersion: D.fmtD(now - 82 * DAY), completedAt: now - 70 * DAY + 5400e3, paidAt: now - 68 * DAY, rewardSentAt: now - 68 * DAY, rewardQueue: 'sent', source: 'invite', responses: genResp(s5) });
  put(`enrollments/${s5.id}__${me}/private`, 'consent', { signature: '이하은', items: s5.consent, title: s5.title, irbNo: s5.irbNo, at: now - 70 * DAY + 3600e3 });
  addEnr(s1, me, { status: 'invited', invitedAt: now - 2 * DAY, source: 'invite' });
  const mk = (o) => put('messages', randomId('m'), { toUid: me, studyId: o.studyId, kind: o.kind, channel: o.channel, subject: o.subject || '', body: o.body, at: o.at, read: !!o.read });
  mk({ studyId: s5.id, kind: 'invite', channel: 'email', subject: D.fillTpl(s5.templates.inviteSubject, s5, 'P-1000'), body: D.fillTpl(s5.templates.inviteBody, s5, 'P-1000'), at: now - 70 * DAY, read: true });
  mk({ studyId: s5.id, kind: 'complete', channel: 'email', subject: '[한신 리서치풀] 참여해 주셔서 감사합니다', body: `${s5.title} 연구 참여가 완료되었습니다.\n보상(모바일 상품권 3,000원)은 참여 완료 후 3일 이내 처리됩니다.`, at: now - 70 * DAY + 5400e3, read: true });
  mk({ studyId: s5.id, kind: 'reward', channel: 'sms', body: '[한신리서치풀] 연구 참여 보상 모바일 상품권 3,000원이 발송되었습니다.', at: now - 68 * DAY, read: true });
  mk({ studyId: s1.id, kind: 'invite', channel: 'email', subject: D.fillTpl(s1.templates.inviteSubject, s1, 'P-1000'), body: D.fillTpl(s1.templates.inviteBody, s1, 'P-1000'), at: now - 2 * DAY });
  mk({ studyId: s1.id, kind: 'invite', channel: 'sms', body: D.fillTpl(s1.templates.sms, s1, 'P-1000'), at: now - 2 * DAY });
  mk({ studyId: s2.id, kind: 'newstudy', channel: 'email', subject: '[한신 리서치풀] 조건에 맞는 새 연구가 열렸어요', body: `${s2.title} 연구가 모집을 시작했습니다.\n대면 실험 · 약 50분 · 현금 20,000원\n로그인해서 연구설명문을 확인해 보세요.`, at: now - 12 * DAY });

  const sl = (studyId, at, kind, channel, segment, count, subject) => put('sendLogs', randomId('l'), { studyId, ownerUid: studies.find((x) => x.id === studyId).ownerUid, at, kind, channel, segment, count, subject });
  sl(s1.id, now - 23 * DAY, '초대', '이메일+문자', '대기풀 조건 일치', 60, s1.templates.inviteSubject.replace('{{연구명}}', s1.title));
  sl(s1.id, now - 9 * DAY, '초대', '이메일+문자', '대기풀 조건 일치', 49, s1.templates.inviteSubject.replace('{{연구명}}', s1.title));
  sl(s1.id, now - 5 * DAY, '리마인더', '문자', '초대 후 미응답', 21, '(자동) 초대 3일 후 미응답 리마인더');
  sl(s1.id, now - 3 * DAY, '공지', '이메일', '동의 완료 이상', 72, '[공지] 설문 서버 점검 안내');
  sl(s2.id, now - 12 * DAY, '새 연구 안내', '이메일', '승인 시 자동 안내', 203, '조건에 맞는 새 연구가 열렸어요');

  const au = (at, actorId, actor, role, action) => put('audit', col('audit').doc().id, { at, actorUid: actorId, actor, role, action, pid: null, client: false });
  au(now - 20 * DAY, r2, '정민재', '연구자', `모집 마감: ${s5.title}`);
  au(now - 13 * DAY, adminId, '연구윤리지원팀', '관리자', `연구 승인·공개: ${s2.title}`);
  au(now - 4 * DAY, r1, '김서윤', '연구자', `보상 지급 처리 12건 (${s1.title})`);
  au(now - 3 * DAY, r1, '김서윤', '연구자', `공지 등록: 설문 서버 점검 안내 (${s1.title})`);
  au(now - 1 * DAY, r2, '정민재', '연구자', '심사 제출: 불안을 다루는 8회기 집단상담 프로그램');
  au(now - 1 * DAY + 3600e3, null, '오세린', '연구자', '연구자 회원가입 (재학·이수증 확인 대기)');
  // 예약 수와 완료 인원은 위에서 참여 기록을 만들며 센 값을 쓴다.
  for (const st of studies) for (const x of st.slotRows) put(`studies/${st.id}/slots`, x.id, { at: x.at, cap: x.cap, booked: x.booked });
  const enr = writes.filter((x) => x[0] === 'enrollments').map((x) => x[2]);
  put('stats', 'landing', {
    participants: people.length, poolActive: people.filter((x) => !x.paused).length, recruiting: studies.filter((x) => x.row.status === 'recruiting').length,
    done: enr.filter((e) => D.DONE.includes(e.status)).length, paid: enr.filter((e) => e.status === 'paid').length, at: now,
  });

  const w = db.bulkWriter();
  for (const [name, id, data] of writes) w.set(col(name).doc(id), data);
  await w.close();
  for (const u of logins) await getAuth().createUser(u);

  console.log(`시연용 데이터 ${writes.length}건과 로그인 계정 ${logins.length}개를 넣었습니다. http://localhost:3000 의 로그인 화면에 시연 계정 버튼이 보입니다.
직접 로그인할 때의 비밀번호(모든 계정): ${PASSWORD}
  관리자   research-ethics@hs.ac.kr
  연구자   seoyun.kim@hs.ac.kr (확인됨) · minjae.jung@hs.ac.kr (확인됨) · serin.oh@hs.ac.kr (확인 대기)
  참여자   haeun.lee@hs.ac.kr`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
