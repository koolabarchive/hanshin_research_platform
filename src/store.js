const { get, all, run } = require('./db');
const D = require('./domain');
const { encryptJSON, decryptJSON, randomId } = require('./security');
const { sendMail, sendSms } = require('./mailer');

class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// ── 사용자 ─────────────────────────────────────────────────
// 화면에 내보내는 사용자 ID. 참여자는 가명 ID 자체를 쓰므로 내부 번호가 밖으로 나가지 않는다.
const pubId = (row) => (row.role === 'participant' ? row.pid : `${row.role === 'admin' ? 'a' : 'r'}-${row.id}`);

function hydrate(row) {
  if (!row) return null;
  const pii = decryptJSON(row.pii_enc) || {};
  return { ...row, name: pii.name || '', phone: pii.phone || '', profile: row.profile_enc ? decryptJSON(row.profile_enc) : null, pub: pubId(row) };
}

const userById = (id) => hydrate(get('SELECT * FROM users WHERE id = ?', id));
const userByEmail = (email) => hydrate(get(`SELECT * FROM users WHERE email = ? AND status = 'active'`, email));

function newPid() {
  for (let i = 0; i < 50; i++) {
    const pid = `P-${1000 + Math.floor(Math.random() * 90000)}`;
    if (!get('SELECT 1 FROM users WHERE pid = ?', pid)) return pid;
  }
  throw new Error('가명 ID를 만들지 못했습니다.');
}

const maskPhone = (phone) => `010-****-${String(phone || '').replace(/\D/g, '').slice(-4) || '0000'}`;

// 대기풀 전체를 훑는 일이 잦아서(매칭 인원, 분포) 복호화한 목록을 잠깐 기억해 둔다.
// 사용자 정보가 바뀌면 invalidatePool()로 버린다.
let poolCache = null;
function participants() {
  if (!poolCache) {
    poolCache = all(`SELECT id, pid, profile_enc, contact_sms, pool_joined, pool_paused, synthetic FROM users WHERE role = 'participant' AND status = 'active'`).map((r) => ({
      id: r.id,
      pid: r.pid,
      profile: r.profile_enc ? decryptJSON(r.profile_enc) : null,
      sms: !!r.contact_sms,
      active: !!(r.pool_joined && !r.pool_paused),
    }));
  }
  return poolCache;
}
const invalidatePool = () => {
  poolCache = null;
};

// 최근 7일 동안 받은 모집 안내 수(사람별). 주 3회 제한에 쓴다.
function recentNoticeCounts(now = Date.now()) {
  const map = new Map();
  for (const r of all(`SELECT to_user_id AS id, COUNT(*) AS n FROM messages WHERE kind IN ('invite','newstudy') AND channel = 'email' AND at > ? GROUP BY to_user_id`, now - 7 * D.DAY)) {
    map.set(r.id, r.n);
  }
  return map;
}

// ── 연구 ───────────────────────────────────────────────────
function studyFromRow(row) {
  if (!row) return null;
  const doc = JSON.parse(row.doc);
  return {
    ...doc,
    id: row.id,
    ownerRowId: row.owner_id,
    status: row.status,
    irbFileId: row.irb_file_id || '',
    irbFile: row.irb_file_id ? (get('SELECT name FROM files WHERE id = ?', row.irb_file_id) || {}).name || '' : '',
    reviewComment: row.review_comment || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    approvedAt: row.approved_at,
    slots: all('SELECT id, at, cap, booked FROM slots WHERE study_id = ? ORDER BY at', row.id),
  };
}
const getStudy = (id) => studyFromRow(get('SELECT * FROM studies WHERE id = ?', String(id || '')));

function writeStudyDoc(id, study) {
  const { id: _i, ownerRowId, status, irbFileId, irbFile, reviewComment, createdAt, updatedAt, submittedAt, approvedAt, slots, ownerId, ...doc } = study;
  run('UPDATE studies SET doc = ?, updated_at = ? WHERE id = ?', JSON.stringify(doc), Date.now(), id);
}

const enrollmentsOf = (studyId) => all('SELECT * FROM enrollments WHERE study_id = ?', studyId);

// 조건에 맞고, 아직 이 연구와 엮이지 않았고, 이번 주 안내를 3번 미만으로 받은 대기풀 참여자
function eligibleForInvite(study, now = Date.now()) {
  const enrolled = new Set(all('SELECT user_id FROM enrollments WHERE study_id = ?', study.id).map((r) => r.user_id));
  const recent = recentNoticeCounts(now);
  return participants().filter((u) => u.active && D.matches(study, u.profile, now) && !enrolled.has(u.id) && (recent.get(u.id) || 0) < D.WEEKLY_NOTICE_LIMIT);
}
const poolMatchCount = (study, now = Date.now()) => participants().filter((u) => u.active && D.matches(study, u.profile, now)).length;

// ── 발송 ───────────────────────────────────────────────────
// 플랫폼 안의 알림함에 남기고, 실제 이메일·문자도 보낸다. 연구자는 수신자의 주소·번호를 알 수 없다.
function deliver(user, { studyId = null, kind, subject = '', body, sms, channel = 'both' }) {
  const at = Date.now();
  let n = 0;
  const wantEmail = channel === 'email' || channel === 'both' || (channel === 'sms' && !user.contact_sms);
  const wantSms = (channel === 'sms' || channel === 'both') && !!user.contact_sms;
  if (wantEmail) {
    run('INSERT INTO messages (id, to_user_id, study_id, kind, channel, subject, body, at) VALUES (?,?,?,?,?,?,?,?)', randomId('m'), user.id, studyId, kind, 'email', subject, body, at);
    if (!user.synthetic) sendMail({ to: user.email, subject, text: body });
    n++;
  }
  if (wantSms) {
    const textBody = sms || body;
    run('INSERT INTO messages (id, to_user_id, study_id, kind, channel, subject, body, at) VALUES (?,?,?,?,?,?,?,?)', randomId('m'), user.id, studyId, kind, 'sms', '', textBody, at);
    if (!user.synthetic && user.phone) sendSms({ to: user.phone, text: textBody });
    n++;
  }
  return n;
}

function sendLog(studyId, kind, channel, segment, count, subject) {
  run('INSERT INTO send_logs (id, study_id, at, kind, channel, segment, count, subject) VALUES (?,?,?,?,?,?,?,?)', randomId('l'), studyId, Date.now(), kind, channel, segment, count, String(subject || '').slice(0, 200));
}

const ROLE_NAME = { admin: '관리자', researcher: '연구자', participant: '참여자' };
// 처리 기록. 참여자는 실명이 아니라 가명 ID로 남긴다.
function log(actor, action, pid = null) {
  const name = !actor ? '시스템' : actor.role === 'participant' ? actor.pid : actor.name;
  run('INSERT INTO audit (at, actor_id, actor_name, role, action, pid) VALUES (?,?,?,?,?,?)', Date.now(), actor ? actor.id : null, name, actor ? ROLE_NAME[actor.role] : '', action, pid || (actor && actor.role === 'participant' ? actor.pid : null));
}

module.exports = {
  AppError, pubId, hydrate, userById, userByEmail, newPid, maskPhone, participants, invalidatePool, recentNoticeCounts,
  studyFromRow, getStudy, writeStudyDoc, enrollmentsOf, eligibleForInvite, poolMatchCount, deliver, sendLog, log,
  encryptJSON, decryptJSON, randomId,
};
