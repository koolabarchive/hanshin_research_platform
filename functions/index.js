// 한신 리서치풀 Functions.
// 화면(브라우저)은 Firestore 보안 규칙 아래에서 직접 읽고 쓴다. 여기에는 브라우저에 맡길 수 없는 일만 둔다.
//   1) 대기풀을 읽어야 하는 일: 조건에 맞는 인원수, 무작위 초대, 새 연구 안내
//   2) 참여자의 주소·번호가 필요한 일: 이메일·문자 발송
//   3) 상태 변화에 따른 알림·처리 기록·집계 (누가 화면을 조작했든 서버가 남긴다)
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentWritten, onDocumentUpdated, onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const D = require('./domain');
const { sendMail, sendSms } = require('./mailer');

initializeApp();
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
// 서울 리전. Firestore 데이터베이스도 같은 리전에 만든다.
setGlobalOptions({ region: 'asia-northeast3', maxInstances: 5, memory: '512MiB' });

const SITE = '한신 리서치풀';
const col = (n) => db.collection(n);
const rows = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
const getRow = async (n, id) => {
  const s = await col(n).doc(String(id)).get();
  return s.exists ? { id: s.id, ...s.data() } : null;
};
const fail = (msg, code = 'failed-precondition') => {
  throw new HttpsError(code, msg);
};
const rid = (p) => `${p}-${require('node:crypto').randomBytes(6).toString('base64url')}`;

// ── 대기풀 ──────────────────────────────────────────────────
// 인스턴스 메모리에 잠깐 기억해 Firestore 읽기를 줄인다.
let poolCache = null;
let poolAt = 0;
async function pool() {
  if (poolCache && Date.now() - poolAt < 60e3) return poolCache;
  poolCache = rows(await col('pool').get()).map((p) => ({ ...p, uid: p.id, active: !!(p.joined && !p.paused), noticeAts: [] }));
  const notices = new Map(rows(await col('poolNotices').get()).map((n) => [n.id, n.ats || []]));
  for (const p of poolCache) p.noticeAts = notices.get(p.uid) || [];
  poolAt = Date.now();
  return poolCache;
}
// 최근 7일 동안 받은 모집 안내 수(주 3회 제한).
const noticeCount = (p, now) => p.noticeAts.filter((t) => t > now - 7 * D.DAY).length;
const stub = (p, now) => ({ pstatus: p.status, ageBand: D.ageBand(D.ageOf(p, now)), phoneTail: p.phoneTail });

async function eligible(study, now) {
  const enrolled = new Set(rows(await col('enrollments').where('studyId', '==', study.id).get()).map((e) => e.uid));
  return (await pool()).filter((p) => p.active && D.matches(study, p, now) && !enrolled.has(p.uid) && noticeCount(p, now) < D.WEEKLY_NOTICE_LIMIT);
}
const tally = (list, keyFn, keys) => keys.map((k) => [k, list.filter((x) => keyFn(x) === k).length]);

// ── 발송 ───────────────────────────────────────────────────
// 알림함에 남기고 실제 이메일·문자를 보낸다. 주소와 번호는 여기서만 읽는다.
async function contacts(uids) {
  const out = new Map();
  const uniq = [...new Set(uids)];
  for (let i = 0; i < uniq.length; i += 300) {
    const snaps = await db.getAll(...uniq.slice(i, i + 300).map((u) => col('users').doc(u).collection('private').doc('contact')));
    snaps.forEach((s, k) => s.exists && out.set(uniq[i + k], s.data()));
  }
  return out;
}

