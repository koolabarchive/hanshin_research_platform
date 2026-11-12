// 로그인한 사람의 역할에 따라 "그 사람이 봐도 되는 것만" 담은 화면용 데이터를 만든다.
// 화면 코드는 받은 데이터를 그대로 그리기만 하므로, 무엇을 숨길지는 전부 여기서 결정된다.
const { db, col, find, count } = require('./db');
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
  const e = { id: row.id, studyId: row.study_id, userId: userPub, status: row.status, source: row.source, invitedAt: row.invited_at };
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

const tally = (list, keyFn, keys) => keys.map((k) => [k, list.filter((x) => keyFn(x) === k).length]);
const byAtDesc = (a, b) => b.at - a.at;

// 첫 화면 통계는 로그인하지 않은 방문자에게도 나가므로 잠깐 기억해 두고 다시 쓴다.
let statsCache = null;
async function landingStats() {
  if (statsCache && Date.now() - statsCache.at < 60e3) return statsCache.value;
  const people = await st.participants();
  const [recruiting, done, paid] = await Promise.all([
    count(col('studies').where('status', '==', 'recruiting')),
    count(col('enrollments').where('status', 'in', D.DONE)),
    count(col('enrollments').where('status', '==', 'paid')),
  ]);
  statsCache = { at: Date.now(), value: { participants: people.length, poolActive: people.filter((u) => u.active).length, recruiting, done, paid } };
  return statsCache.value;
}

