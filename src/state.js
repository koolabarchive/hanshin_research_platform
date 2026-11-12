// 로그인한 사람의 역할에 따라 "그 사람이 봐도 되는 것만" 담은 화면용 데이터를 만든다.
// 화면 코드는 받은 데이터를 그대로 그리기만 하므로, 무엇을 숨길지는 전부 여기서 결정된다.
const { get, all } = require('./db');
const D = require('./domain');
const st = require('./store');

const demoMode = () => process.env.DEMO_MODE === '1' && process.env.NODE_ENV !== 'production';

function clientStudy(study, ownerPub, { full }) {
  const { ownerRowId, ...rest } = study;
  const out = { ...rest, ownerId: ownerPub, notices: study.notices || [] };
  if (!full) {
    // 참여자에게는 발송 문구 설정과 심사 관련 내부 정보가 필요 없다.
    delete out.templates;
    delete out.reviewComment;
    delete out.irbFile;
    delete out.irbFileId;
    delete out.submittedAt;
  }
  return out;
}

function clientEnrollment(row, userPub, { own, withResponses }) {
  const e = {
    id: row.id,
    studyId: row.study_id,
    userId: userPub,
    status: row.status,
    source: row.source,
    invitedAt: row.invited_at,
  };
  if (row.consent_at) Object.assign(e, { consentAt: row.consent_at, signed: true, consentVersion: row.consent_version });
  if (row.slot_id) e.slotId = row.slot_id;
  if (row.completed_at) e.completedAt = row.completed_at;
  if (row.paid_at) e.paidAt = row.paid_at;
  if (row.reward_sent_at) e.rewardSentAt = row.reward_sent_at;
  if (row.withdrawn_at) Object.assign(e, { withdrawnAt: row.withdrawn_at, dataChoice: row.data_choice });
  if (withResponses && row.responses_enc && row.status !== 'withdrawn') e.responses = st.decryptJSON(row.responses_enc);
  if (own) {
    // 서명(실명)과 서명 당시 동의서 사본은 본인에게만 돌려준다.
    if (row.signature_enc) e.signature = st.decryptJSON(row.signature_enc);
    if (row.consent_doc_enc) e.consentDoc = st.decryptJSON(row.consent_doc_enc);
  }
  return e;
}

const doneCount = (studyId) => get(`SELECT COUNT(*) n FROM enrollments WHERE study_id = ? AND status IN ('completed','paid')`, studyId).n;

function tally(list, keyFn, keys) {
  return keys.map((k) => [k, list.filter((x) => keyFn(x) === k).length]);
}

function landingStats() {
  const people = st.participants();
  return {
    participants: people.length,
    poolActive: people.filter((u) => u.active).length,
    recruiting: get(`SELECT COUNT(*) n FROM studies WHERE status = 'recruiting'`).n,
    done: get(`SELECT COUNT(*) n FROM enrollments WHERE status IN ('completed','paid')`).n,
    paid: get(`SELECT COUNT(*) n FROM enrollments WHERE status = 'paid'`).n,
  };
}

function poolSummary(now) {
  const people = st.participants().filter((u) => u.profile);
  const act = people.filter((u) => u.active);
  const out = {
    total: people.length,
    active: act.length,
    paused: people.length - act.length,
    smsPct: act.length ? Math.round((act.filter((u) => u.sms).length / act.length) * 100) : 0,
    breakdown: null,
  };
  // 인원이 적을 때 분포를 보여 주면 개인이 드러날 수 있다.
  if (act.length >= D.POOL_BREAKDOWN_MIN) {
    out.breakdown = {
      status: tally(act, (u) => u.profile.status, D.STATUSES),
      age: tally(act, (u) => D.ageBand(D.ageOf(u.profile, now)), D.AGE_BANDS),
      gender: tally(act, (u) => u.profile.gender, D.GENDERS),
      interests: D.INTERESTS.map((k) => [k, act.filter((u) => (u.profile.interests || []).includes(k)).length]),
      times: D.TIMES.map((k) => [k, act.filter((u) => (u.profile.times || []).includes(k)).length]),
      depts: tally(act, (u) => u.profile.dept, D.DEPTS_UG).sort((a, b) => b[1] - a[1]).slice(0, 6),
    };
  }
  return out;
}

