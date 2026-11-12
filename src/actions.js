// 화면에서 일어나는 모든 "동작"을 서버에서 처리한다.
// 각 동작은 누가 할 수 있는지(roles)를 먼저 확인하고, 대상이 그 사람 것인지 다시 확인한 뒤 실행한다.
// 상태가 바뀌는 지점(동의, 예약, 완료, 지급, 승인)은 Firestore 트랜잭션으로 "읽고 확인한 뒤 쓰기"를 한 번에 한다.
const path = require('node:path');
const crypto = require('node:crypto');
const { db, col, getDoc, find } = require('./db');
const D = require('./domain');
const st = require('./store');
const auth = require('./auth');
const { hashPassword, verifyPassword, sha256, safeEqual, randomToken } = require('./security');
const { sendMail, mailConfigured } = require('./mailer');
const { demoMode } = require('./state');

const { AppError } = st;
const SITE = '한신 리서치풀';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^01\d-?\d{3,4}-?\d{4}$/;
const campusDomains = () => (process.env.CAMPUS_EMAIL_DOMAINS || 'hs.ac.kr').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
const isCampusEmail = (email) => campusDomains().some((d) => email.endsWith(`@${d}`));

// 연구자·관리자에게 보내는 업무 메일. 시연용 가상 계정에는 실제로 보내지 않는다(그 주소가 실제 사람의 것일 수 있다).
const mailTo = (w, user, msg) => {
  if (user && !user.synthetic) sendMail(w, { to: user.email, ...msg });
};

const need = (cond, msg, status = 400) => {
  if (!cond) throw new AppError(msg, status);
};