async function deliver(w, to, { uid, sms: smsOk = true }, { studyId = null, kind, subject = '', body, sms, channel = 'both' }) {
  const at = Date.now();
  const tasks = [];
  let n = 0;
  const wantEmail = channel === 'email' || channel === 'both' || (channel === 'sms' && !smsOk);
  const wantSms = (channel === 'sms' || channel === 'both') && smsOk;
  const base = { toUid: uid, studyId, kind, at, read: false };
  if (wantEmail) {
    w.set(col('messages').doc(rid('m')), { ...base, channel: 'email', subject, body });
    if (to && !to.synthetic && to.email) tasks.push(sendMail(db, { to: to.email, subject, text: body }));
    if (kind === 'invite' || kind === 'newstudy') {
      w.set(col('poolNotices').doc(uid), { ats: FieldValue.arrayUnion(at) }, { merge: true });
      const cached = poolCache && poolCache.find((p) => p.uid === uid);
      if (cached) cached.noticeAts = [...cached.noticeAts, at];
    }
    n++;
  }
  if (wantSms) {
    const text = sms || body;
    w.set(col('messages').doc(rid('m')), { ...base, channel: 'sms', subject: '', body: text });
    if (to && !to.synthetic && to.phone) tasks.push(sendSms(db, { to: to.phone, text }));
    n++;
  }
  await Promise.all(tasks);
  return n;
}
// 참여자 한 명에게 보낸다(상태 변화 알림용).
async function notify(uid, msg) {
  const [contact, p] = await Promise.all([contacts([uid]), getRow('pool', uid)]);
  const w = db.bulkWriter();
  await deliver(w, contact.get(uid), { uid, sms: p ? p.sms : false }, msg);
  await w.close();
}
async function mailStaff(uid, subject, text) {
  const c = (await contacts([uid])).get(uid);
  // 시연용 가상 계정에는 실제로 보내지 않는다(그 주소가 실제 사람의 것일 수 있다).
  if (c && !c.synthetic && c.email) await sendMail(db, { to: c.email, subject, text });
}

const sendLog = (w, study, kind, channel, segment, count, subject) =>
  w.set(col('sendLogs').doc(rid('l')), { studyId: study.id, ownerUid: study.ownerUid, at: Date.now(), kind, channel, segment, count, subject: String(subject || '').slice(0, 200) });
const audit = (actorUid, actor, role, action, pid = null) => col('audit').add({ at: Date.now(), actorUid, actor, role, action, pid, client: false });

async function ownStudy(req, statuses) {
  if (!req.auth) fail('로그인이 필요해요.', 'unauthenticated');
  const study = await getRow('studies', req.data.studyId);
  if (!study || study.ownerUid !== req.auth.uid) fail('연구를 찾을 수 없어요.', 'not-found');
  if (!statuses.includes(study.status)) fail('지금 상태에서는 할 수 없는 작업이에요.');
  return study;
}

// ════════════ 화면이 부르는 함수 ════════════