function meResearcher(u) {
  const file = u.ethics_file_id ? get('SELECT name FROM files WHERE id = ?', u.ethics_file_id) : null;
  return {
    id: u.pub, role: u.role, name: u.name, email: u.email, phone: u.phone, program: u.program, dept: u.dept, advisor: u.advisor,
    ethicsDate: u.ethics_date, ethicsFile: file ? file.name : '', ethicsFileId: u.ethics_file_id || '', verified: !!u.verified, joinedAt: u.joined_at,
  };
}

function meParticipant(u) {
  return {
    id: u.pub, role: u.role, name: u.name, email: u.email, phone: u.phone, pid: u.pid, affiliation: u.affiliation, profile: u.profile,
    contact: { email: true, sms: !!u.contact_sms }, pool: { joined: !!u.pool_joined, paused: !!u.pool_paused, since: u.pool_since }, joinedAt: u.joined_at,
  };
}

// 연구책임자는 공개 정보(이름·과정·소속)만 내보낸다.
function ownerStub(ownerRowId) {
  const o = st.userById(ownerRowId);
  return { id: o.pub, role: 'researcher', name: o.name, program: o.program, dept: o.dept, verified: !!o.verified };
}

function researcherState(u, now) {
  const rows = all('SELECT * FROM studies WHERE owner_id = ? ORDER BY created_at DESC', u.id);
  const users = [meResearcher(u)];
  const seen = new Set();
  const enrollments = [];
  const inquiries = [];
  const studies = rows.map((row) => {
    const study = st.studyFromRow(row);
    const out = clientStudy(study, u.pub, { full: true });
    if (['recruiting', 'review'].includes(study.status)) out._poolMatch = st.poolMatchCount(study, now);
    if (study.status === 'recruiting') {
      const el = st.eligibleForInvite(study, now);
      out._elig = {
        n: el.length,
        byStatus: tally(el, (x) => x.profile.status, D.STATUSES).filter((x) => x[1]),
        byAge: tally(el, (x) => D.ageBand(D.ageOf(x.profile, now)), D.AGE_BANDS).filter((x) => x[1]),
      };
    }
    for (const e of st.enrollmentsOf(study.id)) {
      const p = st.userById(e.user_id);
      const pid = p.pid;
      enrollments.push(clientEnrollment(e, pid, { own: false, withResponses: true }));
      if (!seen.has(pid)) {
        seen.add(pid);
        // 연구자가 받는 참여자 정보는 이것이 전부다: 가명 ID, 신분, 연령대, 전화번호 끝 네 자리.
        users.push({ id: pid, role: 'participant', pid, phone: st.maskPhone(p.phone), profile: p.profile ? { status: p.profile.status, ageBand: D.ageBand(D.ageOf(p.profile, now)) } : { status: '탈퇴', ageBand: '-' } });
      }
    }
    for (const q of all('SELECT i.*, p.pid FROM inquiries i JOIN users p ON p.id = i.user_id WHERE i.study_id = ? ORDER BY i.at DESC', study.id)) {
      inquiries.push({ id: q.id, studyId: q.study_id, pid: q.pid, body: q.reported ? '' : q.body, at: q.at, reply: q.reply || '', repliedAt: q.replied_at, reported: !!q.reported });
    }
    return out;
  });
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => '?').join(',') || "''";
  return {
    users,
    studies,
    enrollments,
    inquiries,
    messages: [],
    sendLogs: all(`SELECT id, study_id AS studyId, at, kind, channel, segment, count, subject FROM send_logs WHERE study_id IN (${marks}) ORDER BY at DESC LIMIT 500`, ...ids),
    audit: all('SELECT at, actor_name AS actor, role, action FROM audit WHERE actor_id = ? ORDER BY id DESC LIMIT 30', u.id),
    pool: poolSummary(now),
  };
}

