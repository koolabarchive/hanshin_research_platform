// 화면과 Firebase 사이의 데이터 계층.
//  - 로그인은 Firebase Auth, 데이터는 Firestore를 보안 규칙(firestore.rules) 아래에서 직접 읽고 쓴다.
//  - 대기풀을 읽어야 하거나 메일·문자를 보내야 하는 일은 Functions(functions/index.js)를 부른다.
//  - loadState()는 로그인한 사람의 역할에 맞는 화면 데이터(S)를 만든다. 규칙이 허용한 것만 읽힌다.
import { initializeApp } from "firebase/app";
import {
  getAuth, connectAuthEmulator, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, sendEmailVerification, sendPasswordResetEmail, reload, deleteUser,
} from "firebase/auth";
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, collection, query, where, orderBy, limit,
  setDoc, updateDoc, addDoc, writeBatch, runTransaction, arrayUnion, deleteField, Bytes,
} from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import D from "../functions/domain.js";
import { firebaseConfig, REGION, EMULATOR, EMULATOR_PROJECT } from "./firebase-config.js";

const app = initializeApp(EMULATOR ? { apiKey: "demo", projectId: EMULATOR_PROJECT, authDomain: `${EMULATOR_PROJECT}.firebaseapp.com` } : firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const fns = getFunctions(app, REGION);
if (EMULATOR) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8085);
  connectFunctionsEmulator(fns, "127.0.0.1", 5001);
}
const fn = (name) => async (data) => (await httpsCallable(fns, name)(data)).data;

export const demo = EMULATOR;
// 에뮬레이터에서의 규칙 점검용(운영에서는 쓰지 않는다).
export const raw = EMULATOR ? { db, doc, getDoc, getDocs, collection, query, where, setDoc, updateDoc } : null;
// 로그인 상태가 확인될 때까지 기다린다(새로고침해도 로그인이 유지된다).
export const ready = new Promise((resolve) => { const off = onAuthStateChanged(auth, () => { off(); resolve(); }); });