// 대기풀 집계. 개인별 정보는 내보내지 않고 인원수와 분포만 돌려준다.
exports.poolStats = onCall(async (req) => {
  if (!req.auth) fail('로그인이 필요해요.', 'unauthenticated');
  const me = await getRow('users', req.auth.uid);
  const admin = (await col('admins').doc(req.auth.uid).get()).exists;
  if (!admin && !(me && me.role === 'researcher')) fail('연구자만 볼 수 있어요.', 'permission-denied');
  const now = Date.now();
  const all = await pool();
  const act = all.filter((p) => p.active);
  const out = { studies: {} };
  // 등록 화면의 "조건에 맞는 인원": 조건을 좁혀 가며 개인을 짚어내지 못하도록 적은 수는 가린다.
  if (req.data.criteria) {
    const n = act.filter((p) => D.matches(D.sanitizeDraft({ criteria: req.data.criteria }), p, now)).length;
    out.countText = n === 0 ? '0명' : n < D.MIN_COUNT ? `${D.MIN_COUNT}명 미만` : `${n}명`;
    return out;
  }
  for (const id of (req.data.studyIds || []).slice(0, 30)) {
    const study = await getRow('studies', id);
    if (!study || !(admin || study.ownerUid === req.auth.uid)) continue;
    const s = { poolMatch: act.filter((p) => D.matches(study, p, now)).length };
    if (study.status === 'recruiting' && study.ownerUid === req.auth.uid) {
      const el = await eligible(study, now);
      s.elig = { n: el.length, byStatus: tally(el, (x) => x.status, D.STATUSES).filter((x) => x[1]), byAge: tally(el, (x) => D.ageBand(D.ageOf(x, now)), D.AGE_BANDS).filter((x) => x[1]) };
    }
    out.studies[id] = s;
  }
  out.pool = { total: all.length, active: act.length, paused: all.length - act.length, smsPct: act.length ? Math.round((act.filter((p) => p.sms).length / act.length) * 100) : 0, breakdown: null };
  // 인원이 적을 때 분포를 보여 주면 개인이 드러날 수 있다.
  if (act.length >= D.POOL_BREAKDOWN_MIN) {
    out.pool.breakdown = {
      status: tally(act, (p) => p.status, D.STATUSES),
      age: tally(act, (p) => D.ageBand(D.ageOf(p, now)), D.AGE_BANDS),
      gender: tally(act, (p) => p.gender, D.GENDERS),
      interests: D.INTERESTS.map((k) => [k, act.filter((p) => (p.interests || []).includes(k)).length]),
      times: D.TIMES.map((k) => [k, act.filter((p) => (p.times || []).includes(k)).length]),
      depts: tally(act, (p) => p.dept, D.DEPTS_UG).sort((a, b) => b[1] - a[1]).slice(0, 6),
    };
  }
  return out;
});

// 대기풀에서 조건에 맞는 사람을 무작위로 골라 초대한다. 연구자는 누가 뽑혔는지 가명 ID로만 안다.
exports.invite = onCall(async (req) => {
  const study = await ownStudy(req, ['recruiting']);
  const now = Date.now();
  const list = D.shuffle(await eligible(study, now));
  const n = Math.max(0, Math.min(list.length, Math.round(Number(req.data.n)) || 0));
  if (!n) fail('초대 인원을 1명 이상 입력해 주세요.');
  const ch = ['both', 'email', 'sms'].includes(req.data.ch) ? req.data.ch : 'both';
  const chosen = list.slice(0, n);
  const to = await contacts(chosen.map((p) => p.uid));
  const w = db.bulkWriter();
  w.onWriteError(() => false);
  let msgs = 0;
  for (const p of chosen) {
    w.create(col('enrollments').doc(`${study.id}__${p.uid}`), { studyId: study.id, uid: p.uid, pid: p.pid, ownerUid: study.ownerUid, status: 'invited', source: 'invite', invitedAt: now, ...stub(p, now) }).catch(() => {});
    msgs += await deliver(w, to.get(p.uid), p, { studyId: study.id, kind: 'invite', channel: ch, subject: D.fillTpl(study.templates.inviteSubject, study, p.pid), body: D.fillTpl(study.templates.inviteBody, study, p.pid), sms: D.fillTpl(study.templates.sms, study, p.pid) });
  }
  sendLog(w, study, '초대', D.CHANNEL_LABEL[ch], '대기풀 조건 일치', n, D.fillTpl(study.templates.inviteSubject, study, null));
  await w.close();
  await audit(req.auth.uid, study.owner.name, '연구자', `대기풀 초대 ${n}명 (${study.title})`);
  return { toast: `${n}명에게 초대를 보냈어요. 메시지 ${msgs}건이 발송 기록에 남았어요.` };
});

