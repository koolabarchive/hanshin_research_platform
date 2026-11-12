const { db, col, getDoc, find, count, FieldValue } = require('./db');
const D = require('./domain');
const { encryptJSON, decryptJSON, randomId } = require('./security');
const { sendMail, sendSms } = require('./mailer');

class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// ── 쓰기 모음 ───────────────────────────────────────────────
// 알림함·발송 이력·처리 기록처럼 한 동작에서 여러 건이 나가는 쓰기는 모아서 보낸다.
// 상태를 바꾸는 핵심 쓰기(동의, 예약, 승인 등)는 각 동작에서 트랜잭션으로 따로 처리한다.
function writer() {
  const w = db.bulkWriter();
  w.onWriteError((err) => {
    if (err.code === 6) return false; // 이미 있는 문서(중복 초대 등)는 건너뛴다.
    return err.failedAttempts < 3;
  });
  return {
    set: (ref, data, opts) => void w.set(ref, data, opts || {}).catch(() => {}),
    create: (ref, data) => void w.create(ref, data).catch(() => {}),
    update: (ref, data) => void w.update(ref, data).catch(() => {}),
    delete: (ref) => void w.delete(ref).catch(() => {}),
    close: () => w.close(),
  };
}

// ── 사용자 ─────────────────────────────────────────────────
// 화면에 내보내는 사용자 ID. 참여자는 가명 ID 자체를 쓰므로 내부 문서 ID가 밖으로 나가지 않는다.
const pubId = (row) => (row.role === 'participant' ? row.pid : `${row.role === 'admin' ? 'a' : 'r'}-${row.id}`);

function hydrate(row) {
  if (!row) return null;
  const pii = decryptJSON(row.pii_enc) || {};
  return { ...row, name: pii.name || '', phone: pii.phone || '', profile: row.profile_enc ? decryptJSON(row.profile_enc) : null, pub: pubId(row) };
}

const userById = async (id) => hydrate(await getDoc('users', id));
async function userByEmail(email) {
  const hit = (await find(col('users').where('email', '==', String(email || '').toLowerCase()))).find((u) => u.status === 'active');
  return hydrate(hit);
}
// 여러 명을 한 번에 읽는다(대량 발송용).
async function usersByIds(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 300) {
    const snaps = await db.getAll(...ids.slice(i, i + 300).map((id) => col('users').doc(String(id))));
    for (const s of snaps) if (s.exists) out.set(s.id, hydrate({ id: s.id, ...s.data() }));
  }
  return out;
}

const newPid = () => `P-${1000 + Math.floor(Math.random() * 90000)}`;
const phoneTail = (phone) => String(phone || '').replace(/\D/g, '').slice(-4) || '0000';
const maskPhone = (phone) => `010-****-${phoneTail(phone)}`;

// 대기풀 전체를 훑는 일이 잦아서(매칭 인원, 분포, 연구자 화면의 참여자 표시) 잠깐 기억해 둔다.
// Firestore는 읽은 문서 수만큼 비용이 들기 때문에 매 요청마다 전부 읽지 않는다.
const POOL_TTL = 60e3;
let pool = null;
let poolAt = 0;
async function participants() {
  if (pool && Date.now() - poolAt < POOL_TTL) return pool;
  const list = (await find(col('users').where('role', '==', 'participant'))).filter((r) => r.status === 'active');
  pool = list.map((r) => ({
    id: r.id,
    pid: r.pid,
    profile: r.profile_enc ? decryptJSON(r.profile_enc) : null,
    sms: !!r.contact_sms,
    active: !!(r.pool_joined && !r.pool_paused),
    tail: r.phone_tail || '0000',
    noticeAts: r.notice_ats || [],
  }));
  poolAt = Date.now();
  return pool;
}
const invalidatePool = () => {
  pool = null;
};
// 최근 7일 동안 받은 모집 안내 수. 주 3회 제한에 쓴다.
const noticeCount = (p, now = Date.now()) => (p.noticeAts || []).filter((t) => t > now - 7 * D.DAY).length;

// ── 연구 ───────────────────────────────────────────────────
function studyFromRow(row) {
  if (!row) return null;
  return {
    ...row.doc,
    id: row.id,
    ownerRowId: row.owner_id,
    status: row.status,
    irbFileId: row.irb_file_id || '',
    irbFile: row.irb_file_name || '',
    reviewComment: row.review_comment || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at || null,
    approvedAt: row.approved_at || null,
    slots: (row.slots || []).slice().sort((a, b) => a.at - b.at),
  };
}
const getStudy = async (id) => studyFromRow(await getDoc('studies', id));