function participantState(u, now) {
  const mine = all('SELECT * FROM enrollments WHERE user_id = ?', u.id);
  const messages = all('SELECT id, study_id AS studyId, kind, channel, subject, body, at, read FROM messages WHERE to_user_id = ? ORDER BY at DESC LIMIT 300', u.id).map((m) => ({ ...m, toUserId: u.pub, read: !!m.read }));
  // 모집 중인 연구 + 내가 참여했거나 안내를 받은 연구
  const wanted = new Set([...mine.map((e) => e.study_id), ...messages.map((m) => m.studyId).filter(Boolean)]);
  const rows = all(`SELECT * FROM studies WHERE status IN ('recruiting','closed') ORDER BY approved_at DESC`).filter((r) => r.status === 'recruiting' || wanted.has(r.id));
  const owners = new Map();
  const studies = rows.map((row) => {
    const study = st.studyFromRow(row);
    if (!owners.has(study.ownerRowId)) owners.set(study.ownerRowId, ownerStub(study.ownerRowId));
    const out = clientStudy(study, owners.get(study.ownerRowId).id, { full: false });
    out._done = doneCount(study.id);
    return out;
  });
  const visible = new Set(studies.map((s) => s.id));
  return {
    users: [meParticipant(u), ...owners.values()],
    studies,
    enrollments: mine.filter((e) => visible.has(e.study_id)).map((e) => clientEnrollment(e, u.pub, { own: true, withResponses: true })),
    inquiries: all('SELECT id, study_id AS studyId, body, at, reply, replied_at AS repliedAt FROM inquiries WHERE user_id = ? ORDER BY at DESC', u.id),
    messages: messages.map((m) => (m.studyId && !visible.has(m.studyId) ? { ...m, studyId: null } : m)),
    sendLogs: [],
    // 내 정보를 누가 어떻게 처리했는지(보상 지급, 완료 처리 등) 본인이 확인할 수 있게 한다.
    audit: all('SELECT at, actor_name AS actor, role, action FROM audit WHERE pid = ? AND actor_id IS NOT ? ORDER BY id DESC LIMIT 10', u.pid, u.id),
  };
}

function adminState(u, now) {
  const researchers = all(`SELECT * FROM users WHERE role = 'researcher' AND status = 'active' ORDER BY verified, joined_at DESC`).map((r) => meResearcher(st.hydrate(r)));
  const studies = all('SELECT * FROM studies ORDER BY created_at DESC').map((row) => {
    const study = st.studyFromRow(row);
    const out = clientStudy(study, `r-${study.ownerRowId}`, { full: true });
    out._done = doneCount(study.id);
    if (study.status === 'review') out._poolMatch = st.poolMatchCount(study, now);
    return out;
  });
  // 모바일 상품권은 연구자가 번호를 모르므로 연구지원팀이 대신 보낸다. 번호 전체는 이 목록에서만 보인다.
  const rewardQueue = all(
    `SELECT e.id, e.paid_at, e.reward_sent_at, e.user_id, s.doc FROM enrollments e JOIN studies s ON s.id = e.study_id
     WHERE e.status = 'paid' AND (e.reward_sent_at IS NULL OR e.reward_sent_at > ?) ORDER BY e.reward_sent_at IS NOT NULL, e.paid_at`,
    now - 14 * D.DAY
  )
    .map((r) => ({ ...r, doc: JSON.parse(r.doc) }))
    .filter((r) => r.doc.reward.type === '모바일 상품권' && r.doc.reward.amount > 0)
    .map((r) => {
      const p = st.userById(r.user_id);
      return { id: r.id, pid: p.pid, phone: r.reward_sent_at ? st.maskPhone(p.phone) : p.phone, study: r.doc.title, amount: r.doc.reward.amount, paidAt: r.paid_at, sentAt: r.reward_sent_at };
    });
  return {
    users: [{ id: u.pub, role: 'admin', name: u.name, email: u.email }, ...researchers],
    studies,
    enrollments: [],
    inquiries: all(`SELECT i.id, i.study_id AS studyId, p.pid, i.body, i.at FROM inquiries i JOIN users p ON p.id = i.user_id WHERE i.reported = 1 ORDER BY i.at DESC LIMIT 50`),
    messages: [],
    sendLogs: [],
    audit: all('SELECT at, actor_name AS actor, role, action FROM audit ORDER BY id DESC LIMIT 200'),
    rewardQueue,
  };
}

function buildState(user) {
  const now = Date.now();
  const base = { v: 1, session: null, demo: demoMode(), users: [], studies: [], enrollments: [], inquiries: [], messages: [], sendLogs: [], audit: [], stats: landingStats() };
  if (!user) return base;
  const scoped = user.role === 'researcher' ? researcherState(user, now) : user.role === 'participant' ? participantState(user, now) : adminState(user, now);
  return { ...base, ...scoped, session: user.pub };
}

module.exports = { buildState, demoMode };