// 참여 단계별로 대상을 골라 안내를 보낸다. 연구자는 수신자의 주소·번호를 알 수 없다.
exports.compose = onCall(async (req) => {
  const study = await ownStudy(req, ['recruiting', 'closed']);
  const seg = D.SEGMENTS[req.data.seg];
  const ch = ['both', 'email', 'sms'].includes(req.data.ch) ? req.data.ch : 'sms';
  const body = D.text(req.data.body, 2000).trim();
  const subj = D.line(req.data.subj, 200) || `[${SITE}] ${study.title} 안내`;
  if (!seg) fail('받는 사람을 골라 주세요.');
  if (!body) fail('내용을 입력해 주세요.');
  // 참여자가 같은 연구에서 안내를 지나치게 많이 받지 않도록 한다.
  const today = rows(await col('sendLogs').where('studyId', '==', study.id).get()).filter((l) => l.kind === '안내' && l.at > Date.now() - D.DAY).length;
  if (today >= 3) fail('한 연구에서 직접 보내는 안내는 하루 3번까지 가능해요.');
  const targets = rows(await col('enrollments').where('studyId', '==', study.id).get()).filter(seg[1]);
  if (!targets.length) fail('보낼 대상이 없어요.');
  const [to, people] = await Promise.all([contacts(targets.map((e) => e.uid)), pool()]);
  const byUid = new Map(people.map((p) => [p.uid, p]));
  const w = db.bulkWriter();
  let msgs = 0;
  for (const e of targets) {
    const filled = D.fillTpl(body, study, e.pid);
    msgs += await deliver(w, to.get(e.uid), byUid.get(e.uid) || { uid: e.uid, sms: false }, { studyId: study.id, kind: 'reminder', channel: ch, subject: D.fillTpl(subj, study, e.pid), body: filled, sms: filled });
  }
  sendLog(w, study, '안내', D.CHANNEL_LABEL[ch], seg[0], targets.length, ch === 'sms' ? body.slice(0, 40) : subj);
  await w.close();
  await audit(req.auth.uid, study.owner.name, '연구자', `안내 발송 ${targets.length}명 · ${seg[0]} (${study.title})`);
  return { toast: `${targets.length}명에게 보냈어요. (메시지 ${msgs}건)` };
});

// 탈퇴: 진행 중인 참여를 철회하고, 이름·연락처·매칭 정보·알림함을 지운 뒤 로그인 계정을 삭제한다.
// 이미 마친 연구의 가명 응답과 동의서는 법정 보관 기간 동안 남는다.
exports.deleteAccount = onCall(async (req) => {
  if (!req.auth) fail('로그인이 필요해요.', 'unauthenticated');
  const uid = req.auth.uid;
  const me = await getRow('users', uid);
  if (!me || me.role !== 'participant') fail('참여자 계정만 직접 탈퇴할 수 있어요.', 'permission-denied');
  for (const e of rows(await col('enrollments').where('uid', '==', uid).get())) {
    if (!['invited', 'consented', 'scheduled'].includes(e.status)) continue;
    await db.runTransaction(async (t) => {
      const ref = col('enrollments').doc(e.id);
      const cur = (await t.get(ref)).data();
      if (cur.status === 'scheduled' && cur.slotId) t.update(col('studies').doc(cur.studyId).collection('slots').doc(cur.slotId), { booked: FieldValue.increment(-1) });
      t.update(ref, { status: 'withdrawn', withdrawnAt: Date.now(), dataChoice: '폐기', responses: FieldValue.delete(), byAccountDeletion: true });
    });
  }
  const w = db.bulkWriter();
  for (const m of rows(await col('messages').where('toUid', '==', uid).get())) w.delete(col('messages').doc(m.id));
  for (const q of rows(await col('inquiries').where('uid', '==', uid).get())) w.delete(col('inquiries').doc(q.id));
  w.delete(col('pool').doc(uid));
  w.delete(col('poolNotices').doc(uid));
  w.delete(col('users').doc(uid).collection('private').doc('contact'));
  w.set(col('users').doc(uid), { deleted: true, deletedAt: Date.now() }, { merge: true });
  await w.close();
  poolCache = null;
  await audit(uid, me.pid, '참여자', '회원 탈퇴', me.pid);
  await getAuth().deleteUser(uid);
  return { toast: '탈퇴를 처리했어요.' };
});

// ════════════ 상태 변화에 반응하는 함수 ════════════