async function poolSummary(now) {
  const people = (await st.participants()).filter((u) => u.profile);
  const act = people.filter((u) => u.active);
  const out = { total: people.length, active: act.length, paused: people.length - act.length, smsPct: act.length ? Math.round((act.filter((u) => u.sms).length / act.length) * 100) : 0, breakdown: null };
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

const meResearcher = (u) => ({
  id: u.pub, role: u.role, name: u.name, email: u.email, phone: u.phone, program: u.program, dept: u.dept, advisor: u.advisor,
  ethicsDate: u.ethics_date, ethicsFile: u.ethics_file_name || '', ethicsFileId: u.ethics_file_id || '', verified: !!u.verified, joinedAt: u.joined_at,
});

const meParticipant = (u) => ({
  id: u.pub, role: u.role, name: u.name, email: u.email, phone: u.phone, pid: u.pid, affiliation: u.affiliation, profile: u.profile,
  contact: { email: true, sms: !!u.contact_sms }, pool: { joined: !!u.pool_joined, paused: !!u.pool_paused, since: u.pool_since }, joinedAt: u.joined_at,
});

const auditRow = (a) => ({ at: a.at, actor: a.actor_name, role: a.role, action: a.action });
const logRow = (l) => ({ id: l.id, studyId: l.study_id, at: l.at, kind: l.kind, channel: l.channel, segment: l.segment, count: l.count, subject: l.subject });

async function researcherState(u, now) {
  const rows = (await find(col('studies').where('owner_id', '==', u.id))).sort((a, b) => b.created_at - a.created_at);
  const pool = new Map((await st.participants()).map((p) => [p.id, p]));
  const users = [meResearcher(u)];
  const seen = new Set();
  const enrollments = [];
  const inquiries = [];
  const sendLogs = [];
  const studies = await Promise.all(rows.map(async (row) => {
    const study = st.studyFromRow(row);
    const out = clientStudy(study, u.pub, { full: true });
    const [enr, qs, logs] = await Promise.all([st.enrollmentsOf(study.id), find(col('inquiries').where('study_id', '==', study.id)), find(col('send_logs').where('study_id', '==', study.id))]);
    if (['recruiting', 'review'].includes(study.status)) out._poolMatch = await st.poolMatchCount(study, now);
    if (study.status === 'recruiting') {
      const el = await st.eligibleForInvite(study, now);
      out._elig = {
        n: el.length,
        byStatus: tally(el, (x) => x.profile.status, D.STATUSES).filter((x) => x[1]),
        byAge: tally(el, (x) => D.ageBand(D.ageOf(x.profile, now)), D.AGE_BANDS).filter((x) => x[1]),
      };
    }
    for (const e of enr) {
      enrollments.push(clientEnrollment(e, e.pid, { own: false, withResponses: true }));
      if (seen.has(e.pid)) continue;
      seen.add(e.pid);
      const p = pool.get(e.user_id);
      // 연구자가 받는 참여자 정보는 이것이 전부다: 가명 ID, 신분, 연령대, 전화번호 끝 네 자리.
      users.push({ id: e.pid, role: 'participant', pid: e.pid, phone: `010-****-${p ? p.tail : '0000'}`, profile: p && p.profile ? { status: p.profile.status, ageBand: D.ageBand(D.ageOf(p.profile, now)) } : { status: '탈퇴', ageBand: '-' } });
    }
    for (const q of qs) inquiries.push({ id: q.id, studyId: q.study_id, pid: q.pid, body: q.reported ? '' : q.body, at: q.at, reply: q.reply || '', repliedAt: q.replied_at || null, reported: !!q.reported });
    sendLogs.push(...logs.map(logRow));
    return out;
  }));
  const audit = await find(col('audit').where('actor_id', '==', u.id).orderBy('at', 'desc').limit(30));
  return { users, studies, enrollments, inquiries: inquiries.sort(byAtDesc), messages: [], sendLogs: sendLogs.sort(byAtDesc).slice(0, 500), audit: audit.map(auditRow), pool: await poolSummary(now) };
}

async function participantState(u, now) {
  const [mine, msgRows, recruiting, myQs, audit] = await Promise.all([
    find(col('enrollments').where('user_id', '==', u.id)),
    find(col('messages').where('to_user_id', '==', u.id).orderBy('at', 'desc').limit(300)),
    find(col('studies').where('status', '==', 'recruiting')),
    find(col('inquiries').where('user_id', '==', u.id)),
    find(col('audit').where('pid', '==', u.pid).orderBy('at', 'desc').limit(30)),
  ]);
  // 모집 중인 연구 + 내가 참여했거나 안내를 받은 연구(마감된 것 포함)
  const have = new Set(recruiting.map((r) => r.id));
  const wanted = [...new Set([...mine.map((e) => e.study_id), ...msgRows.map((m) => m.study_id).filter(Boolean)])].filter((id) => !have.has(id));
  const extra = wanted.length ? (await db.getAll(...wanted.map((id) => col('studies').doc(id)))).filter((s) => s.exists).map((s) => ({ id: s.id, ...s.data() })).filter((r) => r.status === 'closed') : [];
  const rows = [...recruiting, ...extra].sort((a, b) => (b.approved_at || 0) - (a.approved_at || 0));
  const owners = await st.usersByIds([...new Set(rows.map((r) => r.owner_id))]);
  const studies = await Promise.all(rows.map(async (row) => {
    const out = clientStudy(st.studyFromRow(row), `r-${row.owner_id}`, { full: false });
    out._done = await st.doneCount(row.id);
    return out;
  }));
  const visible = new Set(rows.map((r) => r.id));
  return {
    // 연구책임자는 공개 정보(이름·과정·소속)만 내보낸다.
    users: [meParticipant(u), ...[...owners.values()].map((o) => ({ id: o.pub, role: 'researcher', name: o.name, program: o.program, dept: o.dept, verified: !!o.verified }))],
    studies,
    enrollments: mine.filter((e) => visible.has(e.study_id)).map((e) => clientEnrollment(e, u.pub, { own: true, withResponses: true })),
    inquiries: myQs.sort(byAtDesc).map((q) => ({ id: q.id, studyId: q.study_id, body: q.body, at: q.at, reply: q.reply || '', repliedAt: q.replied_at || null })),
    messages: msgRows.map((m) => ({ id: m.id, studyId: m.study_id && visible.has(m.study_id) ? m.study_id : null, kind: m.kind, channel: m.channel, subject: m.subject, body: m.body, at: m.at, read: !!m.read, toUserId: u.pub })),
    sendLogs: [],
    // 내 정보를 누가 어떻게 처리했는지(보상 지급, 완료 처리 등) 본인이 확인할 수 있게 한다.
    audit: audit.filter((a) => a.actor_id !== u.id).slice(0, 10).map(auditRow),
  };
}

async function adminState(u, now) {
  const [researchers, studyRows, pending, sent, reported, audit] = await Promise.all([
    find(col('users').where('role', '==', 'researcher')),
    find(col('studies')),
    find(col('enrollments').where('reward_queue', '==', 'pending')),
    find(col('enrollments').where('reward_sent_at', '>', now - 14 * D.DAY)),
    find(col('inquiries').where('reported', '==', true).limit(50)),
    find(col('audit').orderBy('at', 'desc').limit(200)),
  ]);
  const studies = await Promise.all(studyRows.sort((a, b) => b.created_at - a.created_at).map(async (row) => {
    const study = st.studyFromRow(row);
    const out = clientStudy(study, `r-${row.owner_id}`, { full: true });
    out._done = ['recruiting', 'closed'].includes(row.status) ? await st.doneCount(row.id) : 0;
    if (row.status === 'review') out._poolMatch = await st.poolMatchCount(study, now);
    return out;
  }));
  // 모바일 상품권은 연구자가 번호를 모르므로 연구지원팀이 대신 보낸다. 번호 전체는 발송 대기 건에서만 보인다.
  const queue = [...pending, ...sent];
  const people = await st.usersByIds([...new Set(queue.map((e) => e.user_id))]);
  const titles = new Map(studyRows.map((r) => [r.id, r.doc]));
  const rewardQueue = queue.sort((a, b) => (a.reward_sent_at ? 1 : 0) - (b.reward_sent_at ? 1 : 0) || a.paid_at - b.paid_at).map((e) => {
    const p = people.get(e.user_id);
    const doc = titles.get(e.study_id) || { title: '', reward: { amount: 0 } };
    return { id: e.id, pid: e.pid, phone: e.reward_sent_at || !p ? st.maskPhone(p && p.phone) : p.phone, study: doc.title, amount: doc.reward.amount, paidAt: e.paid_at, sentAt: e.reward_sent_at || null };
  });
  return {
    users: [{ id: u.pub, role: 'admin', name: u.name, email: u.email }, ...researchers.filter((r) => r.status === 'active').sort((a, b) => (a.verified ? 1 : 0) - (b.verified ? 1 : 0) || b.joined_at - a.joined_at).map((r) => meResearcher(st.hydrate(r)))],
    studies,
    enrollments: [],
    inquiries: reported.sort(byAtDesc).map((q) => ({ id: q.id, studyId: q.study_id, pid: q.pid, body: q.body, at: q.at })),
    messages: [],
    sendLogs: [],
    audit: audit.map(auditRow),
    rewardQueue,
  };
}

async function buildState(user) {
  const now = Date.now();
  const base = { v: 1, session: null, demo: demoMode(), users: [], studies: [], enrollments: [], inquiries: [], messages: [], sendLogs: [], audit: [], stats: await landingStats() };
  if (!user) return base;
  const scoped = user.role === 'researcher' ? await researcherState(user, now) : user.role === 'participant' ? await participantState(user, now) : await adminState(user, now);
  return { ...base, ...scoped, session: user.pub };
}

module.exports = { buildState, demoMode };