// 참여 기록은 연구자 화면에서 연구마다 통째로 필요하다. 짧게 기억해 두고, 이 서버가 고치면 바로 버린다.
const ENR_TTL = 15e3;
const enrCache = new Map();
async function enrollmentsOf(studyId, { fresh = false } = {}) {
  const hit = enrCache.get(studyId);
  if (!fresh && hit && Date.now() - hit.at < ENR_TTL) return hit.list;
  const list = await find(col('enrollments').where('study_id', '==', studyId));
  enrCache.set(studyId, { at: Date.now(), list });
  return list;
}
const invalidateEnr = (studyId) => enrCache.delete(studyId);
const enrId = (studyId, userId) => `${studyId}__${userId}`;
const doneCount = (studyId) => count(col('enrollments').where('study_id', '==', studyId).where('status', 'in', D.DONE));

// 조건에 맞고, 아직 이 연구와 엮이지 않았고, 이번 주 안내를 3번 미만으로 받은 대기풀 참여자
async function eligibleForInvite(study, now = Date.now()) {
  const enrolled = new Set((await enrollmentsOf(study.id)).map((e) => e.user_id));
  return (await participants()).filter((u) => u.active && D.matches(study, u.profile, now) && !enrolled.has(u.id) && noticeCount(u, now) < D.WEEKLY_NOTICE_LIMIT);
}
const poolMatchCount = async (study, now = Date.now()) => (await participants()).filter((u) => u.active && D.matches(study, u.profile, now)).length;

// ── 발송 ───────────────────────────────────────────────────
// 플랫폼 안의 알림함에 남기고, 실제 이메일·문자도 보낸다. 연구자는 수신자의 주소·번호를 알 수 없다.
function deliver(w, user, { studyId = null, kind, subject = '', body, sms, channel = 'both' }) {
  const at = Date.now();
  let n = 0;
  const wantEmail = channel === 'email' || channel === 'both' || (channel === 'sms' && !user.contact_sms);
  const wantSms = (channel === 'sms' || channel === 'both') && !!user.contact_sms;
  const base = { to_user_id: user.id, study_id: studyId, kind, at, read: false };
  if (wantEmail) {
    w.set(col('messages').doc(randomId('m')), { ...base, channel: 'email', subject, body });
    if (!user.synthetic) sendMail(w, { to: user.email, subject, text: body });
    // 모집 안내를 받은 시각을 남겨 주 3회 제한에 쓴다. 7일이 지난 기록은 이때 함께 지운다.
    if (kind === 'invite' || kind === 'newstudy') {
      const kept = [...(user.notice_ats || []).filter((t) => t > at - 7 * D.DAY), at];
      user.notice_ats = kept;
      w.update(col('users').doc(user.id), { notice_ats: kept });
      const cached = pool && pool.find((p) => p.id === user.id);
      if (cached) cached.noticeAts = kept;
    }
    n++;
  }
  if (wantSms) {
    const textBody = sms || body;
    w.set(col('messages').doc(randomId('m')), { ...base, channel: 'sms', subject: '', body: textBody });
    if (!user.synthetic && user.phone) sendSms(w, { to: user.phone, text: textBody });
    n++;
  }
  return n;
}

function sendLog(w, studyId, kind, channel, segment, n, subject) {
  w.set(col('send_logs').doc(randomId('l')), { study_id: studyId, at: Date.now(), kind, channel, segment, count: n, subject: String(subject || '').slice(0, 200) });
}

const ROLE_NAME = { admin: '관리자', researcher: '연구자', participant: '참여자' };
// 처리 기록. 참여자는 실명이 아니라 가명 ID로 남긴다.
function log(w, actor, action, pid = null) {
  const name = !actor ? '시스템' : actor.role === 'participant' ? actor.pid : actor.name;
  w.set(col('audit').doc(), {
    at: Date.now(), actor_id: actor ? actor.id : null, actor_name: name, role: actor ? ROLE_NAME[actor.role] : '', action,
    pid: pid || (actor && actor.role === 'participant' ? actor.pid : null),
  });
}

module.exports = {
  AppError, writer, pubId, hydrate, userById, userByEmail, usersByIds, newPid, phoneTail, maskPhone, participants, invalidatePool, noticeCount,
  studyFromRow, getStudy, enrollmentsOf, invalidateEnr, enrId, doneCount, eligibleForInvite, poolMatchCount, deliver, sendLog, log,
  encryptJSON, decryptJSON, randomId, FieldValue,
};