// 참여 기록이 바뀔 때: 참여자 알림, 처리 기록, 연구의 완료 인원 집계.
exports.onEnrollmentWrite = onDocumentWritten('enrollments/{id}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  // 새로 만들어진 기록(직접 신청·초대)에는 따로 할 일이 없다. 상태가 바뀔 때만 반응한다.
  if (!before || !after || before.status === after.status) return;
  const study = await getRow('studies', after.studyId);
  if (!study) return;
  const from = before.status;
  const to = after.status;
  const wasDone = D.DONE.includes(from);
  const isDone = D.DONE.includes(to);
  if (wasDone !== isDone) await col('studies').doc(study.id).update({ doneCount: FieldValue.increment(isDone ? 1 : -1) });
  const who = { p: [after.uid, after.pid, '참여자'], r: [study.ownerUid, study.owner.name, '연구자'] };
  const log = (k, action) => audit(who[k][0], who[k][1], who[k][2], action, after.pid);
  const base = { studyId: study.id };

  if (to === 'consented') {
    if (study.consentCopy) {
      const c = (await event.data.after.ref.collection('private').doc('consent').get()).data();
      if (c) await notify(after.uid, { ...base, kind: 'consent', channel: 'email', subject: `[${SITE}] 연구참여 동의서 사본 — ${study.title}`, body: `서명 일시: ${D.fmtD(after.consentAt)} ${D.fmtDT(after.consentAt).split(' ')[1]}\n서명: ${c.signature}\n\n${c.items.map((x, i) => `${i + 1}. ${x} — 동의`).join('\n')}\n\n철회는 ${SITE} > 내 참여 기록에서 언제든 할 수 있습니다.` });
    }
    await log('p', `전자동의 서명 (${study.title})`);
  } else if (to === 'scheduled') {
    const slot = (await col('studies').doc(study.id).collection('slots').doc(after.slotId).get()).data() || {};
    await notify(after.uid, { ...base, kind: 'schedule', channel: 'both', subject: `[${SITE}] 일정이 확정되었어요`, body: `${study.title}\n일시: ${D.fmtDT(slot.at)}\n장소: ${study.location}\n\n일정을 바꿔야 하면 연구 화면의 '연구자에게 문의하기'를 이용해 주세요.`, sms: `[한신리서치풀] 일정 확정 ${D.fmtDT(slot.at)} ${study.location}` });
    await log('p', `일정 예약 ${D.fmtDT(slot.at)} (${study.title})`);
  } else if (to === 'completed') {
    await notify(after.uid, { ...base, kind: 'complete', channel: 'email', subject: `[${SITE}] 참여해 주셔서 감사합니다`, body: `${study.title} 연구 참여가 완료되었습니다.\n보상(${D.rewardText(study)})은 ${study.reward.timing} 처리됩니다.` });
    await (from === 'scheduled' ? log('r', `참여 완료 처리 ${after.pid} (${study.title})`) : log('p', `설문 완료 (${study.title})`));
  } else if (to === 'paid') {
    // 상품권은 번호를 아는 연구지원팀이 실제로 보낸 뒤에 "발송되었습니다" 문자가 나간다.
    await notify(after.uid, after.rewardQueue === 'pending'
      ? { ...base, kind: 'reward', channel: 'email', subject: `[${SITE}] 보상 지급이 접수되었어요`, body: `${study.title} 연구의 참여 보상(${D.rewardText(study)}) 지급이 접수되었습니다.\n연구지원팀이 영업일 기준 3일 안에 등록하신 휴대전화 번호로 모바일 상품권을 보내 드립니다.` }
      : { ...base, kind: 'reward', channel: 'sms', body: `[한신리서치풀] 연구 참여 보상 ${D.rewardText(study)} 지급이 처리되었습니다.` });
    await log('r', `보상 지급 처리 ${after.pid} (${study.title})`);
  } else if (to === 'withdrawn' && !after.byAccountDeletion) {
    await notify(after.uid, { ...base, kind: 'withdraw', channel: 'email', subject: `[${SITE}] 참여 철회가 처리되었어요`, body: `${study.title} 연구 참여를 철회했습니다.\n제출한 응답: ${after.dataChoice === '보관' ? '가명 상태로 보관' : '폐기'}` });
    await log('p', `참여 철회 · 자료 ${after.dataChoice} (${study.title})`);
  }
});