class Oops extends Error {}
const need = (cond, msg) => { if (!cond) throw new Oops(msg); };
const AUTH_ERRORS = {
  "auth/email-already-in-use": "이미 가입된 이메일이에요. 로그인해 주세요.",
  "auth/invalid-email": "이메일 주소를 확인해 주세요.",
  "auth/invalid-credential": "이메일 또는 비밀번호가 맞지 않아요.",
  "auth/wrong-password": "이메일 또는 비밀번호가 맞지 않아요.",
  "auth/user-not-found": "이메일 또는 비밀번호가 맞지 않아요.",
  "auth/too-many-requests": "시도가 너무 많아요. 잠시 후 다시 시도해 주세요.",
  "auth/weak-password": "비밀번호는 10자 이상이어야 해요.",
  "auth/network-request-failed": "서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.",
  "permission-denied": "권한이 없거나 지금은 할 수 없는 작업이에요.",
  "unavailable": "서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.",
};
// 사용자에게 보여 줄 오류 문구. Functions가 보낸 문구는 그대로 쓴다.
export function errorText(e) {
  if (e instanceof Oops) return e.message;
  const code = String((e && e.code) || "").replace(/^(functions|firestore)\//, "");
  if (e && String(e.code || "").startsWith("functions/") && e.message && !["internal", "INTERNAL"].includes(e.message)) return e.message;
  console.error(e);
  return AUTH_ERRORS[e && e.code] || AUTH_ERRORS[code] || "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

const col = (name) => collection(db, name);
const list = async (q) => (await getDocs(q)).docs.map((d) => ({ id: d.id, ...d.data() }));
const one = async (...path) => { const s = await getDoc(doc(db, ...path)); return s.exists() ? { id: s.id, ...s.data() } : null; };
const quiet = (p, fallback) => p.catch(() => fallback); // 규칙이 막은 읽기는 "없음"으로 다룬다.
const byAtDesc = (a, b) => b.at - a.at;
const uidNow = () => auth.currentUser && auth.currentUser.uid;
const rid = (p) => `${p}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-3)}`;
const enrId = (studyId, uid) => `${studyId}__${uid}`;

// 지금 로그인한 사람의 기본 정보(역할 판별용). loadState가 채우고 동작들이 쓴다.
let me = null;

// ── 화면 데이터 만들기 ──────────────────────────────────────
async function withSlots(row, extra = {}) {
  const slots = (await quiet(list(collection(db, "studies", row.id, "slots")), [])).sort((a, b) => a.at - b.at);
  return { ...row, ownerId: row.ownerUid, notices: row.notices || [], slots, ...extra };
}
const auditRow = (a) => ({ at: a.at, actor: a.actor, role: a.role, action: a.action });
function clientEnrollment(e, userId) {
  const { uid, pid, ownerUid, pstatus, ageBand, phoneTail, ...rest } = e;
  return { ...rest, userId, _uid: uid, signed: !!e.consentAt };
}

async function researcherState(user, u, contact) {
  const meOut = { id: user.uid, role: "researcher", name: u.name, email: user.email, phone: contact.phone || "", program: u.program, dept: u.dept, advisor: u.advisor, ethicsDate: u.ethicsDate, ethicsFile: u.ethicsFile || "", ethicsFileId: u.ethicsFileId || "", verified: !!u.verified, joinedAt: u.createdAt };
  const mine = (f) => query(col(f), where("ownerUid", "==", user.uid));
  const [studyRows, enr, qs, logs, audit] = await Promise.all([
    list(mine("studies")), list(mine("enrollments")), list(mine("inquiries")), list(mine("sendLogs")),
    quiet(list(query(col("audit"), where("actorUid", "==", user.uid), orderBy("at", "desc"), limit(30))), []),
  ]);
  const studies = await Promise.all(studyRows.sort((a, b) => b.createdAt - a.createdAt).map((r) => withSlots(r)));
  // 대기풀 인원과 초대 가능 인원은 Functions가 집계해서 준다(연구자는 대기풀을 읽을 수 없다).
  const stats = await quiet(fn("poolStats")({ studyIds: studies.filter((s) => ["recruiting", "review"].includes(s.status)).map((s) => s.id) }), { studies: {}, pool: null });
  for (const s of studies) { const x = stats.studies[s.id]; if (x) { s._poolMatch = x.poolMatch; if (x.elig) s._elig = x.elig; } }
  const users = [meOut];
  const seen = new Set();
  for (const e of enr) {
    if (seen.has(e.pid)) continue;
    seen.add(e.pid);
    // 연구자가 받는 참여자 정보는 이것이 전부다: 가명 ID, 신분, 연령대, 전화번호 끝 네 자리.
    users.push({ id: e.pid, role: "participant", pid: e.pid, phone: `010-****-${e.phoneTail || "0000"}`, profile: { status: e.pstatus || "-", ageBand: e.ageBand || "-" } });
  }
  return {
    users, studies,
    enrollments: enr.map((e) => clientEnrollment(e, e.pid)),
    inquiries: qs.sort(byAtDesc).map((q) => ({ id: q.id, studyId: q.studyId, pid: q.pid, body: q.reported ? "" : q.body, at: q.at, reply: q.reply || "", repliedAt: q.repliedAt || null, reported: !!q.reported })),
    messages: [], sendLogs: logs.sort(byAtDesc).slice(0, 500), audit: audit.map(auditRow), pool: stats.pool || { total: 0, active: 0, paused: 0, smsPct: 0, breakdown: null },
  };
}

async function participantState(user, u, contact) {
  const p = (await one("pool", user.uid)) || {};
  const meOut = {
    id: user.uid, role: "participant", name: contact.name || "", email: user.email, phone: contact.phone || "", pid: u.pid, affiliation: u.affiliation,
    profile: { birthYear: p.birthYear, gender: p.gender, status: p.status, dept: p.dept, year: p.year, interests: p.interests || [], times: p.times || [] },
    contact: { email: true, sms: !!p.sms }, pool: { joined: !!p.joined, paused: !!p.paused, since: p.since }, joinedAt: u.createdAt,
  };
  const [mine, msgs, recruiting, myQs, audit] = await Promise.all([
    list(query(col("enrollments"), where("uid", "==", user.uid))),
    list(query(col("messages"), where("toUid", "==", user.uid), orderBy("at", "desc"), limit(300))),
    list(query(col("studies"), where("status", "==", "recruiting"))),
    list(query(col("inquiries"), where("uid", "==", user.uid))),
    quiet(list(query(col("audit"), where("pid", "==", u.pid), orderBy("at", "desc"), limit(30))), []),
  ]);
  // 모집 중인 연구 + 내가 참여했거나 안내를 받은 연구(마감된 것 포함)
  const have = new Set(recruiting.map((r) => r.id));
  const wanted = [...new Set([...mine.map((e) => e.studyId), ...msgs.map((m) => m.studyId).filter(Boolean)])].filter((id) => !have.has(id));
  const extra = (await Promise.all(wanted.map((id) => quiet(one("studies", id), null)))).filter(Boolean);
  const studies = await Promise.all([...recruiting, ...extra].sort((a, b) => (b.approvedAt || 0) - (a.approvedAt || 0)).map((r) => withSlots(r, { _done: r.doneCount || 0 })));
  const visible = new Set(studies.map((s) => s.id));
  const owners = new Map(studies.map((s) => [s.ownerUid, { id: s.ownerUid, role: "researcher", name: s.owner.name, program: s.owner.program, dept: s.owner.dept }]));
  // 내 서명과 서명 당시 동의서 사본은 나만 읽을 수 있다.
  const enrollments = await Promise.all(mine.filter((e) => visible.has(e.studyId)).map(async (e) => {
    const out = clientEnrollment(e, user.uid);
    if (e.consentAt) { const c = await quiet(one("enrollments", e.id, "private", "consent"), null); if (c) { out.signature = c.signature; out.consentDoc = { title: c.title, irbNo: c.irbNo, items: c.items }; } }
    return out;
  }));
  return {
    users: [meOut, ...owners.values()], studies, enrollments,
    inquiries: myQs.sort(byAtDesc).map((q) => ({ id: q.id, studyId: q.studyId, body: q.body, at: q.at, reply: q.reply || "", repliedAt: q.repliedAt || null })),
    messages: msgs.map((m) => ({ ...m, studyId: m.studyId && visible.has(m.studyId) ? m.studyId : null, toUserId: user.uid })),
    sendLogs: [],
    // 내 정보를 누가 어떻게 처리했는지(보상 지급, 완료 처리 등) 본인이 확인할 수 있게 한다.
    audit: audit.filter((a) => a.actorUid !== user.uid).slice(0, 10).map(auditRow),
  };
}

async function adminState(user) {
  const now = Date.now();
  const [researchers, studyRows, rewards, reported, audit] = await Promise.all([
    list(query(col("users"), where("role", "==", "researcher"))), list(col("studies")), list(col("rewards")),
    list(query(col("inquiries"), where("reported", "==", true), limit(50))), list(query(col("audit"), orderBy("at", "desc"), limit(200))),
  ]);
  const studies = await Promise.all(studyRows.sort((a, b) => b.createdAt - a.createdAt).map((r) => withSlots(r, { _done: r.doneCount || 0 })));
  const stats = await quiet(fn("poolStats")({ studyIds: studies.filter((s) => s.status === "review").map((s) => s.id) }), { studies: {} });
  for (const s of studies) if (stats.studies[s.id]) s._poolMatch = stats.studies[s.id].poolMatch;
  const contactOf = async (uid) => (await quiet(one("users", uid, "private", "contact"), null)) || {};
  // 상품권 발송 대기 건만 전체 번호를 읽는다. 발송이 끝난 건은 끝 네 자리만 보인다.
  const queue = rewards.filter((r) => !r.sentAt || r.sentAt > now - 14 * D.DAY).sort((a, b) => (a.sentAt ? 1 : 0) - (b.sentAt ? 1 : 0) || a.paidAt - b.paidAt);
  const rewardQueue = await Promise.all(queue.map(async (r) => {
    const phone = r.sentAt ? null : (await contactOf(r.uid)).phone;
    return { id: r.id, pid: r.pid, phone: phone || "발송 완료", study: r.study, amount: r.amount, paidAt: r.paidAt, sentAt: r.sentAt || null };
  }));
  const people = await Promise.all(researchers.filter((r) => !r.deleted).sort((a, b) => (a.verified ? 1 : 0) - (b.verified ? 1 : 0) || b.createdAt - a.createdAt).map(async (r) => ({
    id: r.id, role: "researcher", name: r.name, email: (await contactOf(r.id)).email || "", program: r.program, dept: r.dept, advisor: r.advisor,
    ethicsDate: r.ethicsDate, ethicsFile: r.ethicsFile || "", ethicsFileId: r.ethicsFileId || "", verified: !!r.verified, joinedAt: r.createdAt,
  })));
  return {
    users: [{ id: user.uid, role: "admin", name: "연구윤리지원팀", email: user.email }, ...people],
    studies, enrollments: [], rewardQueue,
    inquiries: reported.sort(byAtDesc).map((q) => ({ id: q.id, studyId: q.studyId, pid: q.pid, body: q.body, at: q.at })),
    messages: [], sendLogs: [], audit: audit.map(auditRow),
  };
}

export async function loadState() {
  const stats = (await quiet(one("stats", "landing"), null)) || {};
  const base = { v: 1, session: null, demo: EMULATOR, needVerify: false, users: [], studies: [], enrollments: [], inquiries: [], messages: [], sendLogs: [], audit: [], stats };
  const user = auth.currentUser;
  // me는 다 읽은 뒤에 한 번에 바꾼다. 읽는 도중에 비워 두면 그 사이에 실행된 동작이 사용자 정보를 잃는다.
  if (!user) { me = null; return base; }
  if (await quiet(one("admins", user.uid), null)) {
    me = { role: "admin", uid: user.uid };
    return { ...base, ...(await adminState(user)), session: user.uid };
  }
  const u = await one("users", user.uid);
  if (!u || u.deleted) { me = null; await signOut(auth); return base; }
  const contact = (await quiet(one("users", user.uid, "private", "contact"), null)) || {};
  me = { ...u, uid: user.uid, name: u.name || contact.name, contact };
  // 이메일 인증 전에는 연구 목록을 읽을 수 없다(규칙). 인증 안내 화면만 보여 준다.
  if (!user.emailVerified) {
    return { ...base, session: user.uid, needVerify: true, users: [{ id: user.uid, role: u.role, name: me.name || "", email: user.email, pid: u.pid, profile: {}, contact: {}, pool: {} }] };
  }
  const scoped = u.role === "researcher" ? await researcherState(user, u, contact) : await participantState(user, u, contact);
  return { ...base, ...scoped, session: user.uid };
}

// 등록 화면의 "조건에 맞는 대기풀 인원".
export const poolCount = async (criteria) => (await fn("poolStats")({ criteria })).countText || "-";

// ── 첨부 파일 ──────────────────────────────────────────────
// Firestore 문서는 1MB를 넘을 수 없어서 본문을 files/{id}/chunks 에 나눠 담는다.
const MAGIC = [["application/pdf", [0x25, 0x50, 0x44, 0x46, 0x2d]], ["image/png", [0x89, 0x50, 0x4e, 0x47]], ["image/jpeg", [0xff, 0xd8, 0xff]]];
const CHUNK = 700 * 1024;
async function saveFile(kind, file, { pdfOnly = false } = {}) {
  need(file && file.data && file.name, "파일을 첨부해 주세요.");
  const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
  need(bytes.length > 0 && bytes.length <= 5 * 1024 * 1024, "파일은 5MB 이하만 올릴 수 있어요.");
  const hit = MAGIC.find(([, sig]) => sig.every((b, i) => bytes[i] === b));
  need(hit && (!pdfOnly || hit[0] === "application/pdf"), pdfOnly ? "PDF 파일만 올릴 수 있어요." : "PDF, JPG, PNG 파일만 올릴 수 있어요.");
  const id = rid("f");
  const n = Math.ceil(bytes.length / CHUNK);
  const name = String(file.name).split(/[\\/]/).pop().slice(0, 120);
  await setDoc(doc(db, "files", id), { ownerUid: uidNow(), kind, name, mime: hit[0], size: bytes.length, chunks: n, createdAt: Date.now() });
  for (let i = 0; i < n; i++) await setDoc(doc(db, "files", id, "chunks", String(i).padStart(3, "0")), { data: Bytes.fromUint8Array(bytes.subarray(i * CHUNK, (i + 1) * CHUNK)) });
  return { id, name };
}
// 올린 본인과 연구윤리지원팀만 받을 수 있다(규칙). 브라우저에서 파일로 저장한다.
export async function downloadFile(id) {
  const meta = await one("files", id);
  need(meta, "파일을 찾을 수 없어요.");
  const chunks = (await list(collection(db, "files", id, "chunks"))).sort((a, b) => a.id.localeCompare(b.id));
  const url = URL.createObjectURL(new Blob(chunks.map((c) => c.data.toUint8Array()), { type: meta.mime }));
  const a = Object.assign(document.createElement("a"), { href: url, download: meta.name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  if (me && me.role === "admin") await log(`첨부 파일 열람: ${meta.name}`);
}

const ROLE_NAME = { admin: "관리자", researcher: "연구자", participant: "참여자" };
// 화면에서 남기는 처리 기록(자료 내려받기 등). 상태 변화에 따른 기록은 Functions가 남긴다.
const log = (action, pid = null) => addDoc(col("audit"), { at: Date.now(), actorUid: uidNow(), actor: me.role === "admin" ? "연구윤리지원팀" : me.role === "participant" ? me.pid : me.name, role: ROLE_NAME[me.role], action, pid, client: true });

// ── 연구 저장 ──────────────────────────────────────────────
async function persistDraft(raw, status) {
  need(me && me.role === "researcher", "연구자만 할 수 있어요.");
  const now = Date.now();
  const d = D.sanitizeDraft(raw, now);
  const { slots, ...fields } = d;
  const existing = raw.id ? await quiet(one("studies", raw.id), null) : null;
  need(!existing || (existing.ownerUid === me.uid && ["draft", "rejected"].includes(existing.status)), "심사 중이거나 공개된 연구는 고칠 수 없어요.");
  const hasFile = !!raw.irbFileId;
  if (status === "review") {
    need(me.verified, "연구지원팀의 연구자 확인이 끝나면 제출할 수 있어요.");
    const miss = D.checks(d, hasFile).filter((c) => !c[1]).map((c) => c[0]);
    need(!miss.length, `채워야 할 항목: ${miss.join(", ")}`);
  }
  const id = existing ? existing.id : rid("s");
  const data = {
    ...fields, ownerUid: me.uid, owner: { name: me.name, program: me.program, dept: me.dept }, status, slotCount: slots.length,
    irbFile: hasFile ? String(raw.irbFile || "") : "", irbFileId: hasFile ? String(raw.irbFileId) : "",
    notices: existing ? existing.notices || [] : [], doneCount: existing ? existing.doneCount || 0 : 0,
    createdAt: existing ? existing.createdAt : now, updatedAt: now,
    ...(status === "review" ? { submittedAt: now, reviewComment: "" } : existing && existing.reviewComment ? { reviewComment: existing.reviewComment } : {}),
  };
  // 순서가 중요하다(규칙): 연구 문서는 '작성 중'으로만 만들 수 있고, 예약 시간은 작성 중·보완 요청 상태에서만 바꿀 수 있다.
  // 그래서 ① 새 연구면 먼저 작성 중으로 만들고 ② 예약 시간을 바꾼 뒤 ③ 마지막에 내용과 상태를 쓴다.
  if (!existing) await setDoc(doc(db, "studies", id), { ...data, status: "draft" });
  // 초안 단계에는 예약자가 없으므로 예약 시간을 통째로 바꿔도 된다. 규칙의 문서 조회 한도 때문에 조금씩 나눠 쓴다.
  const old = await quiet(list(collection(db, "studies", id, "slots")), []);
  const ops = [...old.map((x) => (b) => b.delete(doc(db, "studies", id, "slots", x.id))), ...slots.map((x) => (b) => b.set(doc(db, "studies", id, "slots", rid("slot")), { at: x.at, cap: x.cap, booked: 0 }))];
  for (let i = 0; i < ops.length; i += 5) { const batch = writeBatch(db); ops.slice(i, i + 5).forEach((op) => op(batch)); await batch.commit(); }
  if (existing || status !== "draft") await setDoc(doc(db, "studies", id), data);
  return { id, title: d.title };
}

const myStudy = async (id) => { const s = await quiet(one("studies", id), null); need(s && s.ownerUid === uidNow(), "연구를 찾을 수 없어요."); return s; };
const touch = (id, fields) => updateDoc(doc(db, "studies", id), { ...fields, updatedAt: Date.now() });
const PHONE_RE = /^01\d-?\d{3,4}-?\d{4}$/;
const DEMO = { participant: "haeun.lee@hs.ac.kr", researcher: "seoyun.kim@hs.ac.kr", admin: "research-ethics@hs.ac.kr" };
const DEMO_PASSWORD = "demo-password-1234";

// ── 동작 ───────────────────────────────────────────────────
// 화면의 call(name, payload)가 여기로 온다. 규칙이 허용하지 않는 쓰기는 Firestore가 거부한다.
const A = {
  // ════ 로그인·가입 ════
  async signup(p) {
    const isP = p.role !== "researcher";
    const name = D.line(p.name, 30), phone = D.line(p.phone, 20), email = D.line(p.email, 120).toLowerCase();
    need(name.length >= 2, "이름을 입력해 주세요.");
    need(PHONE_RE.test(phone), "휴대전화 번호를 010-0000-0000 형식으로 입력해 주세요.");
    need(String(p.pw || "").length >= 10, "비밀번호는 10자 이상이어야 해요.");
    need(p.a1 && p.a2, "필수 항목에 동의해 주세요.");
    const campusMail = email.endsWith("@hs.ac.kr");
    const now = Date.now();
    let pool = null, researcher = null;
    if (isP) {
      const birthYear = Number(p.by), status = D.STATUSES.includes(p.status) ? p.status : null;
      need(birthYear && D.GENDERS.includes(p.gender) && status, "출생연도, 성별, 신분을 모두 골라 주세요.");
      need(new Date().getFullYear() - birthYear >= D.MIN_AGE, `만 ${D.MIN_AGE}세 이상만 가입할 수 있어요.`);
      const campus = status !== D.EXTERNAL_STATUS;
      need(!campus || campusMail, `학부생·대학원생·교직원은 학교 이메일(@hs.ac.kr)로 가입해 주세요. 학교 계정이 없다면 '${D.EXTERNAL_STATUS}'으로 가입할 수 있어요.`);
      const dept = !campus ? "학외" : status === "교직원" ? "교직원" : D.DEPTS.includes(p.dept) ? p.dept : null;
      need(dept, "학과를 골라 주세요.");
      pool = { birthYear, gender: p.gender, status, dept, year: campus && ["1학년", "2학년", "3학년", "4학년"].includes(p.year) ? p.year : "해당 없음", interests: D.subset(p.interests, D.INTERESTS), times: D.subset(p.times, D.TIMES), sms: p.sms !== false, joined: false, paused: false, since: now, wantJoin: p.a3 !== false, phoneTail: phone.replace(/\D/g, "").slice(-4) };
    } else {
      need(campusMail, "연구자는 학교 이메일(@hs.ac.kr)로만 가입할 수 있어요.");
      const dept = D.line(p.rdept, 60), advisor = D.line(p.adv, 40);
      need(dept && advisor && /^\d{4}-\d{2}-\d{2}$/.test(String(p.eth || "")), "소속, 지도교수, 윤리교육 이수일을 입력해 주세요.");
      need(p.ethFile && p.ethFile.data, "연구윤리교육 이수증을 첨부해 주세요.");
      researcher = { role: "researcher", name, program: D.PROGRAMS.includes(p.prog) ? p.prog : "석사과정", dept, advisor, ethicsDate: p.eth, verified: false, createdAt: now };
    }
    const cred = await createUserWithEmailAndPassword(auth, email, String(p.pw));
    const uid = cred.user.uid;
    try {
      const contact = { name, phone, email };
      if (isP) {
        // 가명 ID가 겹치면 규칙이 거부하므로 다른 번호로 다시 시도한다.
        for (let i = 0; ; i++) {
          const pid = `P-${1000 + Math.floor(Math.random() * 90000)}`;
          const batch = writeBatch(db);
          batch.set(doc(db, "pids", pid), { uid });
          batch.set(doc(db, "users", uid), { role: "participant", pid, affiliation: pool.status === D.EXTERNAL_STATUS ? "external" : "campus", createdAt: now });
          batch.set(doc(db, "users", uid, "private", "contact"), contact);
          batch.set(doc(db, "pool", uid), { ...pool, pid });
          try { await batch.commit(); break; } catch (e) { if (i >= 4) throw e; }
        }
      } else {
        const batch = writeBatch(db);
        batch.set(doc(db, "users", uid), researcher);
        batch.set(doc(db, "users", uid, "private", "contact"), contact);
        await batch.commit();
        const file = await saveFile("ethics", p.ethFile);
        await updateDoc(doc(db, "users", uid), { ethicsFile: file.name, ethicsFileId: file.id });
      }
    } catch (e) {
      await quiet(deleteUser(cred.user)); // 프로필을 만들지 못했으면 로그인 계정도 남기지 않는다.
      throw e;
    }
    await quiet(sendEmailVerification(cred.user));
    return { toast: "인증 메일을 보냈어요. 메일의 링크를 누르면 가입이 완료됩니다." };
  },
  async login(p) { await signInWithEmailAndPassword(auth, D.line(p.email, 120).toLowerCase(), String(p.pw || "")); return {}; },
  async demoLogin(p) { need(EMULATOR && DEMO[p.who], "시연 모드가 아니에요."); await signInWithEmailAndPassword(auth, DEMO[p.who], DEMO_PASSWORD); return {}; },
  async logout() { await signOut(auth); return {}; },
  // 가입된 주소인지 화면에서는 알 수 없게 같은 문구로 답한다.
  async forgot(p) { await quiet(sendPasswordResetEmail(auth, D.line(p.email, 120).toLowerCase())); return { toast: "가입된 주소라면 비밀번호 재설정 메일을 보냈어요." }; },
  async resendVerify() { await sendEmailVerification(auth.currentUser); return { toast: "인증 메일을 다시 보냈어요." }; },
  async checkVerified() {
    await reload(auth.currentUser);
    need(auth.currentUser.emailVerified, "아직 인증되지 않았어요. 메일의 링크를 누른 뒤 다시 시도해 주세요.");
    await auth.currentUser.getIdToken(true); // 인증 여부가 담긴 새 토큰을 받아야 규칙이 인정한다.
    const p = await quiet(one("pool", uidNow()), null);
    if (p && p.wantJoin && !p.joined) await updateDoc(doc(db, "pool", uidNow()), { joined: true, since: Date.now() });
    return { toast: me && me.role === "researcher" ? "이메일 인증을 마쳤어요. 연구지원팀 확인 후 심사 제출이 열립니다." : `이메일 인증을 마쳤어요. 가명 ID는 ${me ? me.pid : ""}입니다.` };
  },

  // ════ 연구자 ════
  async uploadIrb(p) { return { file: await saveFile("irb", p.file, { pdfOnly: true }) }; },
  async saveDraft(p) { const { id } = await persistDraft(p.draft, "draft"); return { id, toast: "임시 저장했어요. 내 연구 목록에서 이어서 작성할 수 있어요." }; },
  async submitStudy(p) { need(p.pledge, "IRB 승인 내용과 같은지 확인란에 체크해 주세요."); const { id } = await persistDraft(p.draft, "review"); return { id, toast: "심사에 제출했어요. 결과는 이 화면과 할 일 목록에서 확인할 수 있어요." }; },
  async closeStudy(p) { await myStudy(p.id); await touch(p.id, { status: "closed" }); return { toast: "모집을 마감했어요." }; },
  async markDone(p) { await updateDoc(doc(db, "enrollments", p.id), { status: "completed", completedAt: Date.now() }); return { toast: "참여 완료로 바꿨어요." }; },
  sendInvites: (p) => fn("invite")({ studyId: p.id, n: p.n, ch: p.ch }),
  sendCompose: (p) => fn("compose")({ studyId: p.id, seg: p.seg, ch: p.ch, subj: p.subj, body: p.body }),
  async addNotice(p) {
    const title = D.line(p.title, 120), body = D.text(p.body, 2000).trim();
    need(title && body, "제목과 내용을 입력해 주세요.");
    await myStudy(p.id);
    await touch(p.id, { notices: arrayUnion({ id: rid("n"), at: Date.now(), title, body, notify: p.notify !== false }) });
    return { toast: p.notify !== false ? "공지를 등록했어요. 동의를 마친 참여자에게 이메일로도 알립니다." : "공지를 등록했어요." };
  },
  async setReminder(p) { need(["remind3", "remindEnd"].includes(p.key), "알 수 없는 설정이에요."); await touch(p.id, { [`templates.${p.key}`]: !!p.value }); return { toast: "자동 리마인더 설정을 저장했어요." }; },
  async pay(p) {
    const study = await myStudy(p.id);
    need(study.reward.amount > 0, "보상이 없는 연구예요.");
    const gift = study.reward.type === "모바일 상품권";
    const ids = new Set((p.ids || []).map(String));
    const rows = (await list(query(col("enrollments"), where("ownerUid", "==", uidNow()), where("studyId", "==", study.id)))).filter((e) => e.status === "completed" && ids.has(e.id));
    need(rows.length, "지급할 건을 골라 주세요.");
    const now = Date.now();
    // 보안 규칙이 한 번의 쓰기에서 조회할 수 있는 문서 수에 한도가 있어, 5건씩 나눠 처리한다.
    for (let i = 0; i < rows.length; i += 5) {
      const batch = writeBatch(db);
      for (const e of rows.slice(i, i + 5)) {
        batch.update(doc(db, "enrollments", e.id), { status: "paid", paidAt: now, ...(gift ? { rewardQueue: "pending" } : {}) });
        // 상품권은 연구자가 번호를 모르므로 연구윤리지원팀에 발송을 요청한다.
        if (gift) batch.set(doc(db, "rewards", e.id), { uid: e.uid, pid: e.pid, studyId: study.id, ownerUid: uidNow(), study: study.title, amount: study.reward.amount, paidAt: now, sentAt: null });
      }
      await batch.commit();
    }
    return { toast: gift ? `${rows.length}건을 지급 처리했어요. 상품권은 연구지원팀이 발송합니다.` : `${rows.length}건을 지급 처리했어요.` };
  },
  async logExport(p) { const s = await myStudy(p.id); await log(p.kind === "ledger" ? `지급 대장 복사 (${s.title})` : `응답 데이터 열람·복사 (${s.title})`); return {}; },
  async replyInquiry(p) { const body = D.text(p.body, 2000).trim(); need(body, "답변 내용을 입력해 주세요."); await updateDoc(doc(db, "inquiries", p.id), { reply: body, repliedAt: Date.now() }); return { toast: "답변을 보냈어요. 참여자의 알림함과 이메일로 전달됩니다." }; },
  async reportInquiry(p) { await updateDoc(doc(db, "inquiries", p.id), { reported: true }); return { toast: "신고했어요. 내용은 가려지고 연구지원팀이 확인합니다." }; },

  // ════ 참여자 ════
  async apply(p) {
    const uid = uidNow();
    if (await quiet(one("enrollments", enrId(p.studyId, uid)), null)) return {};
    const [study, pool] = await Promise.all([one("studies", p.studyId), one("pool", uid)]);
    need(study && study.status === "recruiting", "모집이 끝난 연구예요.");
    need(D.matches(study, pool), "참여 조건에 맞지 않아요.");
    need((study.doneCount || 0) < study.target, "모집 인원이 모두 찼어요.");
    await setDoc(doc(db, "enrollments", enrId(study.id, uid)), { studyId: study.id, uid, pid: me.pid, ownerUid: study.ownerUid, status: "invited", source: "self", invitedAt: Date.now(), pstatus: pool.status, ageBand: D.ageBand(D.ageOf(pool)), phoneTail: pool.phoneTail });
    return {};
  },
  async consent(p) {
    const uid = uidNow(), study = await one("studies", p.studyId);
    need(study && study.status === "recruiting", "모집이 끝난 연구예요.");
    const items = study.consent.filter((c) => c.trim());
    need(Array.isArray(p.checks) && study.consent.every((c, i) => !c.trim() || p.checks[i] === true), "모든 동의 항목에 체크해야 참여할 수 있어요.");
    const signature = D.line(p.signature, 30);
    need(signature === me.contact.name, "서명란에 가입할 때 등록한 이름을 입력해 주세요.");
    const now = Date.now(), id = enrId(study.id, uid);
    const batch = writeBatch(db);
    batch.update(doc(db, "enrollments", id), { status: "consented", consentAt: now, consentVersion: D.fmtD(study.updatedAt) });
    batch.set(doc(db, "enrollments", id, "private", "consent"), { signature, items, title: study.title, irbNo: study.irbNo, at: now });
    await batch.commit();
    return {};
  },
  async finish(p) {
    const uid = uidNow(), study = await one("studies", p.studyId);
    need(study && ["recruiting", "closed"].includes(study.status), "지금은 참여할 수 없는 연구예요.");
    const now = Date.now();
    let responses = null;
    if (study.survey.length) {
      responses = D.cleanAnswers(study.survey, p.answers);
      const miss = study.survey.findIndex((q) => q.required && !D.hasAns(responses[q.id]));
      need(miss < 0, `${miss + 1}번 문항에 답해 주세요.`);
    }
    const extra = responses ? { responses } : {};
    const eRef = doc(db, "enrollments", enrId(study.id, uid));
    // 참여 상태와 예약 정원을 같이 확인하고 같이 바꾼다. 동시에 신청해도 정원을 넘지 않는다(규칙도 같은 조건을 확인).
    await runTransaction(db, async (t) => {
      const e = (await t.get(eRef)).data();
      need(e && e.status === "consented", "먼저 동의를 마쳐 주세요.");
      if (!study.slotCount) return t.update(eRef, { status: "completed", completedAt: now, ...extra });
      need(p.slotId, "시간을 하나 골라 주세요.");
      const sRef = doc(db, "studies", study.id, "slots", String(p.slotId));
      const slot = (await t.get(sRef)).data();
      need(slot && slot.at > now, "시간을 하나 골라 주세요.");
      need(slot.booked < slot.cap, "방금 그 시간이 마감됐어요. 다른 시간을 골라 주세요.");
      t.update(sRef, { booked: slot.booked + 1 });
      t.update(eRef, { status: "scheduled", slotId: String(p.slotId), ...extra });
    });
    return {};
  },
  async withdraw(p) {
    const destroy = p.choice !== "keep";
    const eRef = doc(db, "enrollments", String(p.id));
    await runTransaction(db, async (t) => {
      const e = (await t.get(eRef)).data();
      need(e && e.uid === uidNow(), "참여 기록을 찾을 수 없어요.");
      need(e.status !== "withdrawn", "이미 철회한 연구예요.");
      if (e.status === "scheduled" && e.slotId) {
        const sRef = doc(db, "studies", e.studyId, "slots", e.slotId);
        t.update(sRef, { booked: Math.max(0, (await t.get(sRef)).data().booked - 1) });
      }
      t.update(eRef, { status: "withdrawn", withdrawnAt: Date.now(), dataChoice: destroy ? "폐기" : "보관", ...(destroy ? { responses: deleteField() } : {}) });
    });
    return { toast: "철회를 처리했어요." };
  },
  async ask(p) {
    const body = D.text(p.body, 1000).trim();
    need(body.length >= 5, "문의 내용을 조금 더 자세히 적어 주세요.");
    const study = await one("studies", p.studyId);
    need(study, "연구를 찾을 수 없어요.");
    await addDoc(col("inquiries"), { studyId: study.id, ownerUid: study.ownerUid, uid: uidNow(), pid: me.pid, body, at: Date.now(), reported: false });
    return { toast: "문의를 보냈어요. 답변은 알림함과 이메일로 알려드릴게요." };
  },
  async togglePause() {
    const p = await one("pool", uidNow());
    if (!p.joined) { await updateDoc(doc(db, "pool", uidNow()), { joined: true, paused: false, since: Date.now() }); return { toast: "다시 안내를 받아요." }; }
    await updateDoc(doc(db, "pool", uidNow()), { paused: !p.paused });
    return { toast: !p.paused ? "새 연구 안내를 잠시 멈췄어요." : "다시 안내를 받아요." };
  },
  async setPref(p) {
    const field = { "pool.joined": "joined", "pool.paused": "paused", "contact.sms": "sms" }[p.key];
    need(field, "알 수 없는 설정이에요.");
    await updateDoc(doc(db, "pool", uidNow()), { [field]: !!p.value, ...(field === "joined" && p.value ? { since: Date.now() } : {}) });
    return { toast: "저장했어요." };
  },
  async setProfileList(p) {
    const allowed = { interests: D.INTERESTS, times: D.TIMES }[p.path];
    need(allowed, "알 수 없는 항목이에요.");
    await updateDoc(doc(db, "pool", uidNow()), { [p.path]: D.subset(p.values, allowed) });
    return { toast: "저장했어요." };
  },
  async readMsg(p) { await quiet(updateDoc(doc(db, "messages", String(p.id)), { read: true })); return {}; },
  async readAll() {
    const batch = writeBatch(db);
    for (const m of await list(query(col("messages"), where("toUid", "==", uidNow()), where("read", "==", false)))) batch.update(doc(db, "messages", m.id), { read: true });
    await batch.commit();
    return {};
  },
  async deleteAccount() { const r = await fn("deleteAccount")({}); await quiet(signOut(auth)); return r; },

  // ════ 관리자(연구윤리지원팀) ════
  async verify(p) { await updateDoc(doc(db, "users", String(p.id)), { verified: true }); return { toast: "확인했어요. 이제 심사 제출이 열립니다." }; },
  async approve(p) {
    const study = await one("studies", p.id), today = D.toYMD(Date.now());
    need(study && study.status === "review", "심사 중인 연구가 아니에요.");
    need(study.irbUntil >= today && study.end >= today, "IRB 승인 기간이나 모집 마감일이 이미 지났어요. 보완 요청으로 돌려보내 주세요.");
    await touch(p.id, { status: "recruiting", approvedAt: Date.now(), notifyPool: p.notify !== false, ...(study.start > today ? { start: today } : {}) });
    return { toast: p.notify !== false ? "승인했어요. 조건에 맞는 대기풀에 안내가 나갑니다." : "승인했어요." };
  },
  async reject(p) { const c = D.text(p.comment, 2000).trim(); need(c, "연구자에게 보낼 의견을 적어 주세요."); await touch(p.id, { status: "rejected", reviewComment: c }); return { toast: "보완 요청을 보냈어요." }; },
  async rewardSent(p) { for (const id of p.ids || []) await updateDoc(doc(db, "rewards", String(id)), { sentAt: Date.now() }); return { toast: "발송 완료로 표시했어요. 참여자에게 발송 안내 문자가 나갑니다." }; },
};

export async function act(name, payload) {
  if (!A[name]) throw new Oops("알 수 없는 요청이에요.");
  return (await A[name](payload || {})) || {};
}