// ── 파일 ───────────────────────────────────────────────────
// 이수증·IRB 승인 통지서. 확장자가 아니라 파일 앞부분(매직 넘버)으로 형식을 확인한다.
// Firestore 문서는 1MB를 넘을 수 없어서 본문은 files/{id}/chunks 아래에 나눠 담는다.
const MAGIC = [
  ['application/pdf', '.pdf', (b) => b.subarray(0, 5).toString('latin1') === '%PDF-'],
  ['image/png', '.png', (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['image/jpeg', '.jpg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
];
const CHUNK = 700 * 1024;

function checkFile(file, { pdfOnly = false } = {}) {
  need(file && typeof file.data === 'string' && file.name, '파일을 첨부해 주세요.');
  const buf = Buffer.from(file.data, 'base64');
  need(buf.length > 0 && buf.length <= 5 * 1024 * 1024, '파일은 5MB 이하만 올릴 수 있어요.');
  const hit = MAGIC.find(([, , test]) => test(buf));
  need(hit && (!pdfOnly || hit[0] === 'application/pdf'), pdfOnly ? 'PDF 파일만 올릴 수 있어요.' : 'PDF, JPG, PNG 파일만 올릴 수 있어요.');
  return { buf, mime: hit[0], name: D.line(path.basename(String(file.name)), 120) || `file${hit[1]}` };
}

async function saveFile(ownerId, kind, checked) {
  const id = st.randomId('f');
  const ref = col('files').doc(id);
  const n = Math.ceil(checked.buf.length / CHUNK);
  await ref.set({ owner_id: ownerId, kind, name: checked.name, mime: checked.mime, size: checked.buf.length, chunks: n, created_at: Date.now() });
  for (let i = 0; i < n; i++) await ref.collection('chunks').doc(String(i).padStart(3, '0')).set({ data: checked.buf.subarray(i * CHUNK, (i + 1) * CHUNK) });
  return { id, name: checked.name };
}

async function readFile(id) {
  const meta = await getDoc('files', id);
  if (!meta) return null;
  const chunks = await col('files').doc(meta.id).collection('chunks').orderBy('__name__').get();
  return { ...meta, data: Buffer.concat(chunks.docs.map((d) => Buffer.from(d.get('data')))) };
}

// ── 이메일 인증번호 ─────────────────────────────────────────
const codeRef = (email, purpose) => col('email_codes').doc(sha256(`${purpose}:${email}`));
async function issueCode(email, purpose) {
  const code = String(crypto.randomInt(100000, 1000000));
  await codeRef(email, purpose).set({ code_hash: sha256(`${email}:${code}`), expires_at: Date.now() + 10 * 60e3, attempts: 0 });
  return code;
}
async function checkCode(email, purpose, code) {
  const snap = await codeRef(email, purpose).get();
  const row = snap.data();
  need(row && row.expires_at > Date.now() && row.attempts < 5, '인증번호가 만료되었어요. 다시 받아 주세요.');
  if (!safeEqual(row.code_hash, sha256(`${email}:${String(code || '').trim()}`))) {
    await codeRef(email, purpose).update({ attempts: st.FieldValue.increment(1) });
    throw new AppError('인증번호가 맞지 않아요.');
  }
}
const consumeCode = (email, purpose) => codeRef(email, purpose).delete();

// ── 공통 조회 ───────────────────────────────────────────────
async function ownStudy(user, id, statuses) {
  const study = await st.getStudy(id);
  need(study && study.ownerRowId === user.id, '연구를 찾을 수 없어요.', 404);
  if (statuses) need(statuses.includes(study.status), '지금 상태에서는 할 수 없는 작업이에요.');
  return study;
}
const enrRef = (studyId, userId) => col('enrollments').doc(st.enrId(studyId, userId));
const myEnrollment = (user, studyId) => getDoc('enrollments', st.enrId(studyId, user.id));
// 문서의 doc(제목·설명문 등)만 고칠 때 쓴다.
const saveDoc = (study, fields) => col('studies').doc(study.id).update({ ...fields, updated_at: Date.now() });

async function persistDraft(ctx, raw) {
  const user = ctx.user;
  need(raw && typeof raw === 'object', '저장할 내용이 없어요.');
  const now = Date.now();
  const d = D.sanitizeDraft(raw, now);
  const { slots, ...doc } = d;
  let file = null;
  if (raw.irbFileId) {
    const f = await getDoc('files', raw.irbFileId);
    if (f && f.owner_id === user.id && f.kind === 'irb') file = f;
  }
  const fields = {
    doc, irb_file_id: file ? file.id : null, irb_file_name: file ? file.name : null, updated_at: now,
    // 초안 단계에는 예약자가 없으므로 예약 시간을 통째로 바꿔도 된다.
    slots: slots.map((s) => ({ id: st.randomId('slot'), at: s.at, cap: s.cap, booked: 0 })),
  };
  const row = raw.id ? await getDoc('studies', raw.id) : null;
  let id;
  if (row) {
    need(row.owner_id === user.id, '연구를 찾을 수 없어요.', 404);
    need(['draft', 'rejected'].includes(row.status), '심사 중이거나 공개된 연구는 고칠 수 없어요.');
    id = row.id;
    fields.doc.notices = (row.doc && row.doc.notices) || [];
    await col('studies').doc(id).update(fields);
  } else {
    id = st.randomId('s');
    fields.doc.notices = [];
    await col('studies').doc(id).set({ ...fields, owner_id: user.id, status: 'draft', created_at: now });
    st.log(ctx.w, user, `연구 작성 시작: ${doc.title || '제목 없는 연구'}`);
  }
  return { id, doc: d, hasFile: !!file };
}

// 예약 한 자리를 돌려준다(철회·탈퇴).
async function freeSlot(studyId, slotId) {
  if (!slotId) return;
  await db.runTransaction(async (t) => {
    const ref = col('studies').doc(studyId);
    const snap = await t.get(ref);
    if (!snap.exists) return;
    t.update(ref, { slots: (snap.get('slots') || []).map((s) => (s.id === slotId ? { ...s, booked: Math.max(0, s.booked - 1) } : s)) });
  });
}

const A = {};
const def = (name, roles, fn) => {
  A[name] = { roles, fn };
};

// ════════════ 로그인·가입 ════════════
def('sendCode', null, async (ctx, p) => {
  const email = D.line(p.email, 120).toLowerCase();
  const purpose = p.purpose === 'reset' ? 'reset' : 'signup';
  need(EMAIL_RE.test(email), '이메일 주소를 확인해 주세요.');
  need(auth.rateLimit(`code:${ctx.req.ip}`, 10, 3600e3) && auth.rateLimit(`code:${email}`, 5, 3600e3), '인증번호 요청이 너무 많아요. 잠시 후 다시 시도해 주세요.', 429);
  if (purpose === 'signup' && p.role === 'researcher') need(isCampusEmail(email), `연구자는 학교 이메일(@${campusDomains()[0]})로만 가입할 수 있어요.`);
  let devCode;
  // 재설정은 가입된 주소에만 보내되, 화면 응답은 같게 해서 가입 여부를 알 수 없게 한다.
  if (purpose === 'signup' || (await st.userByEmail(email))) {
    const code = await issueCode(email, purpose);
    sendMail(ctx.w, { to: email, subject: `[${SITE}] 인증번호 ${code}`, text: `인증번호는 ${code} 입니다. 10분 안에 입력해 주세요.\n본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다.` });
    if (!mailConfigured() && process.env.NODE_ENV !== 'production') devCode = code;
  }
  return { toast: devCode ? `인증번호 ${devCode} (메일 서버를 연결하지 않은 개발 환경이라 화면에 표시합니다)` : `${email}로 인증번호를 보냈어요. 10분 안에 입력해 주세요.` };
});

def('signup', null, async (ctx, p) => {
  const isP = p.role !== 'researcher';
  need(auth.rateLimit(`signup:${ctx.req.ip}`, 10, 3600e3), '가입 시도가 너무 많아요. 잠시 후 다시 시도해 주세요.', 429);
  const name = D.line(p.name, 30);
  const phone = D.line(p.phone, 20);
  const email = D.line(p.email, 120).toLowerCase();
  need(name.length >= 2, '이름을 입력해 주세요.');
  need(PHONE_RE.test(phone), '휴대전화 번호를 010-0000-0000 형식으로 입력해 주세요.');
  need(EMAIL_RE.test(email), '이메일 주소를 확인해 주세요.');
  need(String(p.pw || '').length >= 10 && String(p.pw).length <= 200, '비밀번호는 10자 이상이어야 해요.');
  need(p.a1 && p.a2, '필수 항목에 동의해 주세요.');
  const now = Date.now();
  let cols;
  let ethics = null;
  if (isP) {
    const birthYear = Number(p.by);
    const status = D.STATUSES.includes(p.status) ? p.status : null;
    need(birthYear && D.GENDERS.includes(p.gender) && status, '출생연도, 성별, 신분을 모두 골라 주세요.');
    need(D.ageOf({ birthYear }, now) >= D.MIN_AGE && birthYear >= 1920, `만 ${D.MIN_AGE}세 이상만 가입할 수 있어요.`);
    const campus = status !== D.EXTERNAL_STATUS;
    // 재학생·교직원이라는 것은 학교 메일로만 확인할 수 있다.
    if (campus) need(isCampusEmail(email), `학부생·대학원생·교직원은 학교 이메일(@${campusDomains()[0]})로 가입해 주세요. 학교 계정이 없다면 '${D.EXTERNAL_STATUS}'으로 가입할 수 있어요.`);
    const dept = !campus ? '학외' : status === '교직원' ? '교직원' : D.DEPTS.includes(p.dept) ? p.dept : null;
    need(dept, '학과를 골라 주세요.');
    const profile = {
      birthYear, gender: p.gender, status, dept,
      year: campus && ['1학년', '2학년', '3학년', '4학년'].includes(p.year) ? p.year : '해당 없음',
      interests: D.subset(p.interests, D.INTERESTS), times: D.subset(p.times, D.TIMES),
    };
    cols = { role: 'participant', pid: st.newPid(), profile_enc: st.encryptJSON(profile), affiliation: campus ? 'campus' : 'external', contact_sms: p.sms !== false, pool_joined: p.a3 !== false, pool_paused: false, pool_since: now, phone_tail: st.phoneTail(phone), notice_ats: [], verified: true };
  } else {
    need(isCampusEmail(email), `연구자는 학교 이메일(@${campusDomains()[0]})로만 가입할 수 있어요.`);
    const dept = D.line(p.rdept, 60);
    const advisor = D.line(p.adv, 40);
    need(dept && advisor && /^\d{4}-\d{2}-\d{2}$/.test(String(p.eth || '')), '소속, 지도교수, 윤리교육 이수일을 입력해 주세요.');
    need(p.ethFile && p.ethFile.data, '연구윤리교육 이수증을 첨부해 주세요.');
    ethics = checkFile(p.ethFile);
    cols = { role: 'researcher', program: D.PROGRAMS.includes(p.prog) ? p.prog : '석사과정', dept, advisor, ethics_date: p.eth, verified: false };
  }
  await checkCode(email, 'signup', p.code);
  const ref = col('users').doc();
  // 같은 이메일(또는 같은 가명 ID)로 두 번 가입되지 않도록 확인과 생성을 한 번에 한다.
  await db.runTransaction(async (t) => {
    need((await t.get(col('users').where('email', '==', email).limit(1))).empty, '이미 가입된 이메일이에요. 로그인해 주세요.');
    if (cols.pid) need((await t.get(col('users').where('pid', '==', cols.pid).limit(1))).empty, '잠시 후 다시 시도해 주세요.');
    t.create(ref, { email, password_hash: hashPassword(String(p.pw)), pii_enc: st.encryptJSON({ name, phone }), status: 'active', synthetic: false, joined_at: now, ...cols });
  });
  if (ethics) {
    const file = await saveFile(ref.id, 'ethics', ethics);
    await ref.update({ ethics_file_id: file.id, ethics_file_name: file.name });
  }
  await consumeCode(email, 'signup');
  st.invalidatePool();
  const user = await st.userById(ref.id);
  st.log(ctx.w, user, isP ? `참여자 회원가입${cols.pool_joined ? ' · 대기풀 등록' : ''}` : '연구자 회원가입 (재학·이수증 확인 대기)');
  await auth.login(ctx.req, ctx.res, user.id);
  ctx.user = user;
  return { toast: isP ? `가입을 마쳤어요. 가명 ID는 ${user.pid}입니다.` : '가입을 마쳤어요. 연구지원팀 확인 후 심사 제출이 열립니다.' };
});

def('login', null, async (ctx, p) => {
  const email = D.line(p.email, 120).toLowerCase();
  const key = `login:${ctx.req.ip}:${email}`;
  need(auth.rateLimit(key, 6, 15 * 60e3), '로그인 시도가 너무 많아요. 15분 뒤에 다시 시도해 주세요.', 429);
  const user = await st.userByEmail(email);
  need(user && verifyPassword(String(p.pw || ''), user.password_hash), '이메일 또는 비밀번호가 맞지 않아요.');
  auth.clearRateLimit(key);
  await auth.login(ctx.req, ctx.res, user.id);
  ctx.user = user;
  return {};
});

// 시연용 계정으로 바로 들어가기. DEMO_MODE=1이고 운영 환경이 아닐 때만 열린다.
def('demoLogin', null, async (ctx, p) => {
  need(demoMode(), '시연 모드가 아니에요.', 404);
  const email = { participant: 'haeun.lee@hs.ac.kr', researcher: 'seoyun.kim@hs.ac.kr', admin: 'research-ethics@hs.ac.kr' }[p.who];
  const user = email && (await st.userByEmail(email));
  need(user && user.synthetic, '시연용 계정이 없어요. npm run seed 를 먼저 실행해 주세요.', 404);
  await auth.login(ctx.req, ctx.res, user.id);
  ctx.user = user;
  return {};
});

def('logout', null, async (ctx) => {
  await auth.logout(ctx.req, ctx.res);
  ctx.user = null;
  return {};
});

def('resetPassword', null, async (ctx, p) => {
  const email = D.line(p.email, 120).toLowerCase();
  need(auth.rateLimit(`reset:${ctx.req.ip}`, 10, 3600e3), '시도가 너무 많아요. 잠시 후 다시 시도해 주세요.', 429);
  need(String(p.pw || '').length >= 10 && String(p.pw).length <= 200, '새 비밀번호는 10자 이상이어야 해요.');
  await checkCode(email, 'reset', p.code);
  const user = await st.userByEmail(email);
  need(user, '인증번호가 맞지 않아요.');
  await col('users').doc(user.id).update({ password_hash: hashPassword(String(p.pw)) });
  await auth.endAllSessions(user.id);
  await consumeCode(email, 'reset');
  st.log(ctx.w, user, '비밀번호 재설정');
  return { toast: '비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.' };
});

// ════════════ 연구자 ════════════
def('uploadIrb', ['researcher'], async (ctx, p) => ({ file: await saveFile(ctx.user.id, 'irb', checkFile(p.file, { pdfOnly: true })) }));

def('saveDraft', ['researcher'], async (ctx, p) => {
  const { id } = await persistDraft(ctx, p.draft);
  return { id, toast: '임시 저장했어요. 내 연구 목록에서 이어서 작성할 수 있어요.' };
});

def('submitStudy', ['researcher'], async (ctx, p) => {
  need(ctx.user.verified, '연구지원팀의 연구자 확인이 끝나면 제출할 수 있어요.');
  need(p.pledge, 'IRB 승인 내용과 같은지 확인란에 체크해 주세요.');
  const { id, doc, hasFile } = await persistDraft(ctx, p.draft);
  const miss = D.checks(doc, hasFile).filter((c) => !c[1]).map((c) => c[0]);
  need(!miss.length, `채워야 할 항목: ${miss.join(', ')}`);
  await col('studies').doc(id).update({ status: 'review', submitted_at: Date.now(), review_comment: null });
  st.log(ctx.w, ctx.user, `심사 제출: ${doc.title}`);
  return { id, toast: '심사에 제출했어요. 결과는 이 화면과 할 일 목록에서 확인할 수 있어요.' };
});

def('closeStudy', ['researcher'], async (ctx, p) => {
  const study = await ownStudy(ctx.user, p.id, ['recruiting']);
  await saveDoc(study, { status: 'closed' });
  st.log(ctx.w, ctx.user, `모집 마감: ${study.title}`);
  return { toast: '모집을 마감했어요.' };
});

def('markDone', ['researcher'], async (ctx, p) => {
  const e = await getDoc('enrollments', p.id);
  need(e, '참여 기록을 찾을 수 없어요.', 404);
  const study = await ownStudy(ctx.user, e.study_id);
  await db.runTransaction(async (t) => {
    const ref = col('enrollments').doc(e.id);
    need((await t.get(ref)).get('status') === 'scheduled', '일정이 확정된 참여자만 완료 처리할 수 있어요.');
    t.update(ref, { status: 'completed', completed_at: Date.now() });
  });
  st.invalidateEnr(study.id);
  const u = await st.userById(e.user_id);
  st.deliver(ctx.w, u, { studyId: study.id, kind: 'complete', channel: 'email', subject: `[${SITE}] 참여해 주셔서 감사합니다`, body: `${study.title} 연구 참여가 완료되었습니다.\n보상(${D.rewardText(study)})은 ${study.reward.timing} 처리됩니다.` });
  st.log(ctx.w, ctx.user, `참여 완료 처리 ${e.pid} (${study.title})`, e.pid);
  return { toast: `${e.pid} 참여 완료로 바꿨어요.` };
});

def('sendInvites', ['researcher'], async (ctx, p) => {
  const study = await ownStudy(ctx.user, p.id, ['recruiting']);
  await st.enrollmentsOf(study.id, { fresh: true }); // 이미 초대한 사람을 다시 고르지 않도록 최신 상태로 본다.
  const pool = D.shuffle(await st.eligibleForInvite(study));
  const n = Math.max(0, Math.min(pool.length, Math.round(Number(p.n)) || 0));
  need(n > 0, '초대 인원을 1명 이상 입력해 주세요.');
  const ch = ['both', 'email', 'sms'].includes(p.ch) ? p.ch : 'both';
  const chosen = pool.slice(0, n);
  const users = await st.usersByIds(chosen.map((x) => x.id));
  let msgs = 0;
  for (const pu of chosen) {
    const u = users.get(pu.id);
    if (!u) continue;
    ctx.w.create(enrRef(study.id, u.id), { study_id: study.id, user_id: u.id, pid: u.pid, status: 'invited', source: 'invite', invited_at: Date.now() });
    msgs += st.deliver(ctx.w, u, { studyId: study.id, kind: 'invite', channel: ch, subject: D.fillTpl(study.templates.inviteSubject, study, u.pid), body: D.fillTpl(study.templates.inviteBody, study, u.pid), sms: D.fillTpl(study.templates.sms, study, u.pid) });
  }
  st.invalidateEnr(study.id);
  st.sendLog(ctx.w, study.id, '초대', D.CHANNEL_LABEL[ch], '대기풀 조건 일치', n, D.fillTpl(study.templates.inviteSubject, study, null));
  st.log(ctx.w, ctx.user, `대기풀 초대 ${n}명 (${study.title})`);
  return { toast: `${n}명에게 초대를 보냈어요. 메시지 ${msgs}건이 발송 기록에 남았어요.` };
});

def('sendCompose', ['researcher'], async (ctx, p) => {
  const study = await ownStudy(ctx.user, p.id, ['recruiting', 'closed']);
  const seg = D.SEGMENTS[p.seg];
  const ch = ['both', 'email', 'sms'].includes(p.ch) ? p.ch : 'sms';
  const body = D.text(p.body, 2000).trim();
  const subj = D.line(p.subj, 200) || `[${SITE}] ${study.title} 안내`;
  need(seg, '받는 사람을 골라 주세요.');
  need(body, '내용을 입력해 주세요.');
  // 참여자가 같은 연구에서 안내를 지나치게 많이 받지 않도록 한다.
  const today = (await find(col('send_logs').where('study_id', '==', study.id))).filter((l) => l.kind === '안내' && l.at > Date.now() - D.DAY).length;
  need(today < 3, '한 연구에서 직접 보내는 안내는 하루 3번까지 가능해요.');
  const targets = (await st.enrollmentsOf(study.id, { fresh: true })).filter(seg[1]);
  need(targets.length, '보낼 대상이 없어요.');
  const users = await st.usersByIds(targets.map((e) => e.user_id));
  let msgs = 0;
  for (const e of targets) {
    const u = users.get(e.user_id);
    if (!u) continue;
    const filled = D.fillTpl(body, study, u.pid);
    msgs += st.deliver(ctx.w, u, { studyId: study.id, kind: 'reminder', channel: ch, subject: D.fillTpl(subj, study, u.pid), body: filled, sms: filled });
  }
  st.sendLog(ctx.w, study.id, '안내', D.CHANNEL_LABEL[ch], seg[0], targets.length, ch === 'sms' ? body.slice(0, 40) : subj);
  st.log(ctx.w, ctx.user, `안내 발송 ${targets.length}명 · ${seg[0]} (${study.title})`);
  return { toast: `${targets.length}명에게 보냈어요. (메시지 ${msgs}건)` };
});

def('addNotice', ['researcher'], async (ctx, p) => {
  const study = await ownStudy(ctx.user, p.id, ['recruiting', 'closed']);
  const title = D.line(p.title, 120);
  const body = D.text(p.body, 2000).trim();
  need(title && body, '제목과 내용을 입력해 주세요.');
  await saveDoc(study, { 'doc.notices': st.FieldValue.arrayUnion({ id: st.randomId('n'), at: Date.now(), title, body }) });
  let n = 0;
  if (p.notify !== false) {
    const targets = (await st.enrollmentsOf(study.id, { fresh: true })).filter((x) => D.ACTIVE.includes(x.status));
    const users = await st.usersByIds(targets.map((e) => e.user_id));
    for (const e of targets) {
      const u = users.get(e.user_id);
      if (!u) continue;
      st.deliver(ctx.w, u, { studyId: study.id, kind: 'notice', channel: 'email', subject: `[공지] ${title}`, body });
      n++;
    }
    st.sendLog(ctx.w, study.id, '공지', '이메일', '동의 완료 이상', n, `[공지] ${title}`);
  }
  st.log(ctx.w, ctx.user, `공지 등록: ${title} (${study.title})`);
  return { toast: n ? `공지를 등록하고 ${n}명에게 알렸어요.` : '공지를 등록했어요.' };
});

def('setReminder', ['researcher'], async (ctx, p) => {
  const study = await ownStudy(ctx.user, p.id, ['recruiting', 'closed']);
  need(['remind3', 'remindEnd'].includes(p.key), '알 수 없는 설정이에요.');
  await saveDoc(study, { [`doc.templates.${p.key}`]: !!p.value });
  return { toast: '자동 리마인더 설정을 저장했어요.' };
});

def('pay', ['researcher'], async (ctx, p) => {
  const study = await ownStudy(ctx.user, p.id, ['recruiting', 'closed']);
  need(study.reward.amount > 0, '보상이 없는 연구예요.');
  const ids = new Set(Array.isArray(p.ids) ? p.ids.map(String) : []);
  const list = (await st.enrollmentsOf(study.id, { fresh: true })).filter((e) => e.status === 'completed' && ids.has(e.id));
  need(list.length, '지급할 건을 골라 주세요.');
  const gift = study.reward.type === '모바일 상품권';
  const users = await st.usersByIds(list.map((e) => e.user_id));
  let n = 0;
  for (const e of list) {
    // 같은 건을 두 번 지급 처리하지 않도록 상태를 다시 확인하고 바꾼다.
    const ok = await db.runTransaction(async (t) => {
      const ref = col('enrollments').doc(e.id);
      if ((await t.get(ref)).get('status') !== 'completed') return false;
      t.update(ref, { status: 'paid', paid_at: Date.now(), ...(gift ? { reward_queue: 'pending' } : {}) });
      return true;
    });
    const u = users.get(e.user_id);
    if (!ok || !u) continue;
    n++;
    // 상품권은 번호를 아는 연구지원팀이 실제로 보낸 뒤에 "발송되었습니다" 문자가 나간다.
    st.deliver(ctx.w, u, gift
      ? { studyId: study.id, kind: 'reward', channel: 'email', subject: `[${SITE}] 보상 지급이 접수되었어요`, body: `${study.title} 연구의 참여 보상(${D.rewardText(study)}) 지급이 접수되었습니다.\n연구지원팀이 영업일 기준 3일 안에 등록하신 휴대전화 번호로 모바일 상품권을 보내 드립니다.` }
      : { studyId: study.id, kind: 'reward', channel: 'sms', body: `[한신리서치풀] 연구 참여 보상 ${D.rewardText(study)} 지급이 처리되었습니다.` });
    st.log(ctx.w, ctx.user, `보상 지급 처리 ${e.pid} (${study.title})`, e.pid);
  }
  st.invalidateEnr(study.id);
  need(n, '지급할 건을 골라 주세요.');
  return { toast: gift ? `${n}건을 지급 처리했어요. 상품권은 연구지원팀이 발송합니다.` : `${n}건을 지급 처리했어요.` };
});

// 지급 대장·응답 데이터를 내려받은 사실을 기록한다(자료는 화면이 이미 받은 범위 안에서 만든다).
def('logExport', ['researcher'], async (ctx, p) => {
  const study = await ownStudy(ctx.user, p.id);
  st.log(ctx.w, ctx.user, p.kind === 'ledger' ? `지급 대장 복사 (${study.title})` : `응답 데이터 열람·복사 (${study.title})`);
  return {};
});

def('replyInquiry', ['researcher'], async (ctx, p) => {
  const q = await getDoc('inquiries', p.id);
  need(q && !q.reported, '문의를 찾을 수 없어요.', 404);
  const study = await ownStudy(ctx.user, q.study_id);
  const body = D.text(p.body, 2000).trim();
  need(body, '답변 내용을 입력해 주세요.');
  await col('inquiries').doc(q.id).update({ reply: body, replied_at: Date.now() });
  const u = await st.userById(q.user_id);
  if (u) st.deliver(ctx.w, u, { studyId: study.id, kind: 'reply', channel: 'email', subject: `[${SITE}] 문의에 연구자가 답했어요 — ${study.title}`, body: `보내신 문의\n${q.body}\n\n연구자의 답변\n${body}` });
  return { toast: '답변을 보냈어요. 참여자의 알림함과 이메일로 전달됩니다.' };
});

// 부적절한 문의는 연구자 화면에서 가리고 연구지원팀에 알린다.
def('reportInquiry', ['researcher'], async (ctx, p) => {
  const q = await getDoc('inquiries', p.id);
  need(q, '문의를 찾을 수 없어요.', 404);
  const study = await ownStudy(ctx.user, q.study_id);
  await col('inquiries').doc(q.id).update({ reported: true });
  st.log(ctx.w, ctx.user, `부적절한 문의 신고 ${q.pid} (${study.title})`, q.pid);
  return { toast: '신고했어요. 내용은 가려지고 연구지원팀이 확인합니다.' };
});

// ════════════ 참여자 ════════════
def('apply', ['participant'], async (ctx, p) => {
  const u = ctx.user;
  const study = await st.getStudy(p.studyId);
  need(study && ['recruiting', 'closed'].includes(study.status), '연구를 찾을 수 없어요.', 404);
  if (await myEnrollment(u, study.id)) return {};
  need(study.status === 'recruiting', '모집이 끝난 연구예요.');
  need(D.matches(study, u.profile), '참여 조건에 맞지 않아요.');
  need((await st.doneCount(study.id)) < study.target, '모집 인원이 모두 찼어요.');
  // 문서 ID가 (연구, 사람)으로 정해져 있어 같은 연구에 두 번 신청되지 않는다.
  await enrRef(study.id, u.id).create({ study_id: study.id, user_id: u.id, pid: u.pid, status: 'invited', source: 'self', invited_at: Date.now() }).catch((err) => {
    if (err.code !== 6) throw err;
  });
  st.invalidateEnr(study.id);
  return {};
});

def('consent', ['participant'], async (ctx, p) => {
  const u = ctx.user;
  const study = await st.getStudy(p.studyId);
  need(study, '연구를 찾을 수 없어요.', 404);
  need(study.status === 'recruiting', '모집이 끝난 연구예요.');
  need((await st.doneCount(study.id)) < study.target, '모집 인원이 모두 찼어요.');
  const items = study.consent.filter((c) => c.trim());
  need(Array.isArray(p.checks) && study.consent.every((c, i) => !c.trim() || p.checks[i] === true), '모든 동의 항목에 체크해야 참여할 수 있어요.');
  const signature = D.line(p.signature, 30);
  need(signature === u.name, '서명란에 가입할 때 등록한 이름을 입력해 주세요.');
  const now = Date.now();
  await db.runTransaction(async (t) => {
    const ref = enrRef(study.id, u.id);
    const snap = await t.get(ref);
    need(snap.exists && snap.get('status') === 'invited', '동의할 수 있는 상태가 아니에요.');
    t.update(ref, { status: 'consented', consent_at: now, signature_enc: st.encryptJSON(signature), consent_doc_enc: st.encryptJSON({ title: study.title, irbNo: study.irbNo, items }), consent_version: D.fmtD(study.updatedAt) });
  });
  st.invalidateEnr(study.id);
  if (study.consentCopy && p.copy !== false) {
    st.deliver(ctx.w, u, { studyId: study.id, kind: 'consent', channel: 'email', subject: `[${SITE}] 연구참여 동의서 사본 — ${study.title}`, body: `서명 일시: ${D.fmtD(now)} ${D.fmtDT(now).split(' ')[1]}\n서명: ${signature}\n\n${items.map((c, i) => `${i + 1}. ${c} — 동의`).join('\n')}\n\n철회는 ${SITE} > 내 참여 기록에서 언제든 할 수 있습니다.` });
  }
  st.log(ctx.w, u, `전자동의 서명 (${study.title})`);
  return {};
});

def('finish', ['participant'], async (ctx, p) => {
  const u = ctx.user;
  const study = await st.getStudy(p.studyId);
  need(study, '연구를 찾을 수 없어요.', 404);
  need(['recruiting', 'closed'].includes(study.status), '지금은 참여할 수 없는 연구예요.');
  const now = Date.now();
  let responses = null;
  if (study.survey.length) {
    responses = D.cleanAnswers(study.survey, p.answers);
    const miss = study.survey.findIndex((q) => q.required && !D.hasAns(responses[q.id]));
    need(miss < 0, `${miss + 1}번 문항에 답해 주세요.`);
  }
  const responses_enc = responses ? st.encryptJSON(responses) : null;
  // 참여 상태와 예약 정원을 같이 확인하고 같이 바꾼다. 동시에 신청해도 정원을 넘지 않는다.
  const slot = await db.runTransaction(async (t) => {
    const eRef = enrRef(study.id, u.id);
    const sRef = col('studies').doc(study.id);
    const [eSnap, sSnap] = await Promise.all([t.get(eRef), t.get(sRef)]);
    need(eSnap.exists && eSnap.get('status') === 'consented', '먼저 동의를 마쳐 주세요.');
    const slots = sSnap.get('slots') || [];
    if (!slots.length) {
      t.update(eRef, { status: 'completed', completed_at: now, responses_enc });
      return null;
    }
    const pick = slots.find((s) => s.id === p.slotId);
    need(pick && pick.at > now, '시간을 하나 골라 주세요.');
    need(pick.booked < pick.cap, '방금 그 시간이 마감됐어요. 다른 시간을 골라 주세요.');
    t.update(sRef, { slots: slots.map((s) => (s.id === pick.id ? { ...s, booked: s.booked + 1 } : s)) });
    t.update(eRef, { status: 'scheduled', slot_id: pick.id, responses_enc });
    return pick;
  });
  st.invalidateEnr(study.id);
  if (slot) {
    st.deliver(ctx.w, u, { studyId: study.id, kind: 'schedule', channel: 'both', subject: `[${SITE}] 일정이 확정되었어요`, body: `${study.title}\n일시: ${D.fmtDT(slot.at)}\n장소: ${study.location}\n\n일정을 바꿔야 하면 연구 화면의 '연구자에게 문의하기'를 이용해 주세요.`, sms: `[한신리서치풀] 일정 확정 ${D.fmtDT(slot.at)} ${study.location}` });
    st.log(ctx.w, u, `일정 예약 ${D.fmtDT(slot.at)} (${study.title})`);
  } else {
    st.deliver(ctx.w, u, { studyId: study.id, kind: 'complete', channel: 'email', subject: `[${SITE}] 참여해 주셔서 감사합니다`, body: `${study.title} 연구 참여가 완료되었습니다.\n보상(${D.rewardText(study)})은 ${study.reward.timing} 처리됩니다.` });
    st.log(ctx.w, u, `설문 완료 (${study.title})`);
  }
  return {};
});

// 참여 기록 하나를 철회로 바꾼다. 예약이 있었다면 그 자리를 돌려준다.
async function withdrawOne(e, destroy) {
  const prev = await db.runTransaction(async (t) => {
    const ref = col('enrollments').doc(e.id);
    const snap = await t.get(ref);
    if (!snap.exists || snap.get('status') === 'withdrawn') return null;
    t.update(ref, { status: 'withdrawn', withdrawn_at: Date.now(), data_choice: destroy ? '폐기' : '보관', ...(destroy ? { responses_enc: null } : {}) });
    return { status: snap.get('status'), slotId: snap.get('slot_id') };
  });
  if (prev && prev.status === 'scheduled') await freeSlot(e.study_id, prev.slotId);
  st.invalidateEnr(e.study_id);
  return !!prev;
}

def('withdraw', ['participant'], async (ctx, p) => {
  const u = ctx.user;
  const e = await getDoc('enrollments', p.id);
  need(e && e.user_id === u.id, '참여 기록을 찾을 수 없어요.', 404);
  const destroy = p.choice !== 'keep';
  need(await withdrawOne(e, destroy), '이미 철회한 연구예요.');
  const study = await st.getStudy(e.study_id);
  st.deliver(ctx.w, u, { studyId: study.id, kind: 'withdraw', channel: 'email', subject: `[${SITE}] 참여 철회가 처리되었어요`, body: `${study.title} 연구 참여를 철회했습니다.\n제출한 응답: ${destroy ? '폐기' : '가명 상태로 보관'}` });
  st.log(ctx.w, u, `참여 철회 · 자료 ${destroy ? '폐기' : '보관'} (${study.title})`);
  return { toast: '철회를 처리했어요.' };
});

def('ask', ['participant'], async (ctx, p) => {
  const u = ctx.user;
  const study = await st.getStudy(p.studyId);
  need(study && ['recruiting', 'closed'].includes(study.status), '연구를 찾을 수 없어요.', 404);
  const e = await myEnrollment(u, study.id);
  need((e && e.status !== 'withdrawn') || (study.status === 'recruiting' && D.matches(study, u.profile)), '이 연구에는 문의를 보낼 수 없어요.');
  const body = D.text(p.body, 1000).trim();
  need(body.length >= 5, '문의 내용을 조금 더 자세히 적어 주세요.');
  const recent = (await find(col('inquiries').where('user_id', '==', u.id))).filter((q) => q.at > Date.now() - D.DAY).length;
  need(recent < 5, '문의는 하루 5번까지 보낼 수 있어요.');
  await col('inquiries').doc(st.randomId('q')).set({ study_id: study.id, user_id: u.id, pid: u.pid, body, at: Date.now(), reported: false });
  mailTo(ctx.w, await st.userById(study.ownerRowId), { subject: `[${SITE}] 새 문의가 도착했어요 — ${study.title}`, text: `참여자 ${u.pid} 님이 문의를 남겼습니다. ${SITE}에 로그인해 연구의 '문의' 탭에서 확인하고 답변해 주세요.` });
  return { toast: '문의를 보냈어요. 답변은 알림함과 이메일로 알려드릴게요.' };
});

async function setPool(ctx, fields, note) {
  await col('users').doc(ctx.user.id).update(fields);
  st.invalidatePool();
  st.log(ctx.w, ctx.user, note);
}

def('togglePause', ['participant'], async (ctx) => {
  const u = ctx.user;
  if (!u.pool_joined) {
    await setPool(ctx, { pool_joined: true, pool_paused: false, pool_since: Date.now() }, '대기풀 등록');
    return { toast: '다시 안내를 받아요.' };
  }
  const paused = !u.pool_paused;
  await setPool(ctx, { pool_paused: paused }, `대기풀 ${paused ? '일시정지' : '안내 재개'}`);
  return { toast: paused ? '새 연구 안내를 잠시 멈췄어요.' : '다시 안내를 받아요.' };
});

def('setPref', ['participant'], async (ctx, p) => {
  const u = ctx.user;
  const v = !!p.value;
  if (p.key === 'pool.joined') await setPool(ctx, v ? { pool_joined: true, pool_since: u.pool_since || Date.now() } : { pool_joined: false }, '대기풀 설정 변경');
  else if (p.key === 'pool.paused') await setPool(ctx, { pool_paused: v }, '대기풀 설정 변경');
  else if (p.key === 'contact.sms') await setPool(ctx, { contact_sms: v }, '안내 수신 방법 변경');
  else throw new AppError('알 수 없는 설정이에요.');
  return { toast: '저장했어요.' };
});

def('setProfileList', ['participant'], async (ctx, p) => {
  const u = ctx.user;
  const allowed = { interests: D.INTERESTS, times: D.TIMES }[p.path];
  need(allowed && u.profile, '알 수 없는 항목이에요.');
  await col('users').doc(u.id).update({ profile_enc: st.encryptJSON({ ...u.profile, [p.path]: D.subset(p.values, allowed) }) });
  st.invalidatePool();
  return { toast: '저장했어요.' };
});

def('readMsg', ['participant'], async (ctx, p) => {
  const m = await getDoc('messages', p.id);
  if (m && m.to_user_id === ctx.user.id) await col('messages').doc(m.id).update({ read: true });
  return {};
});
def('readAll', ['participant'], async (ctx) => {
  for (const m of await find(col('messages').where('to_user_id', '==', ctx.user.id).where('read', '==', false))) ctx.w.update(col('messages').doc(m.id), { read: true });
  return {};
});

def('deleteAccount', ['participant'], async (ctx) => {
  const u = ctx.user;
  // 진행 중인 참여는 철회하고 응답을 폐기한다. 이미 마친 연구의 가명 응답과 동의서는 법정 보관 기간 동안 남는다.
  for (const e of await find(col('enrollments').where('user_id', '==', u.id))) {
    if (['invited', 'consented', 'scheduled'].includes(e.status)) await withdrawOne(e, true);
  }
  st.log(ctx.w, u, '회원 탈퇴');
  await col('users').doc(u.id).update({
    status: 'deleted', email: `deleted-${u.id}@deleted.invalid`, password_hash: hashPassword(randomToken(24)), pii_enc: st.encryptJSON({ name: '(탈퇴)', phone: '' }),
    profile_enc: null, phone_tail: null, notice_ats: [], pool_joined: false, pool_paused: true, contact_sms: false,
  });
  await auth.endAllSessions(u.id);
  for (const m of await find(col('messages').where('to_user_id', '==', u.id))) ctx.w.delete(col('messages').doc(m.id));
  for (const q of await find(col('inquiries').where('user_id', '==', u.id))) ctx.w.delete(col('inquiries').doc(q.id));
  st.invalidatePool();
  await auth.logout(ctx.req, ctx.res);
  ctx.user = null;
  return { toast: '탈퇴를 처리했어요.' };
});

// ════════════ 관리자(연구윤리지원팀) ════════════
def('verify', ['admin'], async (ctx, p) => {
  const x = await st.userById(String(p.id || '').replace(/^r-/, ''));
  need(x && x.role === 'researcher', '연구자를 찾을 수 없어요.', 404);
  await col('users').doc(x.id).update({ verified: true });
  mailTo(ctx.w, x, { subject: `[${SITE}] 연구자 확인이 완료되었어요`, text: `${x.name} 님, 재학 정보와 연구윤리교육 이수증 확인이 끝났습니다. 이제 연구를 심사에 제출할 수 있습니다.` });
  st.log(ctx.w, ctx.user, `연구자 확인: ${x.name} (${x.program})`);
  return { toast: `${x.name} 님을 확인했어요. 이제 심사 제출이 열립니다.` };
});

// 심사 결과를 기록한다. 두 사람이 동시에 눌러도 한 번만 처리되도록 상태를 확인하고 바꾼다.
async function decide(studyId, fieldsFor) {
  return db.runTransaction(async (t) => {
    const ref = col('studies').doc(String(studyId || ''));
    const snap = await t.get(ref);
    need(snap.exists && snap.get('status') === 'review', '심사 중인 연구가 아니에요.');
    const study = st.studyFromRow({ id: snap.id, ...snap.data() });
    t.update(ref, fieldsFor(study));
    return study;
  });
}

def('approve', ['admin'], async (ctx, p) => {
  const now = Date.now();
  const today = D.toYMD(now);
  const study = await decide(p.id, (s) => {
    need(s.irbUntil >= today && s.end >= today, 'IRB 승인 기간이나 모집 마감일이 이미 지났어요. 보완 요청으로 돌려보내 주세요.');
    return { status: 'recruiting', approved_at: now, updated_at: now, ...(s.start > today ? { 'doc.start': today } : {}) };
  });
  let n = 0;
  if (p.notify !== false) {
    const targets = (await st.participants()).filter((x) => x.active && D.matches(study, x.profile, now) && st.noticeCount(x, now) < D.WEEKLY_NOTICE_LIMIT);
    const users = await st.usersByIds(targets.map((x) => x.id));
    for (const u of users.values()) {
      st.deliver(ctx.w, u, { studyId: study.id, kind: 'newstudy', channel: 'email', subject: `[${SITE}] 조건에 맞는 새 연구가 열렸어요`, body: `${study.title} 연구가 모집을 시작했습니다.\n${D.TYPES[study.type]} · 약 ${study.minutes}분 · ${D.rewardText(study)}\n로그인해서 연구설명문을 확인해 보세요.` });
      n++;
    }
    st.sendLog(ctx.w, study.id, '새 연구 안내', '이메일', '승인 시 자동 안내', n, '조건에 맞는 새 연구가 열렸어요');
  }
  mailTo(ctx.w, await st.userById(study.ownerRowId), { subject: `[${SITE}] 연구가 승인되어 공개되었어요`, text: `${study.title} 연구가 승인되어 모집을 시작했습니다.${n ? ` 조건에 맞는 대기풀 ${n}명에게 안내가 나갔습니다.` : ''}` });
  st.log(ctx.w, ctx.user, `연구 승인·공개: ${study.title}${n ? ` · 대기풀 ${n}명 안내` : ''}`);
  return { toast: `승인했어요.${n ? ` 대기풀 ${n}명에게 안내가 나갔어요.` : ''}` };
});

def('reject', ['admin'], async (ctx, p) => {
  const c = D.text(p.comment, 2000).trim();
  need(c, '연구자에게 보낼 의견을 적어 주세요.');
  const study = await decide(p.id, () => ({ status: 'rejected', review_comment: c, updated_at: Date.now() }));
  mailTo(ctx.w, await st.userById(study.ownerRowId), { subject: `[${SITE}] 연구에 보완 요청이 있어요`, text: `${study.title}\n\n연구지원팀 의견\n${c}\n\n${SITE}에서 내용을 고친 뒤 다시 제출해 주세요.` });
  st.log(ctx.w, ctx.user, `보완 요청: ${study.title}`);
  return { toast: '보완 요청을 보냈어요.' };
});

// 모바일 상품권을 실제로 보낸 뒤 표시한다. 이때 참여자에게 "발송되었습니다" 문자가 나간다.
def('rewardSent', ['admin'], async (ctx, p) => {
  const ids = Array.isArray(p.ids) ? p.ids.map(String) : [];
  let n = 0;
  for (const id of ids) {
    const e = await db.runTransaction(async (t) => {
      const ref = col('enrollments').doc(id);
      const snap = await t.get(ref);
      if (!snap.exists || snap.get('status') !== 'paid' || snap.get('reward_sent_at')) return null;
      t.update(ref, { reward_sent_at: Date.now(), reward_queue: 'sent' });
      return { id: snap.id, ...snap.data() };
    });
    if (!e) continue;
    const [study, u] = await Promise.all([st.getStudy(e.study_id), st.userById(e.user_id)]);
    st.invalidateEnr(e.study_id);
    if (u) st.deliver(ctx.w, u, { studyId: study.id, kind: 'reward', channel: 'sms', body: `[한신리서치풀] 연구 참여 보상 ${D.rewardText(study)}이 발송되었습니다.` });
    st.log(ctx.w, ctx.user, `상품권 발송 완료 ${e.pid} (${study.title})`, e.pid);
    n++;
  }
  need(n, '발송 처리할 건이 없어요.');
  return { toast: `${n}건을 발송 완료로 표시했어요.` };
});

async function runAction(name, ctx, payload) {
  const action = A[name];
  if (!action) throw new AppError('알 수 없는 요청이에요.', 404);
  if (action.roles) {
    if (!ctx.user) throw new AppError('로그인이 필요해요.', 401);
    if (!action.roles.includes(ctx.user.role)) throw new AppError('이 작업을 할 수 있는 계정이 아니에요.', 403);
  }
  ctx.w = st.writer();
  try {
    return await action.fn(ctx, payload || {});
  } finally {
    await ctx.w.close(); // 알림함·발송 이력·처리 기록이 모두 저장된 뒤에 응답한다.
  }
}

module.exports = { runAction, readFile, actionNames: Object.keys(A) };