// 연구가 바뀔 때: 승인되면 조건에 맞는 대기풀에 안내, 보완 요청이면 연구자에게 메일, 새 공지면 참여자에게 알림.
exports.onStudyUpdate = onDocumentUpdated('studies/{id}', async (event) => {
  const before = event.data.before.data();
  const study = { id: event.params.id, ...event.data.after.data() };
  const now = Date.now();
  if (before.status !== study.status) {
    if (before.status === 'review' && study.status === 'recruiting') {
      let n = 0;
      if (study.notifyPool !== false) {
        const targets = (await pool()).filter((p) => p.active && D.matches(study, p, now) && noticeCount(p, now) < D.WEEKLY_NOTICE_LIMIT);
        const to = await contacts(targets.map((p) => p.uid));
        const w = db.bulkWriter();
        for (const p of targets) {
          await deliver(w, to.get(p.uid), p, { studyId: study.id, kind: 'newstudy', channel: 'email', subject: `[${SITE}] 조건에 맞는 새 연구가 열렸어요`, body: `${study.title} 연구가 모집을 시작했습니다.\n${D.TYPES[study.type]} · 약 ${study.minutes}분 · ${D.rewardText(study)}\n로그인해서 연구설명문을 확인해 보세요.` });
          n++;
        }
        sendLog(w, study, '새 연구 안내', '이메일', '승인 시 자동 안내', n, '조건에 맞는 새 연구가 열렸어요');
        await w.close();
      }
      await mailStaff(study.ownerUid, `[${SITE}] 연구가 승인되어 공개되었어요`, `${study.title} 연구가 승인되어 모집을 시작했습니다.${n ? ` 조건에 맞는 대기풀 ${n}명에게 안내가 나갔습니다.` : ''}`);
      await audit(null, '연구윤리지원팀', '관리자', `연구 승인·공개: ${study.title}${n ? ` · 대기풀 ${n}명 안내` : ''}`);
    } else if (study.status === 'rejected') {
      await mailStaff(study.ownerUid, `[${SITE}] 연구에 보완 요청이 있어요`, `${study.title}\n\n연구지원팀 의견\n${study.reviewComment || ''}\n\n${SITE}에서 내용을 고친 뒤 다시 제출해 주세요.`);
      await audit(null, '연구윤리지원팀', '관리자', `보완 요청: ${study.title}`);
    } else if (study.status === 'review') {
      await audit(study.ownerUid, study.owner.name, '연구자', `심사 제출: ${study.title}`);
    } else if (study.status === 'closed') {
      await audit(study.ownerUid, study.owner.name, '연구자', `모집 마감: ${study.title}`);
    }
    await refreshStats();
  }
  // 새 공지: 동의 완료 이상인 참여자에게 이메일로도 알린다(연구자가 알림을 켠 경우).
  const old = new Set((before.notices || []).map((x) => x.id));
  for (const nt of (study.notices || []).filter((x) => !old.has(x.id))) {
    await audit(study.ownerUid, study.owner.name, '연구자', `공지 등록: ${nt.title} (${study.title})`);
    if (nt.notify === false) continue;
    const targets = rows(await col('enrollments').where('studyId', '==', study.id).get()).filter((e) => D.ACTIVE.includes(e.status));
    const to = await contacts(targets.map((e) => e.uid));
    const w = db.bulkWriter();
    for (const e of targets) await deliver(w, to.get(e.uid), { uid: e.uid, sms: false }, { studyId: study.id, kind: 'notice', channel: 'email', subject: `[공지] ${nt.title}`, body: nt.body });
    sendLog(w, study, '공지', '이메일', '동의 완료 이상', targets.length, `[공지] ${nt.title}`);
    await w.close();
  }
});

