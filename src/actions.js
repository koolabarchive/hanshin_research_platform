// 화면에서 일어나는 모든 "동작"을 서버에서 처리한다.
// 각 동작은 누가 할 수 있는지(roles)를 먼저 확인하고, 대상이 그 사람 것인지 다시 확인한 뒤 실행한다.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, get, all, run } = require('./db');
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
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');

// 연구자·관리자에게 보내는 업무 메일. 시연용 가상 계정에는 실제로 보내지 않는다(그 주소가 실제 사람의 것일 수 있다).
const mailTo = (user, msg) => {
  if (user && !user.synthetic) sendMail({ to: user.email, ...msg });
};

const need = (cond, msg, status = 400) => {
  if (!cond) throw new AppError(msg, status);
};

// ── 파일 ───────────────────────────────────────────────────
// 이수증·IRB 승인 통지서. 확장자가 아니라 파일 앞부분(매직 넘버)으로 형식을 확인한다.
const MAGIC = [
  ['application/pdf', '.pdf', (b) => b.subarray(0, 5).toString('latin1') === '%PDF-'],
  ['image/png', '.png', (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['image/jpeg', '.jpg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
];
function saveFile(ownerId, kind, file, { pdfOnly = false } = {}) {
  need(file && typeof file.data === 'string' && file.name, '파일을 첨부해 주세요.');
  const buf = Buffer.from(file.data, 'base64');
  need(buf.length > 0 && buf.length <= 5 * 1024 * 1024, '파일은 5MB 이하만 올릴 수 있어요.');
  const hit = MAGIC.find(([, , test]) => test(buf));
  need(hit && (!pdfOnly || hit[0] === 'application/pdf'), pdfOnly ? 'PDF 파일만 올릴 수 있어요.' : 'PDF, JPG, PNG 파일만 올릴 수 있어요.');
  const id = st.randomId('f');
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, id), buf, { mode: 0o600 });
  const name = D.line(path.basename(String(file.name)), 120) || `file${hit[1]}`;
  run('INSERT INTO files (id, owner_id, kind, name, mime, path, size, created_at) VALUES (?,?,?,?,?,?,?,?)', id, ownerId, kind, name, hit[0], id, buf.length, Date.now());
  return { id, name };
}

// ── 이메일 인증번호 ─────────────────────────────────────────
function issueCode(email, purpose) {
  const code = String(crypto.randomInt(100000, 1000000));
  run('INSERT OR REPLACE INTO email_codes (email, purpose, code_hash, expires_at, attempts) VALUES (?,?,?,?,0)', email, purpose, sha256(`${email}:${code}`), Date.now() + 10 * 60e3);
  return code;
}
function checkCode(email, purpose, code) {
  const row = get('SELECT * FROM email_codes WHERE email = ? AND purpose = ?', email, purpose);
  need(row && row.expires_at > Date.now() && row.attempts < 5, '인증번호가 만료되었어요. 다시 받아 주세요.');
  if (!safeEqual(row.code_hash, sha256(`${email}:${String(code || '').trim()}`))) {
    run('UPDATE email_codes SET attempts = attempts + 1 WHERE email = ? AND purpose = ?', email, purpose);
    throw new AppError('인증번호가 맞지 않아요.');
  }
}
const consumeCode = (email, purpose) => run('DELETE FROM email_codes WHERE email = ? AND purpose = ?', email, purpose);

// ── 공통 조회 ───────────────────────────────────────────────
function ownStudy(user, id, statuses) {
  const study = st.getStudy(id);
  need(study && study.ownerRowId === user.id, '연구를 찾을 수 없어요.', 404);
  if (statuses) need(statuses.includes(study.status), '지금 상태에서는 할 수 없는 작업이에요.');
  return study;
}
function ownEnrollment(user, id) {
  const e = get('SELECT * FROM enrollments WHERE id = ? AND user_id = ?', String(id || ''), user.id);
  need(e, '참여 기록을 찾을 수 없어요.', 404);
  return e;
}
const myEnrollment = (user, studyId) => get('SELECT * FROM enrollments WHERE study_id = ? AND user_id = ?', studyId, user.id);
const doneCount = (studyId) => get(`SELECT COUNT(*) n FROM enrollments WHERE study_id = ? AND status IN ('completed','paid')`, studyId).n;
const freeSlot = (slotId) => slotId && run('UPDATE slots SET booked = MAX(0, booked - 1) WHERE id = ?', slotId);

function persistDraft(user, raw) {
  need(raw && typeof raw === 'object', '저장할 내용이 없어요.');
  const now = Date.now();
  const d = D.sanitizeDraft(raw, now);
  const { slots, ...doc } = d;
  let id = String(raw.id || '');
  const row = id ? get('SELECT * FROM studies WHERE id = ?', id) : null;
  let fileId = null;
  if (raw.irbFileId) {
    const f = get(`SELECT id FROM files WHERE id = ? AND owner_id = ? AND kind = 'irb'`, String(raw.irbFileId), user.id);
    if (f) fileId = f.id;
  }
  if (row) {
    need(row.owner_id === user.id, '연구를 찾을 수 없어요.', 404);
    need(['draft', 'rejected'].includes(row.status), '심사 중이거나 공개된 연구는 고칠 수 없어요.');
    doc.notices = JSON.parse(row.doc).notices || [];
    run('UPDATE studies SET doc = ?, irb_file_id = ?, updated_at = ? WHERE id = ?', JSON.stringify(doc), fileId, now, id);
  } else {
    id = st.randomId('s');
    doc.notices = [];
    run('INSERT INTO studies (id, owner_id, status, doc, irb_file_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', id, user.id, 'draft', JSON.stringify(doc), fileId, now, now);
    st.log(user, `연구 작성 시작: ${doc.title || '제목 없는 연구'}`);
  }
  // 초안 단계에는 예약자가 없으므로 예약 시간을 통째로 바꿔도 된다.
  run('DELETE FROM slots WHERE study_id = ?', id);
  for (const s of slots) run('INSERT INTO slots (id, study_id, at, cap) VALUES (?,?,?,?)', st.randomId('slot'), id, s.at, s.cap);
  return { id, doc: d, fileId };
}

const A = {};
const def = (name, roles, fn) => {
  A[name] = { roles, fn };
};

// ════════════ 로그인·가입 ════════════
def('sendCode', null, (ctx, p) => {
  const email = D.line(p.email, 120).toLowerCase();
  const purpose = p.purpose === 'reset' ? 'reset' : 'signup';
  need(EMAIL_RE.test(email), '이메일 주소를 확인해 주세요.');
  need(auth.rateLimit(`code:${ctx.req.ip}`, 10, 3600e3) && auth.rateLimit(`code:${email}`, 5, 3600e3), '인증번호 요청이 너무 많아요. 잠시 후 다시 시도해 주세요.', 429);
  if (purpose === 'signup' && p.role === 'researcher') need(isCampusEmail(email), `연구자는 학교 이메일(@${campusDomains()[0]})로만 가입할 수 있어요.`);
  const exists = !!get(`SELECT 1 FROM users WHERE email = ?`, email);
  let devCode;
  // 재설정은 가입된 주소에만 보내되, 화면 응답은 같게 해서 가입 여부를 알 수 없게 한다.
  if (purpose === 'signup' || exists) {
    const code = issueCode(email, purpose);
    sendMail({ to: email, subject: `[${SITE}] 인증번호 ${code}`, text: `인증번호는 ${code} 입니다. 10분 안에 입력해 주세요.\n본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다.` });
    if (!mailConfigured() && process.env.NODE_ENV !== 'production') devCode = code;
  }
  return { toast: devCode ? `인증번호 ${devCode} (메일 서버를 연결하지 않은 개발 환경이라 화면에 표시합니다)` : `${email}로 인증번호를 보냈어요. 10분 안에 입력해 주세요.` };
});

def('signup', null, (ctx, p) => {
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
    cols = { role: 'participant', pid: st.newPid(), profile_enc: st.encryptJSON(profile), affiliation: campus ? 'campus' : 'external', contact_sms: p.sms !== false ? 1 : 0, pool_joined: p.a3 !== false ? 1 : 0, pool_since: now, verified: 1 };
  } else {
    need(isCampusEmail(email), `연구자는 학교 이메일(@${campusDomains()[0]})로만 가입할 수 있어요.`);
    const dept = D.line(p.rdept, 60);
    const advisor = D.line(p.adv, 40);
    need(dept && advisor && /^\d{4}-\d{2}-\d{2}$/.test(String(p.eth || '')), '소속, 지도교수, 윤리교육 이수일을 입력해 주세요.');
    need(p.ethFile && p.ethFile.data, '연구윤리교육 이수증을 첨부해 주세요.');
    cols = { role: 'researcher', program: D.PROGRAMS.includes(p.prog) ? p.prog : '석사과정', dept, advisor, ethics_date: p.eth, verified: 0 };
  }
  checkCode(email, 'signup', p.code);
  need(!get('SELECT 1 FROM users WHERE email = ?', email), '이미 가입된 이메일이에요. 로그인해 주세요.');
  const base = { email, password_hash: hashPassword(String(p.pw)), pii_enc: st.encryptJSON({ name, phone }), joined_at: now, ...cols };
  const keys = Object.keys(base);
  const info = run(`INSERT INTO users (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => base[k]));
  const id = info.lastInsertRowid;
  if (!isP) {
    const file = saveFile(id, 'ethics', p.ethFile);
    run('UPDATE users SET ethics_file_id = ? WHERE id = ?', file.id, id);
  }
  consumeCode(email, 'signup');
  st.invalidatePool();
  const user = st.userById(id);
  st.log(user, isP ? `참여자 회원가입${cols.pool_joined ? ' · 대기풀 등록' : ''}` : '연구자 회원가입 (재학·이수증 확인 대기)');
  auth.login(ctx.res, id);
  ctx.user = user;
  return { toast: isP ? `가입을 마쳤어요. 가명 ID는 ${user.pid}입니다.` : '가입을 마쳤어요. 연구지원팀 확인 후 심사 제출이 열립니다.' };
});

def('login', null, (ctx, p) => {
  const email = D.line(p.email, 120).toLowerCase();
  const key = `login:${ctx.req.ip}:${email}`;
  need(auth.rateLimit(key, 6, 15 * 60e3), '로그인 시도가 너무 많아요. 15분 뒤에 다시 시도해 주세요.', 429);
  const user = st.userByEmail(email);
  need(user && verifyPassword(String(p.pw || ''), user.password_hash), '이메일 또는 비밀번호가 맞지 않아요.');
  auth.clearRateLimit(key);
  auth.login(ctx.res, user.id);
  ctx.user = user;
  return {};
});

// 시연용 계정으로 바로 들어가기. DEMO_MODE=1이고 운영 환경이 아닐 때만 열린다.
def('demoLogin', null, (ctx, p) => {
  need(demoMode(), '시연 모드가 아니에요.', 404);
  const email = { participant: 'haeun.lee@hs.ac.kr', researcher: 'seoyun.kim@hs.ac.kr', admin: 'research-ethics@hs.ac.kr' }[p.who];
  const user = email && st.userByEmail(email);
  need(user && user.synthetic, '시연용 계정이 없어요. npm run seed 를 먼저 실행해 주세요.', 404);
  auth.login(ctx.res, user.id);
  ctx.user = user;
  return {};
});

def('logout', null, (ctx) => {
  auth.logout(ctx.req, ctx.res);
  ctx.user = null;
  return {};
});

def('resetPassword', null, (ctx, p) => {
  const email = D.line(p.email, 120).toLowerCase();
  need(auth.rateLimit(`reset:${ctx.req.ip}`, 10, 3600e3), '시도가 너무 많아요. 잠시 후 다시 시도해 주세요.', 429);
  need(String(p.pw || '').length >= 10 && String(p.pw).length <= 200, '새 비밀번호는 10자 이상이어야 해요.');
  checkCode(email, 'reset', p.code);
  const user = st.userByEmail(email);
  need(user, '인증번호가 맞지 않아요.');
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(String(p.pw)), user.id);
  run('DELETE FROM sessions WHERE user_id = ?', user.id);
  consumeCode(email, 'reset');
  st.log(user, '비밀번호 재설정');
  return { toast: '비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.' };
});

// ════════════ 연구자 ════════════
def('uploadIrb', ['researcher'], (ctx, p) => {
  const file = saveFile(ctx.user.id, 'irb', p.file, { pdfOnly: true });
  return { file };
});

def('saveDraft', ['researcher'], (ctx, p) => {
  const { id } = persistDraft(ctx.user, p.draft);
  return { id, toast: '임시 저장했어요. 내 연구 목록에서 이어서 작성할 수 있어요.' };
});

def('submitStudy', ['researcher'], (ctx, p) => {
  need(ctx.user.verified, '연구지원팀의 연구자 확인이 끝나면 제출할 수 있어요.');
  need(p.pledge, 'IRB 승인 내용과 같은지 확인란에 체크해 주세요.');
  const { id, doc, fileId } = persistDraft(ctx.user, p.draft);
  const miss = D.checks(doc, fileId).filter((c) => !c[1]).map((c) => c[0]);
  need(!miss.length, `채워야 할 항목: ${miss.join(', ')}`);
  run(`UPDATE studies SET status = 'review', submitted_at = ?, review_comment = NULL WHERE id = ?`, Date.now(), id);
  st.log(ctx.user, `심사 제출: ${doc.title}`);
  return { id, toast: '심사에 제출했어요. 결과는 이 화면과 할 일 목록에서 확인할 수 있어요.' };
});

def('closeStudy', ['researcher'], (ctx, p) => {
  const study = ownStudy(ctx.user, p.id, ['recruiting']);
  run(`UPDATE studies SET status = 'closed', updated_at = ? WHERE id = ?`, Date.now(), study.id);
  st.log(ctx.user, `모집 마감: ${study.title}`);
  return { toast: '모집을 마감했어요.' };
});

def('markDone', ['researcher'], (ctx, p) => {
  const e = get('SELECT * FROM enrollments WHERE id = ?', String(p.id || ''));
  need(e, '참여 기록을 찾을 수 없어요.', 404);
  const study = ownStudy(ctx.user, e.study_id);
  need(e.status === 'scheduled', '일정이 확정된 참여자만 완료 처리할 수 있어요.');
  run(`UPDATE enrollments SET status = 'completed', completed_at = ? WHERE id = ?`, Date.now(), e.id);
  const u = st.userById(e.user_id);
  st.deliver(u, { studyId: study.id, kind: 'complete', channel: 'email', subject: `[${SITE}] 참여해 주셔서 감사합니다`, body: `${study.title} 연구 참여가 완료되었습니다.\n보상(${D.rewardText(study)})은 ${study.reward.timing} 처리됩니다.` });
  st.log(ctx.user, `참여 완료 처리 ${u.pid} (${study.title})`, u.pid);
  return { toast: `${u.pid} 참여 완료로 바꿨어요.` };
});

def('sendInvites', ['researcher'], (ctx, p) => {
  const study = ownStudy(ctx.user, p.id, ['recruiting']);
  const pool = D.shuffle(st.eligibleForInvite(study));
  const n = Math.max(0, Math.min(pool.length, Math.round(Number(p.n)) || 0));
  need(n > 0, '초대 인원을 1명 이상 입력해 주세요.');
  const ch = ['both', 'email', 'sms'].includes(p.ch) ? p.ch : 'both';
  let msgs = 0;
  for (const pu of pool.slice(0, n)) {
    const u = st.userById(pu.id);
    run(`INSERT INTO enrollments (id, study_id, user_id, status, source, invited_at) VALUES (?,?,?,'invited','invite',?)`, st.randomId('e'), study.id, u.id, Date.now());
    msgs += st.deliver(u, { studyId: study.id, kind: 'invite', channel: ch, subject: D.fillTpl(study.templates.inviteSubject, study, u.pid), body: D.fillTpl(study.templates.inviteBody, study, u.pid), sms: D.fillTpl(study.templates.sms, study, u.pid) });
  }
  st.sendLog(study.id, '초대', D.CHANNEL_LABEL[ch], '대기풀 조건 일치', n, D.fillTpl(study.templates.inviteSubject, study, null));
  st.log(ctx.user, `대기풀 초대 ${n}명 (${study.title})`);
  return { toast: `${n}명에게 초대를 보냈어요. 메시지 ${msgs}건이 발송 기록에 남았어요.` };
});

def('sendCompose', ['researcher'], (ctx, p) => {
  const study = ownStudy(ctx.user, p.id, ['recruiting', 'closed']);
  const seg = D.SEGMENTS[p.seg];
  const ch = ['both', 'email', 'sms'].includes(p.ch) ? p.ch : 'sms';
  const body = D.text(p.body, 2000).trim();
  const subj = D.line(p.subj, 200) || `[${SITE}] ${study.title} 안내`;
  need(seg, '받는 사람을 골라 주세요.');
  need(body, '내용을 입력해 주세요.');
  // 참여자가 같은 연구에서 안내를 지나치게 많이 받지 않도록 한다.
  const today = get(`SELECT COUNT(*) n FROM send_logs WHERE study_id = ? AND kind = '안내' AND at > ?`, study.id, Date.now() - D.DAY).n;
  need(today < 3, '한 연구에서 직접 보내는 안내는 하루 3번까지 가능해요.');
  const targets = st.enrollmentsOf(study.id).filter(seg[1]);
  need(targets.length, '보낼 대상이 없어요.');
  let msgs = 0;
  for (const e of targets) {
    const u = st.userById(e.user_id);
    const filled = D.fillTpl(body, study, u.pid);
    msgs += st.deliver(u, { studyId: study.id, kind: 'reminder', channel: ch, subject: D.fillTpl(subj, study, u.pid), body: filled, sms: filled });
  }
  st.sendLog(study.id, '안내', D.CHANNEL_LABEL[ch], seg[0], targets.length, ch === 'sms' ? body.slice(0, 40) : subj);
  st.log(ctx.user, `안내 발송 ${targets.length}명 · ${seg[0]} (${study.title})`);
  return { toast: `${targets.length}명에게 보냈어요. (메시지 ${msgs}건)` };
});

def('addNotice', ['researcher'], (ctx, p) => {
  const study = ownStudy(ctx.user, p.id, ['recruiting', 'closed']);
  const title = D.line(p.title, 120);
  const body = D.text(p.body, 2000).trim();
  need(title && body, '제목과 내용을 입력해 주세요.');
  study.notices = [...(study.notices || []), { id: st.randomId('n'), at: Date.now(), title, body }];
  st.writeStudyDoc(study.id, study);
  let n = 0;
  if (p.notify !== false) {
    for (const e of st.enrollmentsOf(study.id).filter((x) => D.ACTIVE.includes(x.status))) {
      st.deliver(st.userById(e.user_id), { studyId: study.id, kind: 'notice', channel: 'email', subject: `[공지] ${title}`, body });
      n++;
    }
    st.sendLog(study.id, '공지', '이메일', '동의 완료 이상', n, `[공지] ${title}`);
  }
  st.log(ctx.user, `공지 등록: ${title} (${study.title})`);
  return { toast: n ? `공지를 등록하고 ${n}명에게 알렸어요.` : '공지를 등록했어요.' };
});

def('setReminder', ['researcher'], (ctx, p) => {
  const study = ownStudy(ctx.user, p.id, ['recruiting', 'closed']);
  need(['remind3', 'remindEnd'].includes(p.key), '알 수 없는 설정이에요.');
  study.templates[p.key] = !!p.value;
  st.writeStudyDoc(study.id, study);
  return { toast: '자동 리마인더 설정을 저장했어요.' };
});

def('pay', ['researcher'], (ctx, p) => {
  const study = ownStudy(ctx.user, p.id, ['recruiting', 'closed']);
  need(study.reward.amount > 0, '보상이 없는 연구예요.');
  const ids = new Set(Array.isArray(p.ids) ? p.ids.map(String) : []);
  const rows = st.enrollmentsOf(study.id).filter((e) => e.status === 'completed' && ids.has(e.id));
  need(rows.length, '지급할 건을 골라 주세요.');
  const gift = study.reward.type === '모바일 상품권';
  for (const e of rows) {
    run(`UPDATE enrollments SET status = 'paid', paid_at = ? WHERE id = ?`, Date.now(), e.id);
    const u = st.userById(e.user_id);
    // 상품권은 번호를 아는 연구지원팀이 실제로 보낸 뒤에 "발송되었습니다" 문자가 나간다.
    st.deliver(u, gift
      ? { studyId: study.id, kind: 'reward', channel: 'email', subject: `[${SITE}] 보상 지급이 접수되었어요`, body: `${study.title} 연구의 참여 보상(${D.rewardText(study)}) 지급이 접수되었습니다.\n연구지원팀이 영업일 기준 3일 안에 등록하신 휴대전화 번호로 모바일 상품권을 보내 드립니다.` }
      : { studyId: study.id, kind: 'reward', channel: 'sms', body: `[한신리서치풀] 연구 참여 보상 ${D.rewardText(study)} 지급이 처리되었습니다.` });
    st.log(ctx.user, `보상 지급 처리 ${u.pid} (${study.title})`, u.pid);
  }
  return { toast: gift ? `${rows.length}건을 지급 처리했어요. 상품권은 연구지원팀이 발송합니다.` : `${rows.length}건을 지급 처리했어요.` };
});

// 지급 대장·응답 데이터를 내려받은 사실을 기록한다(자료는 화면이 이미 받은 범위 안에서 만든다).
def('logExport', ['researcher'], (ctx, p) => {
  const study = ownStudy(ctx.user, p.id);
  st.log(ctx.user, p.kind === 'ledger' ? `지급 대장 복사 (${study.title})` : `응답 데이터 열람·복사 (${study.title})`);
  return {};
});

def('replyInquiry', ['researcher'], (ctx, p) => {
  const q = get('SELECT * FROM inquiries WHERE id = ?', String(p.id || ''));
  need(q && !q.reported, '문의를 찾을 수 없어요.', 404);
  const study = ownStudy(ctx.user, q.study_id);
  const body = D.text(p.body, 2000).trim();
  need(body, '답변 내용을 입력해 주세요.');
  run('UPDATE inquiries SET reply = ?, replied_at = ? WHERE id = ?', body, Date.now(), q.id);
  st.deliver(st.userById(q.user_id), { studyId: study.id, kind: 'reply', channel: 'email', subject: `[${SITE}] 문의에 연구자가 답했어요 — ${study.title}`, body: `보내신 문의\n${q.body}\n\n연구자의 답변\n${body}` });
  return { toast: '답변을 보냈어요. 참여자의 알림함과 이메일로 전달됩니다.' };
});

// 부적절한 문의는 연구자 화면에서 가리고 연구지원팀에 알린다.
def('reportInquiry', ['researcher'], (ctx, p) => {
  const q = get('SELECT i.*, u.pid FROM inquiries i JOIN users u ON u.id = i.user_id WHERE i.id = ?', String(p.id || ''));
  need(q, '문의를 찾을 수 없어요.', 404);
  const study = ownStudy(ctx.user, q.study_id);
  run('UPDATE inquiries SET reported = 1 WHERE id = ?', q.id);
  st.log(ctx.user, `부적절한 문의 신고 ${q.pid} (${study.title})`, q.pid);
  return { toast: '신고했어요. 내용은 가려지고 연구지원팀이 확인합니다.' };
});

// ════════════ 참여자 ════════════
def('apply', ['participant'], (ctx, p) => {
  const u = ctx.user;
  const study = st.getStudy(p.studyId);
  need(study && ['recruiting', 'closed'].includes(study.status), '연구를 찾을 수 없어요.', 404);
  const e = myEnrollment(u, study.id);
  if (e) return {};
  need(study.status === 'recruiting', '모집이 끝난 연구예요.');
  need(D.matches(study, u.profile), '참여 조건에 맞지 않아요.');
  need(doneCount(study.id) < study.target, '모집 인원이 모두 찼어요.');
  run(`INSERT INTO enrollments (id, study_id, user_id, status, source, invited_at) VALUES (?,?,?,'invited','self',?)`, st.randomId('e'), study.id, u.id, Date.now());
  return {};
});

def('consent', ['participant'], (ctx, p) => {
  const u = ctx.user;
  const study = st.getStudy(p.studyId);
  const e = study && myEnrollment(u, study.id);
  need(e && e.status === 'invited', '동의할 수 있는 상태가 아니에요.');
  need(study.status === 'recruiting', '모집이 끝난 연구예요.');
  need(doneCount(study.id) < study.target, '모집 인원이 모두 찼어요.');
  const items = study.consent.filter((c) => c.trim());
  need(Array.isArray(p.checks) && study.consent.every((c, i) => !c.trim() || p.checks[i] === true), '모든 동의 항목에 체크해야 참여할 수 있어요.');
  const signature = D.line(p.signature, 30);
  need(signature === u.name, '서명란에 가입할 때 등록한 이름을 입력해 주세요.');
  const now = Date.now();
  run(`UPDATE enrollments SET status = 'consented', consent_at = ?, signature_enc = ?, consent_doc_enc = ?, consent_version = ? WHERE id = ?`,
    now, st.encryptJSON(signature), st.encryptJSON({ title: study.title, irbNo: study.irbNo, items }), D.fmtD(study.updatedAt), e.id);
  if (study.consentCopy && p.copy !== false) {
    st.deliver(u, { studyId: study.id, kind: 'consent', channel: 'email', subject: `[${SITE}] 연구참여 동의서 사본 — ${study.title}`, body: `서명 일시: ${D.fmtD(now)} ${D.fmtDT(now).split(' ')[1]}\n서명: ${signature}\n\n${items.map((c, i) => `${i + 1}. ${c} — 동의`).join('\n')}\n\n철회는 ${SITE} > 내 참여 기록에서 언제든 할 수 있습니다.` });
  }
  st.log(u, `전자동의 서명 (${study.title})`);
  return {};
});

def('finish', ['participant'], (ctx, p) => {
  const u = ctx.user;
  const study = st.getStudy(p.studyId);
  const e = study && myEnrollment(u, study.id);
  need(e && e.status === 'consented', '먼저 동의를 마쳐 주세요.');
  need(['recruiting', 'closed'].includes(study.status), '지금은 참여할 수 없는 연구예요.');
  const now = Date.now();
  let responses = null;
  if (study.survey.length) {
    responses = D.cleanAnswers(study.survey, p.answers);
    const miss = study.survey.findIndex((q) => q.required && !D.hasAns(responses[q.id]));
    need(miss < 0, `${miss + 1}번 문항에 답해 주세요.`);
  }
  if (study.slots.length) {
    const slot = study.slots.find((s) => s.id === p.slotId);
    need(slot && slot.at > now, '시간을 하나 골라 주세요.');
    // 남은 자리가 있을 때만 한 자리를 차지한다(동시에 신청해도 정원을 넘지 않는다).
    const took = run('UPDATE slots SET booked = booked + 1 WHERE id = ? AND booked < cap', slot.id);
    need(took.changes === 1, '방금 그 시간이 마감됐어요. 다른 시간을 골라 주세요.');
    run(`UPDATE enrollments SET status = 'scheduled', slot_id = ?, responses_enc = ? WHERE id = ?`, slot.id, responses ? st.encryptJSON(responses) : null, e.id);
    st.deliver(u, { studyId: study.id, kind: 'schedule', channel: 'both', subject: `[${SITE}] 일정이 확정되었어요`, body: `${study.title}\n일시: ${D.fmtDT(slot.at)}\n장소: ${study.location}\n\n일정을 바꿔야 하면 연구 화면의 '연구자에게 문의하기'를 이용해 주세요.`, sms: `[한신리서치풀] 일정 확정 ${D.fmtDT(slot.at)} ${study.location}` });
    st.log(u, `일정 예약 ${D.fmtDT(slot.at)} (${study.title})`);
  } else {
    run(`UPDATE enrollments SET status = 'completed', completed_at = ?, responses_enc = ? WHERE id = ?`, now, responses ? st.encryptJSON(responses) : null, e.id);
    st.deliver(u, { studyId: study.id, kind: 'complete', channel: 'email', subject: `[${SITE}] 참여해 주셔서 감사합니다`, body: `${study.title} 연구 참여가 완료되었습니다.\n보상(${D.rewardText(study)})은 ${study.reward.timing} 처리됩니다.` });
    st.log(u, `설문 완료 (${study.title})`);
  }
  return {};
});

def('withdraw', ['participant'], (ctx, p) => {
  const u = ctx.user;
  const e = ownEnrollment(u, p.id);
  need(e.status !== 'withdrawn', '이미 철회한 연구예요.');
  const study = st.getStudy(e.study_id);
  if (e.status === 'scheduled') freeSlot(e.slot_id);
  const destroy = p.choice !== 'keep';
  run(`UPDATE enrollments SET status = 'withdrawn', withdrawn_at = ?, data_choice = ?, responses_enc = CASE WHEN ? THEN NULL ELSE responses_enc END WHERE id = ?`, Date.now(), destroy ? '폐기' : '보관', destroy ? 1 : 0, e.id);
  st.deliver(u, { studyId: study.id, kind: 'withdraw', channel: 'email', subject: `[${SITE}] 참여 철회가 처리되었어요`, body: `${study.title} 연구 참여를 철회했습니다.\n제출한 응답: ${destroy ? '폐기' : '가명 상태로 보관'}` });
  st.log(u, `참여 철회 · 자료 ${destroy ? '폐기' : '보관'} (${study.title})`);
  return { toast: '철회를 처리했어요.' };
});

def('ask', ['participant'], (ctx, p) => {
  const u = ctx.user;
  const study = st.getStudy(p.studyId);
  need(study && ['recruiting', 'closed'].includes(study.status), '연구를 찾을 수 없어요.', 404);
  const e = myEnrollment(u, study.id);
  need((e && e.status !== 'withdrawn') || (study.status === 'recruiting' && D.matches(study, u.profile)), '이 연구에는 문의를 보낼 수 없어요.');
  const body = D.text(p.body, 1000).trim();
  need(body.length >= 5, '문의 내용을 조금 더 자세히 적어 주세요.');
  const recent = get('SELECT COUNT(*) n FROM inquiries WHERE user_id = ? AND at > ?', u.id, Date.now() - D.DAY).n;
  need(recent < 5, '문의는 하루 5번까지 보낼 수 있어요.');
  run('INSERT INTO inquiries (id, study_id, user_id, body, at) VALUES (?,?,?,?,?)', st.randomId('q'), study.id, u.id, body, Date.now());
  const owner = st.userById(study.ownerRowId);
  mailTo(owner, { subject: `[${SITE}] 새 문의가 도착했어요 — ${study.title}`, text: `참여자 ${u.pid} 님이 문의를 남겼습니다. ${SITE}에 로그인해 연구의 '문의' 탭에서 확인하고 답변해 주세요.` });
  return { toast: '문의를 보냈어요. 답변은 알림함과 이메일로 알려드릴게요.' };
});

function setPool(u, fields, note) {
  const keys = Object.keys(fields);
  run(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => fields[k]), u.id);
  st.invalidatePool();
  st.log(u, note);
}

def('togglePause', ['participant'], (ctx) => {
  const u = ctx.user;
  if (!u.pool_joined) {
    setPool(u, { pool_joined: 1, pool_paused: 0, pool_since: Date.now() }, '대기풀 등록');
    return { toast: '다시 안내를 받아요.' };
  }
  const paused = u.pool_paused ? 0 : 1;
  setPool(u, { pool_paused: paused }, `대기풀 ${paused ? '일시정지' : '안내 재개'}`);
  return { toast: paused ? '새 연구 안내를 잠시 멈췄어요.' : '다시 안내를 받아요.' };
});

def('setPref', ['participant'], (ctx, p) => {
  const u = ctx.user;
  const v = p.value ? 1 : 0;
  if (p.key === 'pool.joined') setPool(u, v ? { pool_joined: 1, pool_since: u.pool_since || Date.now() } : { pool_joined: 0 }, '대기풀 설정 변경');
  else if (p.key === 'pool.paused') setPool(u, { pool_paused: v }, '대기풀 설정 변경');
  else if (p.key === 'contact.sms') setPool(u, { contact_sms: v }, '안내 수신 방법 변경');
  else throw new AppError('알 수 없는 설정이에요.');
  return { toast: '저장했어요.' };
});

def('setProfileList', ['participant'], (ctx, p) => {
  const u = ctx.user;
  const allowed = { interests: D.INTERESTS, times: D.TIMES }[p.path];
  need(allowed && u.profile, '알 수 없는 항목이에요.');
  u.profile[p.path] = D.subset(p.values, allowed);
  run('UPDATE users SET profile_enc = ? WHERE id = ?', st.encryptJSON(u.profile), u.id);
  st.invalidatePool();
  return { toast: '저장했어요.' };
});

def('readMsg', ['participant'], (ctx, p) => {
  run('UPDATE messages SET read = 1 WHERE id = ? AND to_user_id = ?', String(p.id || ''), ctx.user.id);
  return {};
});
def('readAll', ['participant'], (ctx) => {
  run('UPDATE messages SET read = 1 WHERE to_user_id = ?', ctx.user.id);
  return {};
});

def('deleteAccount', ['participant'], (ctx) => {
  const u = ctx.user;
  // 진행 중인 참여는 철회하고 응답을 폐기한다. 이미 마친 연구의 가명 응답과 동의서는 법정 보관 기간 동안 남는다.
  for (const e of all(`SELECT * FROM enrollments WHERE user_id = ? AND status IN ('invited','consented','scheduled')`, u.id)) {
    if (e.status === 'scheduled') freeSlot(e.slot_id);
    run(`UPDATE enrollments SET status = 'withdrawn', withdrawn_at = ?, data_choice = '폐기', responses_enc = NULL WHERE id = ?`, Date.now(), e.id);
  }
  st.log(u, '회원 탈퇴');
  run(`UPDATE users SET status = 'deleted', email = ?, password_hash = ?, pii_enc = ?, profile_enc = NULL, pool_joined = 0, pool_paused = 1, contact_sms = 0 WHERE id = ?`,
    `deleted-${u.id}@deleted.invalid`, hashPassword(randomToken(24)), st.encryptJSON({ name: '(탈퇴)', phone: '' }), u.id);
  run('DELETE FROM sessions WHERE user_id = ?', u.id);
  run('DELETE FROM messages WHERE to_user_id = ?', u.id);
  run('DELETE FROM inquiries WHERE user_id = ?', u.id);
  st.invalidatePool();
  auth.logout(ctx.req, ctx.res);
  ctx.user = null;
  return { toast: '탈퇴를 처리했어요.' };
});

// ════════════ 관리자(연구윤리지원팀) ════════════
def('verify', ['admin'], (ctx, p) => {
  const id = Number(String(p.id || '').replace(/^r-/, ''));
  const x = st.hydrate(get(`SELECT * FROM users WHERE id = ? AND role = 'researcher'`, id));
  need(x, '연구자를 찾을 수 없어요.', 404);
  run('UPDATE users SET verified = 1 WHERE id = ?', x.id);
  mailTo(x, { subject: `[${SITE}] 연구자 확인이 완료되었어요`, text: `${x.name} 님, 재학 정보와 연구윤리교육 이수증 확인이 끝났습니다. 이제 연구를 심사에 제출할 수 있습니다.` });
  st.log(ctx.user, `연구자 확인: ${x.name} (${x.program})`);
  return { toast: `${x.name} 님을 확인했어요. 이제 심사 제출이 열립니다.` };
});

def('approve', ['admin'], (ctx, p) => {
  const study = st.getStudy(p.id);
  need(study && study.status === 'review', '심사 중인 연구가 아니에요.');
  const now = Date.now();
  need(study.irbUntil >= D.toYMD(now) && study.end >= D.toYMD(now), 'IRB 승인 기간이나 모집 마감일이 이미 지났어요. 보완 요청으로 돌려보내 주세요.');
  if (study.start > D.toYMD(now)) study.start = D.toYMD(now);
  st.writeStudyDoc(study.id, study);
  run(`UPDATE studies SET status = 'recruiting', approved_at = ? WHERE id = ?`, now, study.id);
  let n = 0;
  if (p.notify !== false) {
    const recent = st.recentNoticeCounts(now);
    for (const pu of st.participants().filter((x) => x.active && D.matches(study, x.profile, now) && (recent.get(x.id) || 0) < D.WEEKLY_NOTICE_LIMIT)) {
      st.deliver(st.userById(pu.id), { studyId: study.id, kind: 'newstudy', channel: 'email', subject: `[${SITE}] 조건에 맞는 새 연구가 열렸어요`, body: `${study.title} 연구가 모집을 시작했습니다.\n${D.TYPES[study.type]} · 약 ${study.minutes}분 · ${D.rewardText(study)}\n로그인해서 연구설명문을 확인해 보세요.` });
      n++;
    }
    st.sendLog(study.id, '새 연구 안내', '이메일', '승인 시 자동 안내', n, '조건에 맞는 새 연구가 열렸어요');
  }
  const owner = st.userById(study.ownerRowId);
  mailTo(owner, { subject: `[${SITE}] 연구가 승인되어 공개되었어요`, text: `${study.title} 연구가 승인되어 모집을 시작했습니다.${n ? ` 조건에 맞는 대기풀 ${n}명에게 안내가 나갔습니다.` : ''}` });
  st.log(ctx.user, `연구 승인·공개: ${study.title}${n ? ` · 대기풀 ${n}명 안내` : ''}`);
  return { toast: `승인했어요.${n ? ` 대기풀 ${n}명에게 안내가 나갔어요.` : ''}` };
});

def('reject', ['admin'], (ctx, p) => {
  const study = st.getStudy(p.id);
  need(study && study.status === 'review', '심사 중인 연구가 아니에요.');
  const c = D.text(p.comment, 2000).trim();
  need(c, '연구자에게 보낼 의견을 적어 주세요.');
  run(`UPDATE studies SET status = 'rejected', review_comment = ? WHERE id = ?`, c, study.id);
  const owner = st.userById(study.ownerRowId);
  mailTo(owner, { subject: `[${SITE}] 연구에 보완 요청이 있어요`, text: `${study.title}\n\n연구지원팀 의견\n${c}\n\n${SITE}에서 내용을 고친 뒤 다시 제출해 주세요.` });
  st.log(ctx.user, `보완 요청: ${study.title}`);
  return { toast: '보완 요청을 보냈어요.' };
});

// 모바일 상품권을 실제로 보낸 뒤 표시한다. 이때 참여자에게 "발송되었습니다" 문자가 나간다.
def('rewardSent', ['admin'], (ctx, p) => {
  const ids = Array.isArray(p.ids) ? p.ids.map(String) : [];
  let n = 0;
  for (const id of ids) {
    const e = get(`SELECT * FROM enrollments WHERE id = ? AND status = 'paid' AND reward_sent_at IS NULL`, id);
    if (!e) continue;
    const study = st.getStudy(e.study_id);
    run('UPDATE enrollments SET reward_sent_at = ? WHERE id = ?', Date.now(), e.id);
    const u = st.userById(e.user_id);
    st.deliver(u, { studyId: study.id, kind: 'reward', channel: 'sms', body: `[한신리서치풀] 연구 참여 보상 ${D.rewardText(study)}이 발송되었습니다.` });
    st.log(ctx.user, `상품권 발송 완료 ${u.pid} (${study.title})`, u.pid);
    n++;
  }
  need(n, '발송 처리할 건이 없어요.');
  return { toast: `${n}건을 발송 완료로 표시했어요.` };
});

// 동작 하나를 통째로 하나의 트랜잭션으로 실행한다. 중간에 실패하면 아무것도 바뀌지 않는다.
function runAction(name, ctx, payload) {
  const action = A[name];
  if (!action) throw new AppError('알 수 없는 요청이에요.', 404);
  if (action.roles) {
    if (!ctx.user) throw new AppError('로그인이 필요해요.', 401);
    if (!action.roles.includes(ctx.user.role)) throw new AppError('이 작업을 할 수 있는 계정이 아니에요.', 403);
  }
  return db.transaction(() => action.fn(ctx, payload || {}))();
}

module.exports = { runAction, UPLOAD_DIR, actionNames: Object.keys(A) };