// 문의: 새 문의는 연구자에게 메일로 알리고, 답변은 참여자의 알림함과 이메일로 전달한다.
exports.onInquiryWrite = onDocumentWritten('inquiries/{id}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const q = event.data.after.exists ? event.data.after.data() : null;
  if (!q) return;
  const study = await getRow('studies', q.studyId);
  if (!study) return;
  if (!before) return mailStaff(q.ownerUid, `[${SITE}] 새 문의가 도착했어요 — ${study.title}`, `참여자 ${q.pid} 님이 문의를 남겼습니다. ${SITE}에 로그인해 연구의 '문의' 탭에서 확인하고 답변해 주세요.`);
  if (q.reply && !before.reply) await notify(q.uid, { studyId: study.id, kind: 'reply', channel: 'email', subject: `[${SITE}] 문의에 연구자가 답했어요 — ${study.title}`, body: `보내신 문의\n${q.body}\n\n연구자의 답변\n${q.reply}` });
  if (q.reported && !before.reported) await audit(q.ownerUid, study.owner.name, '연구자', `부적절한 문의 신고 ${q.pid} (${study.title})`, q.pid);
});

// 연구윤리지원팀이 연구자를 확인하면 메일로 알린다.
exports.onUserUpdate = onDocumentUpdated('users/{uid}', async (event) => {
  const before = event.data.before.data();
  const u = event.data.after.data();
  if (u.role === 'researcher' && !before.verified && u.verified) {
    await mailStaff(event.params.uid, `[${SITE}] 연구자 확인이 완료되었어요`, `${u.name} 님, 재학 정보와 연구윤리교육 이수증 확인이 끝났습니다. 이제 연구를 심사에 제출할 수 있습니다.`);
    await audit(null, '연구윤리지원팀', '관리자', `연구자 확인: ${u.name} (${u.program})`);
  }
});
exports.onUserCreate = onDocumentCreated('users/{uid}', async (event) => {
  const u = event.data.data();
  if (u.seeded) return; // 시연용 데이터는 기록하지 않는다.
  await audit(event.params.uid, u.role === 'participant' ? u.pid : u.name, u.role === 'participant' ? '참여자' : '연구자', u.role === 'participant' ? '참여자 회원가입' : '연구자 회원가입 (재학·이수증 확인 대기)', u.pid || null);
});
exports.onPoolWrite = onDocumentWritten('pool/{uid}', async () => {
  poolCache = null;
});

// 연구윤리지원팀이 상품권을 보낸 뒤 표시하면 참여자에게 발송 문자가 나간다.
exports.onRewardUpdate = onDocumentUpdated('rewards/{eid}', async (event) => {
  const r = event.data.after.data();
  if (event.data.before.data().sentAt || !r.sentAt) return;
  await col('enrollments').doc(event.params.eid).update({ rewardSentAt: r.sentAt, rewardQueue: 'sent' });
  const study = await getRow('studies', r.studyId);
  await notify(r.uid, { studyId: r.studyId, kind: 'reward', channel: 'sms', body: `[한신리서치풀] 연구 참여 보상 ${D.rewardText(study)}이 발송되었습니다.` });
  await audit(null, '연구윤리지원팀', '관리자', `상품권 발송 완료 ${r.pid} (${study.title})`, r.pid);
});

// ── 첫 화면 통계(누구나 읽는 문서) ──
async function refreshStats() {
  const n = async (q) => (await q.count().get()).data().count;
  const [participants, poolActive, recruiting, done, paid] = await Promise.all([
    n(col('pool')), n(col('pool').where('joined', '==', true).where('paused', '==', false)), n(col('studies').where('status', '==', 'recruiting')),
    n(col('enrollments').where('status', 'in', D.DONE)), n(col('enrollments').where('status', '==', 'paid')),
  ]);
  await col('stats').doc('landing').set({ participants, poolActive, recruiting, done, paid, at: Date.now() });
}

// ── 주기 작업: 모집 마감, 자동 리마인더, 방문 하루 전 안내 ──
exports.jobs = onSchedule({ schedule: 'every 30 minutes', timeZone: 'Asia/Seoul' }, async () => {
  const now = Date.now();
  const today = D.toYMD(now);
  const people = new Map((await pool()).map((p) => [p.uid, p]));
  for (const study of rows(await col('studies').where('status', '==', 'recruiting').get())) {
    if (study.end < today) {
      await col('studies').doc(study.id).update({ status: 'closed', updatedAt: now });
      continue;
    }
    const enr = rows(await col('enrollments').where('studyId', '==', study.id).get());
    const w = db.bulkWriter();
    // 초대 후 3일 동안 응답이 없으면 문자 1회. 주 3회 안내 제한에 포함된다.
    if (study.templates.remind3) {
      const due = enr.filter((e) => e.status === 'invited' && e.source === 'invite' && !e.r3Sent && e.invitedAt < now - 3 * D.DAY && people.has(e.uid) && noticeCount(people.get(e.uid), now) < D.WEEKLY_NOTICE_LIMIT);
      const to = await contacts(due.map((e) => e.uid));
      for (const e of due) {
        await deliver(w, to.get(e.uid), people.get(e.uid), { studyId: study.id, kind: 'reminder', channel: 'sms', subject: `[${SITE}] ${study.title} 참여 안내`, body: D.fillTpl('[한신리서치풀] {{연구명}} 참여 안내를 다시 드려요. {{마감일}} 마감.', study, e.pid) });
        w.update(col('enrollments').doc(e.id), { r3Sent: true });
      }
      if (due.length) sendLog(w, study, '리마인더', '문자', '초대 후 미응답', due.length, '(자동) 초대 3일 후 미응답 리마인더');
    }
    // 모집 마감 2일 전, 동의만 하고 마치지 않은 사람에게 이메일 1회.
    if (study.templates.remindEnd && D.endTs(study.end) - now < 2 * D.DAY) {
      const due = enr.filter((e) => e.status === 'consented' && !e.rendSent);
      const to = await contacts(due.map((e) => e.uid));
      for (const e of due) {
        await deliver(w, to.get(e.uid), { uid: e.uid, sms: false }, { studyId: study.id, kind: 'reminder', channel: 'email', subject: `[${SITE}] ${study.title} 마감이 다가와요`, body: `${e.pid} 님, 동의하신 ${study.title} 연구가 ${D.fmtMD(D.endTs(study.end))}에 마감됩니다.\n로그인해서 남은 단계를 마쳐 주세요. 참여를 원하지 않으면 그대로 두셔도 됩니다.` });
        w.update(col('enrollments').doc(e.id), { rendSent: true });
      }
      if (due.length) sendLog(w, study, '리마인더', '이메일', '동의 후 미완료', due.length, '(자동) 마감 2일 전 리마인더');
    }
    await w.close();
  }
  // 예약한 방문 하루 전에 다시 알린다.
  for (const e of rows(await col('enrollments').where('status', '==', 'scheduled').get())) {
    if (e.daybSent || !e.slotId) continue;
    const slot = (await col('studies').doc(e.studyId).collection('slots').doc(e.slotId).get()).data();
    if (!slot || slot.at <= now || slot.at >= now + D.DAY) continue;
    const study = await getRow('studies', e.studyId);
    await notify(e.uid, { studyId: study.id, kind: 'schedule', channel: 'both', subject: `[${SITE}] 내일 방문 일정이 있어요`, body: `${study.title}\n일시: ${D.fmtDT(slot.at)}\n장소: ${study.location}`, sms: `[한신리서치풀] 방문 안내 ${D.fmtDT(slot.at)} ${study.location}` });
    await col('enrollments').doc(e.id).update({ daybSent: true });
  }
  await refreshStats();
});
