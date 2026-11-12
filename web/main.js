// 한신 리서치풀 — 화면 코드.
// 데이터 계층(data.js)이 Firestore에서 읽어 온 데이터(S)를 그리고, 사용자의 동작을 데이터 계층에 전달한다.
// 이 파일을 고친 뒤에는 npm run build 로 public/app.js 를 다시 만든다.
import * as HS from "./data.js";
"use strict";
/* ========== 상수 ========== */
const DAY = 864e5;
const DEPTS_UG = ["심리아동학부","사회복지학과","재활상담학과","경영학과","미디어영상광고홍보학부","컴퓨터공학부","AI·SW융합학부","신학과","한국사학과","국제경제학과","응용통계학과","유아교육과"];
const DEPTS = [...DEPTS_UG, "일반대학원"];
const EXTERNAL = "학외 일반인";
const STATUSES = ["학부생","대학원생","교직원",EXTERNAL];
const GENDERS = ["여성","남성"];
const INTERESTS = ["심리·정서","학습·교육","건강·운동","미디어·SNS","AI·기술","사회·복지","조직·경영"];
const TIMES = ["평일 오전","평일 오후","평일 저녁","주말"];
const TYPES = {survey:"온라인 설문", lab:"대면 실험", interview:"면담", program:"상담·프로그램", longitudinal:"종단 연구"};
const ONSITE = ["lab","interview","program"]; // 장소와 예약 시간이 필요한 유형
const TYPE_TAG = {survey:"tag-sky", lab:"tag-green", interview:"tag-orange", program:"tag-rose", longitudinal:"tag-purple"};
const REWARD_TYPES = ["모바일 상품권","현금","없음"];
const TINTS = {sky:["var(--t-sky)","#0075de"], mint:["var(--t-mint)","#1aae39"], peach:["var(--t-peach)","#dd5b00"], lav:["var(--t-lav)","#7b3ff2"], rose:["var(--t-rose)","#ff64c8"], yellow:["var(--t-yellow)","#d9b300"], cream:["var(--t-cream)","#523410"]};
const ST_STATUS = {draft:["작성 중","tag-gray"], review:["심사 중","tag-orange"], recruiting:["모집 중","tag-green"], closed:["모집 마감","tag-gray"], rejected:["보완 요청","tag-rose"]};
const EN_STATUS = {invited:["초대됨","tag-sky"], consented:["동의 완료","tag-purple"], scheduled:["일정 확정","tag-yellow"], completed:["참여 완료","tag-green"], paid:["보상 지급","tag-cream"], withdrawn:["철회","tag-rose"]};
const LIKERT = ["전혀 아니다","아니다","보통이다","그렇다","매우 그렇다"];
const EXPL = [["purpose","연구 목적"],["procedure","연구 절차"],["risks","예상되는 위험과 불편"],["benefits","기대 이익과 보상"],["privacy","개인정보 보호와 자료 보관"],["withdraw","참여 철회"],["contact","문의처"]];
const QTYPES = {likert:"5점 척도", single:"단일 선택", multi:"복수 선택", short:"단답형", long:"서술형"};
const ACTIVE = ["consented","scheduled","completed","paid"];
const DONE = ["completed","paid"];

/* ========== 유틸 ========== */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid = p => p + "-" + Math.random().toString(36).slice(2, 9);
const pad = n => String(n).padStart(2, "0");
const toYMD = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const endTs = ymd => new Date(ymd + "T23:59:59").getTime();
const fmtD = t => { const d = new Date(t); return `${d.getFullYear()}.${pad(d.getMonth()+1)}.${pad(d.getDate())}`; };
const fmtMD = t => { const d = new Date(t); return `${d.getMonth()+1}월 ${d.getDate()}일`; };
const WD = ["일","월","화","수","목","금","토"];
const fmtDT = t => { const d = new Date(t); return `${d.getMonth()+1}/${d.getDate()}(${WD[d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const won = n => Number(n || 0).toLocaleString("ko-KR") + "원";
const dday = ymd => { const n = Math.ceil((endTs(ymd) - Date.now()) / DAY) - 1; return n > 0 ? `D-${n}` : n === 0 ? "오늘 마감" : "마감"; };
const getPath = (o, p) => p.split(".").reduce((a, k) => a == null ? a : a[k], o);
const setPath = (o, p, v) => { const ks = p.split("."); const last = ks.pop(); const t = ks.reduce((a, k) => a[k], o); t[last] = v; };
const clone = o => JSON.parse(JSON.stringify(o));
const eucBytes = s => { let b = 0; for (const ch of String(s)) b += ch.charCodeAt(0) > 127 ? 2 : 1; return b; };
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const shuffle = (arr, r = Math.random) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
const IC = {
  home:'<path d="M3.5 10.5 12 3.5l8.5 7V20.5h-5.5v-6h-6v6H3.5z"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  users:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.7c1.9.8 3.1 2.6 3.5 5.3"/>',
  mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 7 8.5-7"/>',
  inbox:'<path d="M3 13h5l1.5 3h5l1.5-3h5"/><path d="M5.5 5h13L21 13v6H3v-6z"/>',
  search:'<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.3-6.5 8-6.5s7 2.5 8 6.5"/>',
  shield:'<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path d="m8.8 12 2.2 2.2 4.4-4.4"/>',
  check:'<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  gift:'<rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5 12v8.5h14V12M12 8v12.5M12 8c-1.5-3.5-5.5-4-5.5-1.5S10 8 12 8zm0 0c1.5-3.5 5.5-4 5.5-1.5S14 8 12 8z"/>',
  file:'<path d="M14 3H6.5v18h11V6.5z"/><path d="M14 3v3.5h3.5M9 12h6M9 16h6"/>',
  logout:'<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  bell:'<path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  chart:'<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
  trash:'<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>',
  up:'<path d="m6 15 6-6 6 6"/>', down:'<path d="m6 9 6 6 6-6"/>',
  lock:'<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  info:'<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.1"/>',
  pause:'<path d="M9 5v14M15 5v14"/>',
  arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
  eye:'<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  megaphone:'<path d="M4 10v4h3l7 4V6L7 10zM17.5 9.5a3.5 3.5 0 0 1 0 5"/>',
  copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>'
};
const icon = (n, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || ""}</svg>`;

/* ========== 한신대학교 로고 (data URI) ========== */
const LOGO_EMBLEM = "img/emblem.png";
const LOGO_WHITE = "img/emblem-white.png";
const LOGO_HORIZ = "img/logo-horizontal.png";
const brand = () => `<span class="names"><span>한신 리서치풀</span><span class="sub-name">한신대학교 일반대학원</span></span>`;

/* ========== 데이터 ========== */
// 화면이 그리는 데이터(S). Firestore 보안 규칙이 허용한 것만 읽혀 들어온다.
// 이 파일은 받은 것을 그리기만 하고, 권한 판단은 하지 않는다.
let S = {session:null, demo:false, users:[], studies:[], enrollments:[], inquiries:[], messages:[], sendLogs:[], audit:[], stats:{}};
const ui = {view:"landing", p:{}, tab:"overview", authMode:"login", signRole:"participant", code:null, form:{}, draft:null, step:0, flow:null, filter:"all", sel:new Set(), modal:null, adminTab:"review", openMsg:null, pFilter:"all", pOnlyFit:false};

function defaultExplanation(o){
  return {
    purpose: o.purpose || "",
    procedure: o.procedure || "",
    risks: o.risks || "일부 문항은 개인적인 경험을 떠올리게 하여 일시적으로 불편할 수 있습니다. 불편하면 언제든 응답을 멈출 수 있으며, 원하시면 한신대학교 학생상담센터 이용 방법을 안내해 드립니다.",
    benefits: o.benefits || "직접적인 이익은 없지만, 연구 결과는 대학생을 위한 지원 프로그램을 만드는 데 쓰입니다. 참여에 대한 감사의 뜻으로 보상을 드립니다.",
    privacy: o.privacy || "응답은 가명 ID로만 관리되며 연구 목적 외에는 사용하지 않습니다. 연구자는 참여자의 이름과 연락처를 볼 수 없습니다. 자료는 관련 법령에 따라 연구 종료 후 3년간 암호화하여 보관한 뒤 폐기합니다.",
    withdraw: o.withdraw || "참여는 자발적입니다. 언제든 불이익 없이 철회할 수 있으며, 철회할 때 이미 수집된 자료를 폐기할지 직접 선택할 수 있습니다.",
    contact: o.contact || ""
  };
}
function defaultConsent(){
  return [
    "연구설명문을 읽고 연구의 목적, 절차, 예상되는 위험과 이익을 이해했습니다.",
    "궁금한 점을 연구자에게 질문할 수 있다는 것을 안내받았습니다.",
    "참여는 자발적이며 언제든 불이익 없이 철회할 수 있음을 이해합니다.",
    "수집된 자료가 가명 처리되어 연구 목적으로만 쓰이는 것에 동의합니다.",
    "본인은 만 19세 이상입니다."
  ];
}
function defaultTemplates(){
  return {
    inviteSubject: "[한신 리서치풀] {{연구명}} 참여 안내",
    inviteBody: "안녕하세요, {{참여자ID}} 님.\n대기풀에 등록하신 조건에 맞는 연구가 있어 안내드립니다.\n\n· 연구명: {{연구명}}\n· 소요 시간: {{소요시간}}\n· 보상: {{보상}}\n· 모집 마감: {{마감일}}\n\n참여 여부는 자유롭게 정하시면 되고, 참여하지 않아도 불이익은 없습니다. 한신 리서치풀에 로그인하면 연구설명문을 확인할 수 있습니다.",
    sms: "[한신리서치풀] 새 연구 안내: {{소요시간}}, {{보상}}. {{마감일}} 마감. 앱에서 확인하세요.",
    remind3: true, remindEnd: true
  };
}
async function refresh(){ try { S = await HS.loadState(); } catch(e){ toast(HS.errorText(e)); } }
// 동작 하나를 실행하고 최신 데이터를 다시 읽는다. 실패하면 {error}를 돌려준다.
async function run(name, payload){ try { const j = await HS.act(name, payload || {}); await refresh(); return j; } catch(e){ return {error:HS.errorText(e)}; } }
// 화면을 바꾸는 동작용: 실패하면 이유를 알리고 null을 돌려준다. 같은 요청이 겹쳐 나가지 않게 한다.
let busy = false;
async function call(name, payload){
  if (busy) return null; busy = true;
  const j = await run(name, payload); busy = false;
  if (j.error){ call.lastError = j.error; render(); toast(j.error); return null; }
  return j;
}
function done(j){ if (!j) return false; render(); if (j.toast) toast(j.toast); return true; }
function readFile(file){
  return new Promise(res => {
    if (!file) return res(null);
    if (file.size > 5 * 1024 * 1024){ toast("파일은 5MB 이하만 올릴 수 있어요."); return res(null); }
    const fr = new FileReader(); fr.onload = () => res({name:file.name, data:String(fr.result).split(",")[1] || ""}); fr.onerror = () => res(null); fr.readAsDataURL(file);
  });
}

/* ========== 도메인 함수 ========== */
const me = () => S.users.find(u => u.id === S.session);
const userById = id => S.users.find(u => u.id === id);
const studyById = id => S.studies.find(s => s.id === id);
const enrOf = sid => S.enrollments.filter(e => e.studyId === sid);
const ageOf = u => new Date().getFullYear() - u.profile.birthYear;
const ageBand = a => a < 23 ? "20대 초반" : a < 27 ? "20대 중반" : a < 30 ? "20대 후반" : a < 40 ? "30대" : "40대 이상";
const poolActive = u => !!(u.pool && u.pool.joined && !u.pool.paused);
function matches(st, u){
  const c = st.criteria, p = u.profile; if (!p) return false; const a = ageOf(u);
  if (a < c.ageMin || a > c.ageMax) return false;
  if (c.statuses.length && !c.statuses.includes(p.status)) return false;
  if (c.genders.length && !c.genders.includes(p.gender)) return false;
  if (c.depts.length && !c.depts.includes(p.dept)) return false;
  return true;
}
function mismatch(st, u){
  const c = st.criteria, p = u.profile, a = ageOf(u);
  if (a < c.ageMin || a > c.ageMax) return `만 ${c.ageMin}~${c.ageMax}세 대상`;
  if (c.statuses.length && !c.statuses.includes(p.status)) return `${c.statuses.join("·")} 대상`;
  if (c.genders.length && !c.genders.includes(p.gender)) return `${c.genders.join("·")} 대상`;
  if (c.depts.length && !c.depts.includes(p.dept)) return "학과 조건 불일치";
  return "";
}
// 대기풀 인원과 초대 가능 인원은 서버가 계산해서 내려 준다(연구자 화면에는 개인별 정보가 오지 않는다).
const SAMPLE = {pid:"P-1000"};
const doneOf = st => st._done != null ? st._done : counts(enrOf(st.id)).done;
const eligN = st => st._elig ? st._elig.n : 0;
let _pc = {key:"", text:"…", timer:null};
function liveCount(){
  const el = $("#matchCount"); if (!el || !ui.draft) return;
  const key = JSON.stringify(ui.draft.criteria);
  el.textContent = _pc.text; if (key === _pc.key) return;
  clearTimeout(_pc.timer);
  _pc.timer = setTimeout(async () => { let text = "-"; try { text = await HS.poolCount(JSON.parse(key)); } catch(e){} _pc.key = key; _pc.text = text; const x = $("#matchCount"); if (x) x.textContent = _pc.text; }, 350);
}
function counts(en){
  const by = s => en.filter(e => e.status === s).length;
  return {all:en.filter(e => e.status !== "withdrawn").length, invited:by("invited"), consented:by("consented"), scheduled:by("scheduled"), completed:by("completed"), paid:by("paid"), withdrawn:by("withdrawn"),
    active:en.filter(e => ACTIVE.includes(e.status)).length, done:en.filter(e => DONE.includes(e.status)).length};
}
const rewardText = st => st.reward.type === "없음" || !st.reward.amount ? "보상 없음" : `${st.reward.type} ${won(st.reward.amount)}`;
function fillTpl(tpl, st, u){
  const map = {"참여자ID": u ? (u.pid || "P-0000") : "P-0000", "연구명": st.title || "(연구명)", "마감일": st.end ? fmtMD(endTs(st.end)) : "", "소요시간": `약 ${st.minutes}분`, "보상": rewardText(st)};
  return String(tpl || "").replace(/\{\{(.+?)\}\}/g, (m, k) => map[k.trim()] ?? m);
}
function enrLabel(e){ if (e.status === "invited" && e.source === "self") return ["신청함","tag-sky"]; return EN_STATUS[e.status]; }
const tag = ([t, c]) => `<span class="tag ${c}">${esc(t)}</span>`;
const stTag = st => tag(ST_STATUS[st.status]);
const typeTag = st => `<span class="tag ${TYPE_TAG[st.type]}">${TYPES[st.type]}</span>`;
const tintBg = st => (TINTS[st.tint] || TINTS.sky)[0];
const tintDot = st => `<span class="dot" style="background:${(TINTS[st.tint] || TINTS.sky)[1]}"></span>`;
const pct = (a, b) => b ? Math.min(100, Math.round(a / b * 100)) : 0;
const slotById = (st, id) => st.slots.find(s => s.id === id);

/* ========== 공통 조각 ========== */
function fld(label, id, control, hint = "", req = false){
  return `<div class="field"><label class="label" for="${id}">${label}${req ? ' <span class="req" aria-hidden="true">*</span>' : ""}</label>${control}${hint ? `<p class="hint">${hint}</p>` : ""}</div>`;
}
const fv = (k, d = "") => esc(ui.form[k] ?? d);
function toast(msg){ const t = $("#toast"); t.textContent = msg; t.classList.remove("hide"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add("hide"), 3600); }
function promo(){
  return S.demo ? `<div class="promo">시연 모드입니다. 가상의 계정과 데이터로 둘러볼 수 있고, 이메일·문자는 실제로 발송되지 않습니다.</div>` : "";
}
function modalHtml(){
  const m = ui.modal; if (!m) return "";
  return `<div class="modal-bg" data-act="modalBg"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mt">
    <h2 class="h4" id="mt">${esc(m.title)}</h2>${m.body}
    <div class="acts">${(m.actions || []).map(a => `<button class="btn ${a.cls || "btn-secondary"}" data-act="${a.act}" ${a.data || ""}>${esc(a.label)}</button>`).join("")}</div>
  </div></div>`;
}
function openModal(m){ ui.modal = m; render(); }
function closeModal(){ ui.modal = null; render(); }

/* ========== 랜딩 ========== */
function topnav(){
  return `<header class="topnav"><div class="in">
    <button class="logo" data-act="go" data-v="landing" aria-label="한신 리서치풀 홈"><img class="logo-emb" src="${LOGO_EMBLEM}" alt="한신대학교 엠블럼">${brand()}</button>
    <nav class="navlinks" aria-label="주요 메뉴">
      <button data-act="scrollTo" data-v="features">연구자 도구</button>
      <button data-act="scrollTo" data-v="pool">참여자 대기풀</button>
      <button data-act="scrollTo" data-v="safety">안전 원칙</button>
      <button data-act="scrollTo" data-v="faq">자주 묻는 질문</button>
    </nav>
    <div class="right">
      <button class="btn btn-ghost" data-act="toAuth" data-v="login">로그인</button>
      <button class="btn btn-primary" data-act="toAuth" data-v="signup">무료로 가입하기</button>
    </div></div></header>`;
}
function vLanding(){
  const z = S.stats || {}, active = z.poolActive || 0, recruiting = z.recruiting || 0, done = z.done || 0, paid = z.paid || 0, partsN = z.participants || 0;
  const notes = [["#ff64c8",44,40,"8%","14%",-8],["#f5d75e",40,36,"12%","58%",6],["#1aae39",30,28,"86%","18%",10],["#2a9d99",36,32,"90%","56%",-6],["#7b3ff2",28,26,"20%","36%",12],["#dd5b00",26,24,"78%","38%",-12],["#0075de",22,22,"4%","40%",4]];
  const balls = [["#d6b6f6",14,"30%","10%"],["#ffffff",8,"68%","12%"],["#f5d75e",10,"72%","64%"],["#ff64c8",9,"26%","66%"]];
  return `${topnav()}
  <section class="hero">
    <svg class="wires" viewBox="0 0 1440 700" preserveAspectRatio="none" aria-hidden="true" fill="none" stroke="rgba(214,182,246,.22)" stroke-width="1.2">
      <path d="M-20 520C200 380 300 640 520 470S860 320 980 420 1260 600 1460 380"/>
      <path d="M-20 200C160 260 260 80 420 160S700 300 820 180 1120 60 1460 160"/>
      <path d="M100 700C220 560 160 420 300 330M1340 700c-120-140-60-280-200-370"/>
      <circle cx="420" cy="160" r="3" fill="rgba(214,182,246,.5)"/><circle cx="980" cy="420" r="3" fill="rgba(214,182,246,.5)"/><circle cx="820" cy="180" r="3" fill="rgba(214,182,246,.5)"/>
    </svg>
    ${notes.map(([c,w,h,l,t,rot]) => `<span class="note" style="background:${c};width:${w}px;height:${h}px;left:${l};top:${t};transform:rotate(${rot}deg)" aria-hidden="true"></span>`).join("")}
    ${balls.map(([c,s,l,t]) => `<span class="ball" style="background:${c};width:${s}px;height:${s}px;left:${l};top:${t}" aria-hidden="true"></span>`).join("")}
    <div class="hero-in">
      <img class="hero-emb" src="${LOGO_WHITE}" alt="한신대학교 엠블럼">
      <span class="hero-chip"><i></i>한신대학교 일반대학원 연구자를 위한 참여자 모집 플랫폼</span>
      <h1>연구참여자 모집을<br>안전하고 꾸준하게</h1>
      <p class="sub">IRB 승인을 확인한 연구만 공개하고, 참여자 연락처는 플랫폼이 대신 보관합니다. 대기풀에 한 번 등록한 참여자에게는 조건에 맞는 연구가 열릴 때마다 안내가 갑니다.</p>
      <div class="ctas">
        <button class="btn btn-primary" data-act="toAuth" data-v="signup" data-role="participant">연구참여자로 등록하기</button>
        <button class="btn btn-sec-dark" data-act="toAuth" data-v="signup" data-role="researcher">연구자로 시작하기</button>
      </div>
      <p class="fine">한신대 구성원은 학교 이메일, 학외 참여자는 개인 이메일로 가입 · 만 19세 이상</p>
      ${heroMock()}
    </div>
  </section>

  <section class="sec" id="features"><div class="wrap">
    <div class="sec-head"><h2 class="h2">연구 한 건에 필요한 일을 한곳에서</h2><p class="sub">설명문과 동의서 작성부터 안내 발송, 보상 지급 대장까지. 흩어져 있던 모집 업무를 한 화면에서 처리합니다.</p></div>
    <div class="feat3">
      <article class="feat" style="background:var(--t-peach)"><span class="tag tag-orange" style="align-self:flex-start">연구 등록</span><h3 class="h4">설명문·동의서·설문지를 단계별로</h3><p class="body-sm">7단계 작성 화면을 따라가면 IRB 승인번호, 연구설명문 필수 항목, 전자동의서, 자기보고식 설문지가 빠짐없이 채워집니다.</p>
        <div class="mini"><div class="ln"><span>1 기본 정보</span>${icon("check",14)}</div><div class="ln"><span>2 연구설명문</span>${icon("check",14)}</div><div class="ln"><span>3 동의서</span>${icon("check",14)}</div><div class="ln steel"><span>4 설문지 · 7문항</span><span>작성 중</span></div></div></article>
      <article class="feat" style="background:var(--t-sky)"><span class="tag tag-sky" style="align-self:flex-start">안내 발송</span><h3 class="h4">초대·리마인더·공지를 이메일과 문자로</h3><p class="body-sm">참여 단계별로 대상을 골라 보냅니다. 문자는 90byte 기준으로 SMS와 LMS를 나눠 보여 주고, 미응답자 리마인더는 자동으로 나갑니다.</p>
        <div class="mini"><div class="ln"><b>초대 후 미응답</b><span class="num">21명</span></div><div class="ln steel"><span>문자 · 74 byte · SMS</span><span>자동 리마인더</span></div></div></article>
      <article class="feat" style="background:var(--t-mint)"><span class="tag tag-green" style="align-self:flex-start">보상 지급</span><h3 class="h4">완료 건을 골라 지급하고 대장을 바로</h3><p class="body-sm">참여 완료된 건만 지급 대상으로 모입니다. 지급 처리하면 참여자에게 알림이 가고, 연구비 정산용 지급 대장을 표로 복사할 수 있습니다.</p>
        <div class="mini"><div class="ln"><span>지급 대기</span><b class="num">22건 · 110,000원</b></div><div class="ln steel"><span>지급 완료</span><span class="num">44건</span></div></div></article>
    </div>
  </div></section>

  <section class="sec" id="pool" style="padding-top:0"><div class="wrap">
    <div class="pool-band">
      <div class="pool-yellow"><span class="micro-up">참여자 대기풀</span><h2 class="h2">대기풀에 등록하면<br>연구가 먼저 찾아옵니다</h2>
        <p class="sub">출생연도, 신분, 참여 가능한 시간만 등록해 두세요. 연구자가 대상 조건을 정하면 플랫폼이 조건에 맞는 참여자에게만 안내합니다. 연구자는 이름과 연락처를 볼 수 없습니다.</p>
        <div class="row" style="gap:24px;margin-top:8px"><div><div class="bignum num">${active}</div><div class="body-sm">지금 안내를 받는 대기풀 인원</div></div>
        <button class="btn btn-dark" data-act="toAuth" data-v="signup" data-role="participant">대기풀 등록하기</button></div></div>
      <article class="feat" style="background:var(--t-rose);min-height:0"><h3 class="h4">안내는 일주일에 최대 3번</h3><p class="body-sm">여러 연구가 동시에 열려도 한 사람에게 가는 안내 횟수를 제한합니다. 같은 연구 초대는 한 번만 갑니다.</p></article>
      <article class="feat" style="background:var(--t-lav);min-height:0"><h3 class="h4">언제든 일시정지·탈퇴</h3><p class="body-sm">시험 기간처럼 바쁠 때는 안내를 잠시 멈추고, 원하면 바로 탈퇴할 수 있습니다. 참여 중인 연구도 불이익 없이 철회할 수 있어요.</p></article>
    </div>
  </div></section>

  <section class="sec" style="padding-top:0"><div class="wrap">
    <div class="sec-head"><h2 class="h2">모집에서 보상까지 여섯 단계</h2></div>
    <div class="steps6">
      ${[["연구 등록","연구자가 설명문, 동의서, 설문지, 참여 조건을 작성합니다."],["연구지원팀 확인","IRB 승인번호와 필수 항목을 확인한 뒤 공개합니다."],["대기풀 매칭","조건에 맞는 참여자에게만 초대가 갑니다."],["전자동의","설명문을 끝까지 읽고 항목별로 동의한 뒤 서명합니다."],["설문·일정","온라인 설문에 답하거나 실험·면담 시간을 예약합니다."],["보상 지급","완료 건을 지급 처리하면 참여자에게 알림이 갑니다."]].map((s,i) => `<div class="step6"><div class="n">${i+1}단계</div><h4>${s[0]}</h4><p class="body-sm slate">${s[1]}</p></div>`).join("")}
    </div>
  </div></section>

  <section class="sec" id="safety" style="padding-top:0"><div class="wrap">
    <div class="sec-head"><h2 class="h2">안전 원칙</h2><p class="sub">참여자 보호를 위해 플랫폼이 기본으로 지키는 규칙입니다. 연구자가 끌 수 없습니다.</p></div>
    <div class="safe-grid">
      ${[["shield","var(--t-lav)","var(--purple-800)","IRB 승인 연구만 공개","승인번호와 유효기간을 연구지원팀이 확인한 연구만 모집 화면에 나타납니다."],
         ["lock","var(--t-sky)","#0b4f8a","가명 ID로만 관리","연구자에게는 P-1043 같은 가명 ID와 연령대·신분만 보입니다. 이름과 연락처는 공개되지 않습니다."],
         ["mail","var(--t-mint)","var(--green-ink)","연락은 플랫폼이 대행","초대, 리마인더, 보상 안내는 모두 플랫폼을 거쳐 발송됩니다. 플랫폼 밖 직접 연락은 서약으로 금지됩니다."],
         ["user","var(--t-peach)","var(--orange-deep)","만 19세 이상, 이메일 인증","교내 구성원은 학교 이메일로 소속을 확인하고, 학외 참여자는 따로 구분해 표시합니다. 연구마다 대상 범위를 정합니다."],
         ["arrow","var(--t-rose)","var(--pink-deep)","언제든 철회, 자료 폐기 선택","철회할 때 이미 낸 응답을 폐기할지 참여자가 직접 고릅니다."],
         ["eye","var(--t-yellow)","#6b5300","모든 처리 기록","심사, 발송, 보상 지급, 자료 열람 기록이 남고 연구지원팀이 확인합니다."]].map(([ic,bg,fg,t,d]) => `<div class="safe"><div class="ic" style="background:${bg};color:${fg}">${icon(ic,18)}</div><h3 class="h5">${t}</h3><p class="body-sm slate">${d}</p></div>`).join("")}
    </div>
  </div></section>

  <section class="sec" style="padding-top:0"><div class="wrap">
    <div class="stat-row">
      <div><div class="v num">${recruiting}</div><div class="body-sm slate">지금 모집 중인 연구</div></div>
      <div><div class="v num">${partsN}</div><div class="body-sm slate">등록된 연구참여자</div></div>
      <div><div class="v num">${done}</div><div class="body-sm slate">누적 참여 완료</div></div>
      <div><div class="v num">${paid}</div><div class="body-sm slate">보상 지급 완료</div></div>
    </div>
  </div></section>

  <section class="sec" id="faq" style="padding-top:0"><div class="wrap faq">
    <h2 class="h2" style="margin-bottom:16px">자주 묻는 질문</h2>
    <details><summary>IRB 승인 전에도 연구를 등록할 수 있나요?</summary><p>작성과 임시 저장은 언제든 할 수 있습니다. 심사 제출에는 IRB 승인번호와 승인 통지서 파일이 필요하고, 연구지원팀이 확인한 뒤에 모집 화면에 공개됩니다.</p></details>
    <details><summary>연구자가 참여자의 이름이나 전화번호를 볼 수 있나요?</summary><p>볼 수 없습니다. 연구자에게는 가명 ID, 연령대, 신분, 참여 단계만 보입니다. 상품권 발송처럼 연락처가 필요한 일은 플랫폼이 등록된 번호로 대신 처리합니다.</p></details>
    <details><summary>대기풀에 등록하면 모든 연구에 참여해야 하나요?</summary><p>아닙니다. 대기풀은 안내를 받겠다는 뜻일 뿐이고, 각 연구마다 설명문을 읽고 직접 동의해야 참여가 시작됩니다. 안내를 받지 않으려면 언제든 일시정지할 수 있습니다.</p></details>
    <details><summary>문자 발송 비용은 어떻게 되나요?</summary><p>운영 단계에서는 학교 문자 발송 계정과 연동합니다. 90byte 이하는 SMS, 초과하면 LMS로 나가므로 작성 화면에서 byte 수를 확인할 수 있게 했습니다.</p></details>
  </div></section>

  <section class="wrap"><div class="cta-light"><h2 class="h2">다음 학기 모집, 지금 준비하세요</h2><p class="sub slate">연구를 등록해 두면 승인과 동시에 대기풀 안내가 나갑니다.</p>
    <div class="row" style="justify-content:center"><button class="btn btn-primary" data-act="toAuth" data-v="signup" data-role="researcher">연구자로 시작하기</button><button class="btn btn-secondary" data-act="toAuth" data-v="login">${S.demo ? "시연 계정으로 둘러보기" : "로그인"}</button></div></div></section>

  <footer class="foot"><div class="wrap foot-grid">
    <div><img class="foot-brand" src="${LOGO_HORIZ}" alt="한신대학교"><p class="body-sm" style="margin-top:14px;font-weight:600">한신 리서치풀</p><p class="body-sm steel" style="margin-top:4px;max-width:32ch">한신대학교 일반대학원 연구자와 연구참여자를 잇는 모집 플랫폼</p></div>
    <div><h5>연구자</h5><ul><li>연구 등록 안내</li><li>IRB 심사 준비</li><li>보상 지급 기준</li></ul></div>
    <div><h5>참여자</h5><ul><li>대기풀 등록</li><li>참여 철회 방법</li><li>개인정보 처리방침</li></ul></div>
    <div><h5>운영</h5><ul><li>연구윤리지원팀</li><li>기관생명윤리위원회</li><li>학생상담센터</li></ul></div>
    <div><h5>문의</h5><ul><li>research-ethics@hs.ac.kr</li><li>평일 09:00–18:00</li></ul></div>
  </div></footer>`;
}
function heroMock(){
  const col = (t, c, n, items) => `<div><div class="col-h"><span class="dot" style="background:${c}"></span>${t} <span class="steel num">${n}</span></div>${items.map(i => `<div class="kcard"><b class="mono">${i[0]}</b><span class="steel">${i[1]}</span></div>`).join("")}</div>`;
  return `<div class="mock" aria-label="연구자 화면 미리보기">
    <div class="mock-side"><div class="it" style="font-weight:700"><img src="${LOGO_EMBLEM}" alt="" style="width:20px;height:20px">김서윤의 연구</div>
      <div class="it">${icon("home",14)}홈</div><div class="it">${icon("plus",14)}새 연구 등록</div>
      <div class="it on"><span class="dot" style="background:#0075de"></span>주의집중과 지연행동</div><div class="it"><span class="dot" style="background:#1aae39"></span>마음챙김 호흡 실험</div><div class="it"><span class="dot" style="background:#7b3ff2"></span>연구 소진 척도</div>
      <div class="it">${icon("users",14)}대기풀 현황</div></div>
    <div class="mock-main"><div class="row"><span class="tag tag-green">모집 중</span><span class="tag tag-sky">온라인 설문</span><span class="caption steel mono">HS-IRB-2026-1043</span></div>
      <h3 class="h4" style="margin-top:10px">대학생의 주의집중 어려움과 학업 지연행동</h3>
      <div class="row caption steel" style="margin-top:6px"><span>목표 120명</span><span>·</span><span>참여 완료 66명</span><span>·</span><span>D-29</span></div>
      <div class="board">
        ${col("초대됨","#0075de",34,[["P-1182","11월 10일 초대"],["P-1307","11월 9일 초대"]])}
        ${col("동의 완료","#7b3ff2",6,[["P-1043","설문 진행 중"],["P-1256","오늘 동의"]])}
        ${col("참여 완료","#1aae39",22,[["P-1091","보상 대기"],["P-1219","보상 대기"]])}
        ${col("보상 지급","#523410",44,[["P-1018","11월 8일 지급"],["P-1144","11월 8일 지급"]])}
      </div></div></div>`;
}

/* ========== 로그인·회원가입 ========== */
function vAuth(){
  const m = ui.authMode;
  return `${topnav()}<div class="auth-wrap"><div class="auth-card card stack">
    <div class="auth-brand"><img src="${LOGO_HORIZ}" alt="한신대학교"></div>
    <div class="pills" role="tablist">${[["login","로그인"],["signup","회원가입"]].map(([k,t]) => `<button role="tab" aria-selected="${m===k}" class="${m===k?"on":""}" data-act="authMode" data-v="${k}">${t}</button>`).join("")}</div>
    ${m === "login" ? loginForm() : signupForm()}
  </div></div>`;
}
function loginForm(){
  return `<div><h1 class="h3">로그인</h1><p class="slate" style="margin-top:4px">가입한 이메일로 로그인하세요.</p></div>
  <form data-form="login" class="stack" novalidate>
    ${fld("이메일","l-email",`<input class="input" id="l-email" data-f="lemail" type="email" autocomplete="username" placeholder="name@hs.ac.kr" value="${fv("lemail")}">`)}
    ${fld("비밀번호","l-pw",`<input class="input" id="l-pw" data-f="lpw" type="password" autocomplete="current-password" value="${fv("lpw")}">`)}
    <button class="btn btn-primary w100" type="submit">로그인</button>
    <button type="button" class="btn-link" style="align-self:center" data-act="forgot">비밀번호를 잊으셨나요?</button>
  </form>
  ${S.demo ? `<div class="divider">시연용 계정으로 바로 둘러보기</div>
  <div class="demo-grid">
    <button class="demo-btn" data-act="demoLogin" data-id="participant"><span class="tag tag-purple" style="align-self:flex-start">참여자</span><b>이하은</b><span class="caption steel">심리아동학부 3학년 · 대기풀 등록</span></button>
    <button class="demo-btn" data-act="demoLogin" data-id="researcher"><span class="tag tag-sky" style="align-self:flex-start">연구자</span><b>김서윤</b><span class="caption steel">임상및상담심리 박사과정</span></button>
    <button class="demo-btn" data-act="demoLogin" data-id="admin"><span class="tag tag-orange" style="align-self:flex-start">관리자</span><b>연구윤리지원팀</b><span class="caption steel">심사·연구자 확인</span></button>
  </div>` : ""}`;
}
function chipGroup(key, opts, name){
  const cur = ui.form[key] || [];
  return `<div class="chips" role="group" aria-label="${name}">${opts.map((o,i) => `<label class="chip"><input type="checkbox" id="${key}-${i}" data-farr="${key}" value="${esc(o)}" ${cur.includes(o) ? "checked" : ""}>${esc(o)}</label>`).join("")}</div>`;
}
function signupForm(){
  const role = ui.signRole, isP = role === "participant";
  const ext = isP && ui.form.status === EXTERNAL;
  const emailHint = !isP ? "연구자는 학교 이메일(@hs.ac.kr)로만 가입할 수 있습니다." : ext ? "학외 참여자는 평소 쓰는 이메일로 가입할 수 있습니다." : "학부생·대학원생·교직원은 학교 이메일(@hs.ac.kr)로, 학외 참여자는 개인 이메일로 가입합니다.";
  const years = []; for (let y = new Date().getFullYear() - 19; y >= 1955; y--) years.push(y);
  const common = `
    <div class="two">${fld("이름","f-name",`<input class="input" id="f-name" data-f="name" autocomplete="name" value="${fv("name")}">`,"",true)}
    ${fld("휴대전화","f-phone",`<input class="input" id="f-phone" data-f="phone" inputmode="tel" placeholder="010-0000-0000" value="${fv("phone")}">`, isP ? "문자 안내와 상품권 발송에만 쓰이며 연구자에게 보이지 않습니다." : "", true)}</div>
    ${fld(isP ? "이메일" : "학교 이메일","f-email",`<div class="row" style="flex-wrap:nowrap"><input class="input" id="f-email" data-f="email" type="email" placeholder="${ext ? "name@example.com" : "name@hs.ac.kr"}" value="${fv("email")}"></div>`, emailHint, true)}
    ${fld("비밀번호","f-pw",`<input class="input" id="f-pw" data-f="pw" type="password" autocomplete="new-password" value="${fv("pw")}">`,"10자 이상",true)}`;
  const pFields = `
    <div class="three">
      ${fld("출생연도","f-by",`<select class="input" id="f-by" data-f="by"><option value="">선택</option>${years.map(y => `<option ${String(ui.form.by)===String(y)?"selected":""}>${y}</option>`).join("")}</select>`,"",true)}
      ${fld("성별","f-gender",`<select class="input" id="f-gender" data-f="gender"><option value="">선택</option>${GENDERS.map(g => `<option ${ui.form.gender===g?"selected":""}>${g}</option>`).join("")}</select>`,"",true)}
      ${fld("신분","f-status",`<select class="input" id="f-status" data-f="status" data-rr><option value="">선택</option>${STATUSES.map(g => `<option ${ui.form.status===g?"selected":""}>${g}</option>`).join("")}</select>`,"",true)}
    </div>
    ${ext ? `<p class="hint" style="margin-top:-8px">학외 참여자는 학과·학년을 입력하지 않습니다. 연구자에게는 '학외 일반인'으로만 표시됩니다.</p>` : `<div class="two">
      ${fld("학과","f-dept",`<select class="input" id="f-dept" data-f="dept"><option value="">선택</option>${[...DEPTS,"교직원"].map(g => `<option ${ui.form.dept===g?"selected":""}>${g}</option>`).join("")}</select>`,"",true)}
      ${fld("학년","f-year",`<select class="input" id="f-year" data-f="year">${["해당 없음","1학년","2학년","3학년","4학년"].map(g => `<option ${ui.form.year===g?"selected":""}>${g}</option>`).join("")}</select>`)}
    </div>`}
    <div class="field"><span class="label">관심 있는 연구 분야</span>${chipGroup("interests", INTERESTS, "관심 분야")}</div>
    <div class="field"><span class="label">참여 가능한 시간</span>${chipGroup("times", TIMES, "참여 가능 시간")}<p class="hint">대면 실험·면담 안내에 참고합니다.</p></div>
    <div class="field"><span class="label">안내 받을 방법</span><div class="row" style="gap:20px">
      <label class="check"><input type="checkbox" checked disabled>이메일 (필수)</label>
      <label class="check"><input type="checkbox" id="f-sms" data-f="sms" ${ui.form.sms !== false ? "checked" : ""}>문자</label></div></div>
    <div class="agree">
      <label class="check"><input type="checkbox" id="f-a1" data-f="a1" ${ui.form.a1?"checked":""}><span><b>[필수]</b> 개인정보 수집·이용에 동의합니다.</span></label>
      <table><tr><td>수집 항목</td><td>이름, 이메일, 휴대전화, 출생연도, 성별, 신분, 학과·학년(교내 구성원)</td></tr><tr><td>이용 목적</td><td>연구 참여 자격 확인, 조건에 맞는 연구 안내, 보상 발송</td></tr><tr><td>보유 기간</td><td>회원 탈퇴 시까지 (참여 기록은 법령에 따라 3년 보관)</td></tr></table>
      <label class="check"><input type="checkbox" id="f-a2" data-f="a2" ${ui.form.a2?"checked":""}><span><b>[필수]</b> 본인은 만 19세 이상입니다.</span></label>
      <label class="check"><input type="checkbox" id="f-a3" data-f="a3" ${ui.form.a3 !== false ? "checked" : ""}><span><b>[선택]</b> 참여자 대기풀에 등록하고, 조건에 맞는 연구가 열리면 안내를 받겠습니다. 언제든 끌 수 있습니다.</span></label>
    </div>`;
  const rFields = `
    <div class="two">
      ${fld("과정","f-prog",`<select class="input" id="f-prog" data-f="prog">${["석사과정","박사과정","석박사통합과정","박사후연구원"].map(g => `<option ${ui.form.prog===g?"selected":""}>${g}</option>`).join("")}</select>`,"",true)}
      ${fld("소속 학과·전공","f-rdept",`<input class="input" id="f-rdept" data-f="rdept" placeholder="예: 일반대학원 심리학과" value="${fv("rdept")}">`,"",true)}
    </div>
    <div class="two">
      ${fld("지도교수","f-adv",`<input class="input" id="f-adv" data-f="adv" placeholder="예: 박지훈 교수" value="${fv("adv")}">`,"",true)}
      ${fld("연구윤리교육 이수일","f-eth",`<input class="input" id="f-eth" data-f="eth" type="date" value="${fv("eth")}">`,"",true)}
    </div>
    ${fld("연구윤리교육 이수증","f-ethfile",`<input class="input" id="f-ethfile" data-ffile="ethFile" type="file" accept=".pdf,.jpg,.jpeg,.png" style="padding:9px 12px">`, ui.form.ethFile ? `첨부됨: ${esc(ui.form.ethFile)}` : "연구지원팀이 확인한 뒤 심사 제출이 열립니다.", true)}
    <div class="agree">
      <label class="check"><input type="checkbox" id="f-a1" data-f="a1" ${ui.form.a1?"checked":""}><span><b>[필수]</b> 개인정보 수집·이용에 동의합니다. (이름, 학교 이메일, 휴대전화, 소속, 지도교수, 이수증)</span></label>
      <label class="check"><input type="checkbox" id="f-a2" data-f="a2" ${ui.form.a2?"checked":""}><span><b>[필수]</b> 참여자 정보를 연구 목적 외로 쓰지 않으며, 플랫폼 밖에서 참여자에게 직접 연락하지 않겠습니다.</span></label>
    </div>`;
  return `<div><h1 class="h3">회원가입</h1><p class="slate" style="margin-top:4px">어떤 역할로 가입하시나요?</p></div>
  <div class="role-pick">
    <button type="button" class="role-opt ${isP?"on":""}" data-act="signRole" data-v="participant" aria-pressed="${isP}"><b>연구참여자</b><span class="body-sm slate">연구에 참여하고 대기풀에서 안내를 받습니다.</span></button>
    <button type="button" class="role-opt ${!isP?"on":""}" data-act="signRole" data-v="researcher" aria-pressed="${!isP}"><b>연구자</b><span class="body-sm slate">일반대학원 석·박사과정생이 연구를 등록합니다.</span></button>
  </div>
  <form data-form="signup" class="stack" novalidate>${common}${isP ? pFields : rFields}
    <p id="formErr" class="body-sm" style="color:var(--err)" role="alert"></p>
    <button class="btn btn-primary w100" type="submit">${isP ? "가입하고 대기풀 시작하기" : "연구자로 가입하기"}</button>
  </form>`;
}

/* ========== 앱 셸 ========== */
function shell(u){
  const nav = (v, ic, label, extra = "", data = "") => `<button class="nav-item ${ui.view===v && !data ? "on" : ""}" data-act="go" data-v="${v}" ${data}>${icon(ic,17)}<span class="txt">${label}</span>${extra}</button>`;
  let items = "";
  if (u.role === "researcher"){
    const mine = S.studies.filter(s => s.ownerId === u.id);
    items = nav("r-home","home","홈") + `<button class="nav-item ${ui.view==="r-wizard"?"on":""}" data-act="newStudy">${icon("plus",17)}<span class="txt">새 연구 등록</span></button>`
      + `<div class="grp">내 연구</div>` + mine.map(s => `<button class="nav-item ${ui.view==="r-study"&&ui.p.id===s.id?"on":""}" data-act="openStudy" data-id="${s.id}">${tintDot(s)}<span class="txt">${esc(s.title || "제목 없는 연구")}</span></button>`).join("")
      + `<div class="grp">도구</div>` + nav("r-pool","users","대기풀 현황") + nav("r-logs","mail","발송 기록");
  } else if (u.role === "participant"){
    const unread = S.messages.filter(m => m.toUserId === u.id && !m.read).length;
    items = nav("p-home","home","홈") + nav("p-studies","search","모집 중인 연구") + nav("p-history","list","내 참여 기록") + nav("p-inbox","inbox","알림함", unread ? `<span class="cnt num">${unread}</span>` : "") + nav("p-profile","user","내 정보·대기풀");
  } else {
    const rev = S.studies.filter(s => s.status === "review").length, pend = S.users.filter(x => x.role === "researcher" && !x.verified).length;
    const an = (t, ic, label, n) => `<button class="nav-item ${(ui.view==="a-home"&&ui.adminTab===t)||(ui.view==="a-review"&&t==="review")?"on":""}" data-act="aTab" data-v="${t}">${icon(ic,17)}<span class="txt">${label}</span>${n?`<span class="cnt num">${n}</span>`:""}</button>`;
    items = an("review","shield","심사 대기",rev) + an("researchers","user","연구자 확인",pend) + an("rewards","gift","보상 발송",(S.rewardQueue || []).filter(r => !r.sentAt).length) + an("studies","list","전체 연구") + an("audit","eye","처리 기록");
  }
  const roleName = {admin:"관리자", researcher:"연구자", participant:"참여자"}[u.role];
  const av = {admin:["var(--t-peach)","var(--orange-deep)"], researcher:["var(--t-sky)","#0b4f8a"], participant:["var(--t-lav)","var(--purple-800)"]}[u.role];
  return `<div class="shell"><aside class="side" aria-label="메뉴">
    <div class="ws"><img class="logo-emb" src="${LOGO_EMBLEM}" alt="한신대학교 엠블럼" style="width:30px;height:30px"><span class="names"><b>한신 리서치풀</b><span class="caption steel">한신대학교 일반대학원</span></span></div>${items}
    <div class="me"><span class="avatar" style="background:${av[0]};color:${av[1]}">${esc(u.name[0])}</span><div class="who" style="min-width:0;flex:1"><div class="body-sm" style="font-weight:600">${esc(u.name)}</div><div class="caption steel">${roleName}${u.pid ? " · " + u.pid : ""}</div></div>
    <button class="icon-btn" data-act="logout" title="로그아웃" aria-label="로그아웃">${icon("logout",17)}</button></div>
  </aside><main class="main">${promo()}${content(u)}</main></div>`;
}
function content(u){
  const v = ui.view;
  const map = {"r-home":rHome, "r-study":rStudy, "r-wizard":rWizard, "r-pool":rPool, "r-logs":rLogs, "p-home":pHome, "p-studies":pStudies, "p-study":pStudy, "p-flow":pFlow, "p-history":pHistory, "p-inbox":pInbox, "p-profile":pProfile, "a-home":aHome, "a-review":aReview};
  return (map[v] || (() => ""))(u);
}
function homeOf(u){ return {researcher:"r-home", participant:"p-home", admin:"a-home"}[u.role]; }

/* ========== 연구자 ========== */
function studyRow(s){
  const c = counts(enrOf(s.id));
  const prog = s.status === "draft" || s.status === "review" || s.status === "rejected";
  return `<button class="srow" data-act="openStudy" data-id="${s.id}">
    <div style="min-width:0"><h3>${tintDot(s)}<span>${esc(s.title || "제목 없는 연구")}</span></h3>
      <div class="meta"><span>${stTag(s)}</span><span>${typeTag(s)}</span><span>${s.start ? fmtD(endTs(s.start)) + " – " + fmtD(endTs(s.end)) : ""}</span>${s.irbNo ? `<span class="mono">${esc(s.irbNo)}</span>` : `<span>IRB 승인번호 미입력</span>`}</div></div>
    <div>${prog ? `<p class="body-sm steel">${s.status === "review" ? "연구지원팀 확인 중" : s.status === "rejected" ? "보완 요청을 확인하세요" : "작성 중 · 심사 제출 전"}</p>` :
      `<div class="between caption"><span class="steel">참여 완료</span><b class="num">${c.done} / ${s.target}명</b></div><div class="bar" style="margin-top:6px"><i style="width:${pct(c.done, s.target)}%"></i></div><div class="caption steel" style="margin-top:6px">${s.status === "recruiting" ? dday(s.end) : "모집 마감"}</div>`}</div>
  </button>`;
}
function rHome(u){
  const mine = S.studies.filter(s => s.ownerId === u.id);
  const ids = new Set(mine.map(s => s.id));
  const en = S.enrollments.filter(e => ids.has(e.studyId));
  const weekDone = en.filter(e => e.completedAt && Date.now() - e.completedAt < 7*DAY).length;
  const unpaid = en.filter(e => e.status === "completed" && studyById(e.studyId).reward.amount > 0);
  const unpaidSum = unpaid.reduce((a, e) => a + studyById(e.studyId).reward.amount, 0);
  const poolN = (S.pool || {}).active || 0;
  const todos = [];
  mine.forEach(s => {
    const c = counts(enrOf(s.id));
    if (s.status === "rejected") todos.push(["rose", `<b>${esc(s.title)}</b> 보완 요청이 있어요.`, s.id]);
    if (c.completed && s.reward.amount) todos.push(["orange", `<b>${esc(s.title)}</b> 보상 지급 대기 ${c.completed}건`, s.id, "reward"]);
    if (c.scheduled) todos.push(["yellow", `<b>${esc(s.title)}</b> 일정 확정 ${c.scheduled}명, 방문 후 완료 처리가 필요해요.`, s.id, "participants"]);
    const nq = S.inquiries.filter(q => q.studyId === s.id && !q.reply && !q.reported).length;
    if (nq) todos.push(["rose", `<b>${esc(s.title)}</b> 답변을 기다리는 문의 ${nq}건`, s.id, "inquiries"]);
    if (s.status === "draft") todos.push(["gray", `<b>${esc(s.title || "제목 없는 연구")}</b> 작성을 마치고 심사에 제출하세요.`, s.id]);
    if (s.status === "recruiting" && eligN(s) && c.done < s.target) todos.push(["sky", `<b>${esc(s.title)}</b> 아직 초대하지 않은 대기풀 ${eligN(s)}명`, s.id, "invite"]);
  });
  const recentLog = S.audit.filter(a => a.actor === u.name).slice(0, 5);
  return `<div class="page">
    ${u.verified ? "" : `<div class="callout warn" style="margin-bottom:20px">${icon("info",18)}<span>연구지원팀이 대학원 재학 정보와 연구윤리교육 이수증을 확인하고 있어요. 확인 전에도 연구를 작성할 수 있고, 심사 제출은 확인 후에 열립니다.</span></div>`}
    <div class="page-head"><div><p class="eyebrow">${esc(u.program)} · ${esc(u.dept)}</p><h1 class="h2">${esc(u.name)} 님의 연구</h1></div>
      <button class="btn btn-primary" data-act="newStudy">${icon("plus",16)}새 연구 등록</button></div>
    <div class="tiles">
      <div class="tile"><div class="l">모집 중인 연구</div><div class="v">${mine.filter(s => s.status === "recruiting").length}</div></div>
      <div class="tile"><div class="l">최근 7일 참여 완료</div><div class="v">${weekDone}명</div></div>
      <div class="tile"><div class="l">보상 지급 대기</div><div class="v">${unpaid.length}건</div><div class="caption steel num">${won(unpaidSum)}</div></div>
      <div class="tile"><div class="l">안내 받는 대기풀</div><div class="v">${poolN}명</div></div>
    </div>
    <div class="grid-main">
      <section><div class="between" style="margin-bottom:12px"><h2 class="h5">내 연구</h2><span class="caption steel">${mine.length}건</span></div>
        <div class="list">${mine.length ? mine.map(studyRow).join("") : `<div class="empty">아직 등록한 연구가 없어요. 새 연구 등록으로 시작하세요.</div>`}</div></section>
      <aside class="stack">
        <div class="card"><h2 class="h5" style="margin-bottom:6px">할 일</h2>${todos.length ? todos.map(([c, t, id, tab]) => `<div class="todo"><span class="dot" style="margin-top:6px;background:${{rose:"#ff64c8",orange:"#dd5b00",yellow:"#d9b300",gray:"#a4a097",sky:"#0075de"}[c]}"></span><span style="flex:1">${t}<br><button class="btn-link" data-act="openStudy" data-id="${id}" ${tab ? `data-tab="${tab}"` : ""}>열기</button></span></div>`).join("") : `<p class="body-sm steel">처리할 일이 없어요.</p>`}</div>
        <div class="card"><h2 class="h5" style="margin-bottom:6px">최근 활동</h2>${recentLog.length ? recentLog.map(a => `<div class="todo"><span class="caption steel" style="min-width:76px">${fmtDT(a.at)}</span><span class="body-sm">${esc(a.action)}</span></div>`).join("") : `<p class="body-sm steel">기록이 없어요.</p>`}</div>
      </aside>
    </div></div>`;
}

function rStudy(u){
  const st = studyById(ui.p.id); if (!st) return `<div class="page"><div class="empty">연구를 찾을 수 없어요.</div></div>`;
  const en = enrOf(st.id), c = counts(en);
  const live = ["recruiting","closed"].includes(st.status);
  const nq = S.inquiries.filter(q => q.studyId === st.id && !q.reply && !q.reported).length;
  const tabs = live ? [["overview","개요"],["participants","참여자"],["invite","모집 초대"],["send","안내 발송"],["notice","공지"],["reward","보상"],["data","응답 데이터"],["inquiries","문의" + (nq ? ` ${nq}` : "")],["info","연구 정보"]] : [["info","연구 정보"]];
  if (!tabs.some(t => t[0] === ui.tab)) ui.tab = tabs[0][0];
  const body = {overview:tOverview, participants:tParticipants, invite:tInvite, send:tSend, notice:tNotice, reward:tReward, data:tData, inquiries:tInquiries, info:tInfo}[ui.tab](st, en, c, u);
  return `<div class="s-hero" style="background:${tintBg(st)}"><div class="page">
    <div class="crumb"><button data-act="go" data-v="r-home">내 연구</button><span>/</span><span class="charcoal">${esc(st.title || "제목 없는 연구")}</span></div>
    <div class="s-title"><div style="min-width:0;max-width:760px"><div class="row" style="margin-bottom:10px">${stTag(st)}${typeTag(st)}${st.irbNo ? `<span class="tag tag-gray mono">${esc(st.irbNo)}</span>` : ""}</div>
      <h1 class="h3" style="color:var(--ink)">${esc(st.title || "제목 없는 연구")}</h1>
      <div class="meta" style="color:var(--slate);font-size:14px"><span>모집 ${st.start ? fmtD(endTs(st.start)) : "-"} – ${st.end ? fmtD(endTs(st.end)) : "-"}</span><span>목표 ${st.target}명</span><span>1회 ${st.minutes}분</span><span>${esc(rewardText(st))}</span></div></div>
      <div class="row">${["draft","rejected"].includes(st.status) ? `<button class="btn btn-primary" data-act="editStudy" data-id="${st.id}">이어서 작성</button>` : ""}
        ${st.status === "recruiting" ? `<button class="btn btn-secondary" style="background:var(--canvas)" data-act="closeStudy" data-id="${st.id}">모집 마감</button>` : ""}</div></div>
    ${live ? `<div class="s-progress"><div class="bar lg" style="flex:1;background:rgba(255,255,255,.7)"><i style="width:${pct(c.done, st.target)}%"></i></div><b class="num body-sm">${c.done} / ${st.target}명 완료 · ${pct(c.done, st.target)}%</b></div>` : `<div style="height:20px"></div>`}
    <nav class="seg" role="tablist" style="border-bottom:0">${tabs.map(([k, t]) => `<button role="tab" aria-selected="${ui.tab===k}" class="${ui.tab===k?"on":""}" data-act="tab" data-v="${k}">${t}</button>`).join("")}</nav>
  </div></div><div class="page">${body}</div>`;
}
function tOverview(st, en, c){
  const days = 14, now = new Date(); now.setHours(0,0,0,0);
  const buckets = Array.from({length:days}, (_, i) => ({t:now.getTime() - (days-1-i)*DAY, n:0}));
  en.forEach(e => { if (!e.completedAt) return; const d = new Date(e.completedAt); d.setHours(0,0,0,0); const b = buckets.find(b => b.t === d.getTime()); if (b) b.n++; });
  const max = Math.max(4, ...buckets.map(b => b.n)); const W = 560, H = 150, bw = W / days;
  const svg = `<svg viewBox="0 0 ${W} ${H + 26}" role="img" aria-label="최근 14일 일별 참여 완료 수">
    ${[0, .5, 1].map(f => `<line x1="0" x2="${W}" y1="${H - f*H + .5}" y2="${H - f*H + .5}" stroke="var(--hair-soft)"/>`).join("")}
    ${buckets.map((b, i) => { const h = b.n / max * (H - 16); const last = i === days - 1; return `<rect x="${i*bw + 6}" y="${H - h}" width="${bw - 12}" height="${Math.max(h, 1)}" rx="3" fill="${last ? "var(--primary)" : "var(--purple-300)"}"/>${b.n ? `<text x="${i*bw + bw/2}" y="${H - h - 4}" text-anchor="middle" font-size="11" fill="var(--slate)">${b.n}</text>` : ""}`; }).join("")}
    ${buckets.map((b, i) => i % 3 === 1 || i === days - 1 ? `<text x="${i*bw + bw/2}" y="${H + 18}" text-anchor="middle" font-size="11" fill="var(--steel)">${new Date(b.t).getMonth()+1}/${new Date(b.t).getDate()}</text>` : "").join("")}
  </svg>`;
  const f = [["초대·신청", c.all, "#0075de"], ["동의 완료", c.active, "#7b3ff2"], ["참여 완료", c.done, "#1aae39"], ["보상 지급", c.paid, "#523410"]];
  const fmax = Math.max(st.target, c.all);
  return `<div class="grid-main">
    <div class="stack">
      <div class="card"><div class="between" style="margin-bottom:16px"><h2 class="h5">참여 단계</h2><span class="caption steel">철회 ${c.withdrawn}명 제외</span></div>
        <div class="funnel">${f.map(([l, n, col]) => `<div class="f"><span class="slate">${l}</span><div class="bar lg"><i style="width:${pct(n, fmax)}%;background:${col}"></i></div><b class="num" style="text-align:right">${n}명</b></div>`).join("")}</div>
        <p class="caption steel" style="margin-top:14px">동의율 ${pct(c.active, c.all)}% · 동의 후 완료율 ${pct(c.done, c.active)}%</p></div>
      <div class="card chart"><div class="between" style="margin-bottom:12px"><h2 class="h5">최근 14일 참여 완료</h2><span class="caption steel">오늘 ${buckets[days-1].n}명</span></div>${svg}</div>
    </div>
    <aside class="stack">
      <div class="card"><h2 class="h5" style="margin-bottom:12px">모집 상태</h2><dl class="kv" style="grid-template-columns:1fr 1fr">
        <div><dt>남은 기간</dt><dd>${st.status === "recruiting" ? dday(st.end) : "마감"}</dd></div><div><dt>남은 인원</dt><dd class="num">${Math.max(0, st.target - c.done)}명</dd></div>
        <div><dt>초대 가능 대기풀</dt><dd class="num">${st.status === "recruiting" ? eligN(st) + "명" : "-"}</dd></div><div><dt>IRB 만료</dt><dd>${fmtD(endTs(st.irbUntil))}</dd></div></dl>
        ${st.status === "recruiting" ? `<button class="btn btn-secondary w100" style="margin-top:14px" data-act="tab" data-v="invite">대기풀에 초대 보내기</button>` : ""}</div>
      ${st.slots.length ? `<div class="card"><h2 class="h5" style="margin-bottom:8px">예약 일정</h2>${st.slots.slice(0, 6).map(s => `<div class="todo"><span class="body-sm num" style="flex:1">${fmtDT(s.at)}</span><span class="caption ${s.booked >= s.cap ? "" : "steel"}">${s.booked}/${s.cap}명</span></div>`).join("")}</div>` : ""}
    </aside></div>`;
}
function tParticipants(st, en, c){
  const f = ui.filter;
  const rows = en.filter(e => f === "all" || e.status === f).sort((a, b) => (b.completedAt || b.consentAt || b.invitedAt) - (a.completedAt || a.consentAt || a.invitedAt));
  const pills = [["all","전체",en.length],["invited","초대됨",c.invited],["consented","동의 완료",c.consented],...(st.slots.length ? [["scheduled","일정 확정",c.scheduled]] : []),["completed","참여 완료",c.completed],["paid","보상 지급",c.paid],["withdrawn","철회",c.withdrawn]];
  return `<div class="callout info" style="margin-bottom:16px">${icon("lock",18)}<span>연구자에게는 가명 ID와 신분·연령대만 보입니다. 이름과 연락처는 플랫폼이 보관하며, 연락이 필요하면 안내 발송 탭을 이용하세요.</span></div>
  <div class="pills" style="margin-bottom:16px">${pills.map(([k, t, n]) => `<button class="${f===k?"on":""}" data-act="filter" data-v="${k}">${t}<span class="n">${n}</span></button>`).join("")}</div>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>가명 ID</th><th>신분 · 연령대</th><th>경로</th><th>초대·신청</th><th>동의</th>${st.slots.length ? "<th>예약 일정</th>" : ""}<th>완료</th><th>상태</th><th></th></tr></thead><tbody>
  ${rows.length ? rows.map(e => { const pu = userById(e.userId); const sl = e.slotId ? slotById(st, e.slotId) : null; return `<tr>
    <td class="mono">${pu.pid}</td><td>${esc(pu.profile.status)} · ${esc(pu.profile.ageBand)}</td><td class="steel">${e.source === "self" ? "직접 신청" : "대기풀 초대"}</td>
    <td class="num steel">${fmtMD(e.invitedAt)}</td><td class="num steel">${e.consentAt ? fmtMD(e.consentAt) : "-"}</td>${st.slots.length ? `<td class="num steel">${sl ? fmtDT(sl.at) : "-"}</td>` : ""}
    <td class="num steel">${e.completedAt ? fmtMD(e.completedAt) : "-"}</td><td>${tag(enrLabel(e))}</td>
    <td>${e.status === "scheduled" ? `<button class="btn btn-secondary btn-sm" data-act="markDone" data-id="${e.id}">참여 완료 처리</button>` : ""}</td></tr>`; }).join("") : `<tr><td colspan="9" class="steel" style="text-align:center;padding:28px">해당하는 참여자가 없어요.</td></tr>`}
  </tbody></table></div>`;
}
function tInvite(st, en, c){
  if (st.status !== "recruiting") return `<div class="empty">모집 중인 연구만 초대를 보낼 수 있어요.</div>`;
  const el = st._elig || {n:0, byStatus:[], byAge:[]};
  const st1 = el.byStatus, ag = el.byAge;
  const def = Math.min(el.n, Math.max(10, (st.target - c.done) * 2));
  if (ui.form.invN == null || ui.form.invFor !== st.id){ ui.form.invN = def; ui.form.invFor = st.id; ui.form.invCh = "both"; }
  const cr = st.criteria;
  const dist = (title, arr) => `<div><p class="label" style="margin-bottom:8px">${title}</p><div class="dist">${arr.map(([k, n]) => `<div class="d"><span class="slate">${k}</span><div class="bar"><i style="width:${pct(n, el.n)}%"></i></div><span class="num" style="text-align:right">${n}명</span></div>`).join("")}</div></div>`;
  const sample = SAMPLE;
  return `<div class="grid-main">
    <div class="stack">
      <div class="card stack"><div class="between"><h2 class="h5">초대할 수 있는 대기풀</h2><span class="caption steel">이미 초대·참여한 사람, 최근 7일 안내 3회 이상, 일시정지 제외</span></div>
        <div class="livecount"><div class="v num">${el.n}명</div><div class="body-sm">만 ${cr.ageMin}~${cr.ageMax}세 · ${cr.statuses.length ? cr.statuses.join("·") : "신분 무관"} · ${cr.genders.length ? cr.genders.join("·") : "성별 무관"} · ${cr.depts.length ? cr.depts.length + "개 학과" : "학과 무관"}</div></div>
        ${el.n ? `<div class="two">${dist("신분", st1)}${dist("연령대", ag)}</div>` : ""}</div>
      <div class="card stack"><h2 class="h5">초대 메시지 미리보기</h2>
        <div><p class="label">이메일 · ${esc(fillTpl(st.templates.inviteSubject, st, sample))}</p><p class="body-sm charcoal" style="white-space:pre-line;margin-top:8px;padding:14px;background:var(--surface-soft);border-radius:8px">${esc(fillTpl(st.templates.inviteBody, st, sample))}</p></div>
        <div><p class="label">문자 · ${eucBytes(fillTpl(st.templates.sms, st, sample))} byte · ${eucBytes(fillTpl(st.templates.sms, st, sample)) > 90 ? "LMS" : "SMS"}</p><p class="body-sm charcoal" style="margin-top:8px;padding:14px;background:var(--surface-soft);border-radius:8px">${esc(fillTpl(st.templates.sms, st, sample))}</p></div>
        <p class="caption steel">문구는 연구 정보 탭이 아니라 등록 단계의 안내·보상에서 정합니다. {{참여자ID}} 같은 변수는 발송할 때 플랫폼이 채웁니다.</p></div>
    </div>
    <aside class="card stack"><h2 class="h5">초대 보내기</h2>
      ${fld("초대 인원","f-invN",`<input class="input num" id="f-invN" data-f="invN" type="number" min="1" max="${el.n}" value="${fv("invN")}">`, `대기풀에서 무작위로 고릅니다. 최대 ${el.n}명`)}
      <div class="field"><span class="label">발송 채널</span>${[["both","이메일 + 문자"],["email","이메일만"],["sms","문자만"]].map(([k, t]) => `<label class="check"><input type="radio" name="invCh" id="invCh-${k}" data-f="invCh" value="${k}" ${ui.form.invCh===k?"checked":""}>${t}</label>`).join("")}<p class="hint">문자 수신을 끈 참여자에게는 이메일로 대신 보냅니다.</p></div>
      <button class="btn btn-primary w100" data-act="sendInvites" data-id="${st.id}" ${el.n ? "" : "disabled"}>${icon("mail",16)}초대 보내기</button>
    </aside></div>`;
}
const SEGMENTS = {pending:["초대 후 미응답", e => e.status === "invited"], consented:["동의 후 미완료", e => e.status === "consented"], scheduled:["일정 확정자", e => e.status === "scheduled"], done:["참여 완료자", e => DONE.includes(e.status)], all:["전체 참여자 (철회 제외)", e => e.status !== "withdrawn"]};
function tSend(st, en){
  if (ui.form.sendFor !== st.id){ Object.assign(ui.form, {sendFor:st.id, seg:"pending", ch:"sms", subj:`[한신 리서치풀] ${st.title} 안내`, body:`{{참여자ID}} 님, ${st.title} 연구 참여 안내를 다시 드려요. 마감은 {{마감일}}입니다.`}); }
  const segN = en.filter(SEGMENTS[ui.form.seg][1]).length;
  const logs = S.sendLogs.filter(l => l.studyId === st.id).sort((a, b) => b.at - a.at);
  return `<div class="grid-main">
    <div class="card stack"><h2 class="h5">안내 보내기</h2>
      <div class="two">${fld("받는 사람","f-seg",`<select class="input" id="f-seg" data-f="seg" data-rr>${Object.entries(SEGMENTS).map(([k, [t]]) => `<option value="${k}" ${ui.form.seg===k?"selected":""}>${t}</option>`).join("")}</select>`, `<span id="segN">${segN}명</span>에게 발송됩니다.`)}
      ${fld("채널","f-ch",`<select class="input" id="f-ch" data-f="ch" data-rr>${[["sms","문자"],["email","이메일"],["both","이메일 + 문자"]].map(([k, t]) => `<option value="${k}" ${ui.form.ch===k?"selected":""}>${t}</option>`).join("")}</select>`)}</div>
      ${ui.form.ch !== "sms" ? fld("이메일 제목","f-subj",`<input class="input" id="f-subj" data-f="subj" value="${fv("subj")}">`) : ""}
      ${fld("내용","f-body",`<textarea class="input" id="f-body" data-f="body" rows="5">${fv("body")}</textarea>`, `<span class="bytes" data-bytes="f-body"></span> · 사용할 수 있는 변수: {{참여자ID}} {{연구명}} {{마감일}} {{소요시간}} {{보상}}`)}
      <div><p class="label" style="margin-bottom:6px">미리보기 (P-1000 기준)</p><p id="composePreview" class="body-sm charcoal" style="white-space:pre-line;padding:14px;background:var(--surface-soft);border-radius:8px"></p></div>
      <div class="row" style="justify-content:flex-end"><button class="btn btn-primary" data-act="sendCompose" data-id="${st.id}" ${segN ? "" : "disabled"}>${segN}명에게 보내기</button></div>
    </div>
    <aside class="card stack"><h2 class="h5">자동 리마인더</h2>
      <label class="check"><input type="checkbox" id="ar1" data-sb="templates.remind3" data-sid="${st.id}" ${st.templates.remind3?"checked":""}><span>초대 후 3일 동안 응답이 없으면 문자 1회</span></label>
      <label class="check"><input type="checkbox" id="ar2" data-sb="templates.remindEnd" data-sid="${st.id}" ${st.templates.remindEnd?"checked":""}><span>모집 마감 2일 전, 동의 후 미완료자에게 이메일 1회</span></label>
      <p class="caption steel">자동 리마인더도 주 3회 안내 제한에 포함됩니다.</p></aside>
  </div>
  <h2 class="h5" style="margin:32px 0 12px">발송 기록</h2>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>일시</th><th>종류</th><th>채널</th><th>대상</th><th class="num">건수</th><th>제목·내용</th></tr></thead><tbody>
  ${logs.length ? logs.map(l => `<tr><td class="num steel">${fmtDT(l.at)}</td><td>${esc(l.kind)}</td><td>${esc(l.channel)}</td><td class="steel">${esc(l.segment)}</td><td class="num">${l.count}</td><td>${esc(l.subject)}</td></tr>`).join("") : `<tr><td colspan="6" class="steel" style="text-align:center;padding:24px">아직 보낸 안내가 없어요.</td></tr>`}
  </tbody></table></div>`;
}
function tNotice(st){
  return `<div class="grid-main"><div class="stack">
    ${st.notices.length ? st.notices.slice().sort((a, b) => b.at - a.at).map(n => `<div class="card"><div class="between"><h3 class="h5">${esc(n.title)}</h3><span class="caption steel">${fmtDT(n.at)}</span></div><p class="body-sm charcoal" style="margin-top:8px;white-space:pre-line">${esc(n.body)}</p></div>`).join("") : `<div class="empty">등록된 공지가 없어요.</div>`}
  </div><aside class="card stack"><h2 class="h5">공지 등록</h2><p class="body-sm slate">연구 상세 화면에 표시됩니다. 일정 변경, 장소 안내, 점검 공지에 쓰세요.</p>
    ${fld("제목","f-nt",`<input class="input" id="f-nt" data-f="nt" value="${fv("nt")}">`)}
    ${fld("내용","f-nb",`<textarea class="input" id="f-nb" data-f="nb" rows="5">${fv("nb")}</textarea>`)}
    <label class="check"><input type="checkbox" id="f-nn" data-f="nn" ${ui.form.nn !== false ? "checked" : ""}><span>동의 완료 이상인 참여자에게 이메일로도 알리기</span></label>
    <button class="btn btn-primary" data-act="addNotice" data-id="${st.id}">공지 등록</button></aside></div>`;
}
function tReward(st, en, c){
  const amt = st.reward.amount || 0;
  const pend = en.filter(e => e.status === "completed").sort((a, b) => a.completedAt - b.completedAt);
  const paid = en.filter(e => e.status === "paid").sort((a, b) => b.paidAt - a.paidAt);
  const selN = pend.filter(e => ui.sel.has(e.id)).length;
  return `<div class="tiles">
    <div class="tile"><div class="l">지급 방식</div><div class="v" style="font-size:20px">${esc(st.reward.type)}</div><div class="caption steel">${esc(st.reward.timing)}</div></div>
    <div class="tile"><div class="l">예산 (목표 × 1인)</div><div class="v">${won(st.target * amt)}</div><div class="caption steel">1인 ${won(amt)}</div></div>
    <div class="tile"><div class="l">지급 완료</div><div class="v">${won(paid.length * amt)}</div><div class="caption steel num">${paid.length}건</div></div>
    <div class="tile"><div class="l">지급 대기</div><div class="v">${won(pend.length * amt)}</div><div class="caption steel num">${pend.length}건</div></div></div>
  ${amt === 0 ? `<div class="callout">${icon("info",18)}<span>이 연구는 보상이 없는 자원 참여 연구입니다.</span></div>` : `
  <div class="between" style="margin-bottom:12px"><h2 class="h5">지급 대기</h2><div class="row">
    <button class="btn btn-secondary btn-sm" data-act="copyLedger" data-id="${st.id}">${icon("copy",15)}지급 대장 복사</button>
    <button class="btn btn-primary btn-sm" data-act="payPick" data-id="${st.id}" ${selN ? "" : "disabled"}>선택한 ${selN}건 지급 처리</button></div></div>
  <div class="callout info" style="margin-bottom:12px">${icon("lock",18)}<span>모바일 상품권은 지급 처리 후 연구지원팀이 참여자의 등록 번호로 보냅니다. 연구자에게는 끝 네 자리만 표시됩니다.</span></div>
  <div class="tbl-wrap" style="margin-bottom:32px"><table class="tbl"><thead><tr><th><input type="checkbox" id="selAll" data-act="selAll" data-id="${st.id}" aria-label="전체 선택" ${pend.length && selN === pend.length ? "checked" : ""}></th><th>가명 ID</th><th>완료일</th><th>수신 번호</th><th class="num">금액</th></tr></thead><tbody>
  ${pend.length ? pend.map(e => { const pu = userById(e.userId); return `<tr><td><input type="checkbox" id="sel-${e.id}" data-sel="${e.id}" ${ui.sel.has(e.id)?"checked":""} aria-label="${pu.pid} 선택"></td><td class="mono">${pu.pid}</td><td class="num steel">${fmtDT(e.completedAt)}</td><td class="mono steel">${esc(pu.phone)}</td><td class="num">${won(amt)}</td></tr>`; }).join("") : `<tr><td colspan="5" class="steel" style="text-align:center;padding:24px">지급할 건이 없어요.</td></tr>`}
  </tbody></table></div>
  <h2 class="h5" style="margin-bottom:12px">지급 완료 <span class="steel num" style="font-weight:500">${paid.length}건</span></h2>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>가명 ID</th><th>완료일</th><th>지급일</th><th>상품권 발송</th><th class="num">금액</th></tr></thead><tbody>
  ${paid.slice(0, 30).map(e => `<tr><td class="mono">${userById(e.userId).pid}</td><td class="num steel">${fmtMD(e.completedAt)}</td><td class="num steel">${fmtMD(e.paidAt)}</td><td class="steel">${st.reward.type !== "모바일 상품권" ? "-" : e.rewardSentAt ? fmtMD(e.rewardSentAt) : "연구지원팀 발송 대기"}</td><td class="num">${won(amt)}</td></tr>`).join("")}
  ${paid.length > 30 ? `<tr><td colspan="5" class="steel caption" style="text-align:center">최근 30건만 표시합니다. 전체 내역은 지급 대장 복사로 받으세요.</td></tr>` : ""}
  </tbody></table></div>`}`;
}
function tData(st, en){
  const rs = en.filter(e => e.responses && e.status !== "withdrawn");
  if (!st.survey.length) return `<div class="empty">이 연구에는 설문 문항이 없어요.</div>`;
  return `<div class="between" style="margin-bottom:16px"><p class="body-sm slate">응답 <b class="num">${rs.length}</b>건 · 철회하며 폐기를 선택한 응답은 자동으로 빠집니다.</p>
    <button class="btn btn-secondary btn-sm" data-act="copyCSV" data-id="${st.id}">${icon("copy",15)}응답 데이터 복사 (CSV)</button></div>
  <div class="stack">${st.survey.map((qq, i) => {
    let inner = "";
    if (["likert","single","multi"].includes(qq.type)){
      const opts = qq.type === "likert" ? [1,2,3,4,5] : qq.options;
      const cnt = opts.map(o => rs.filter(e => { const a = e.responses[qq.id]; return Array.isArray(a) ? a.includes(o) : a === o; }).length);
      const mx = Math.max(1, ...cnt);
      const mean = qq.type === "likert" && rs.length ? (rs.reduce((s, e) => s + (e.responses[qq.id] || 0), 0) / rs.length).toFixed(2) : null;
      inner = `<div class="dist">${opts.map((o, j) => `<div class="d"><span class="slate">${qq.type === "likert" ? `${o} ${LIKERT[o-1]}` : esc(o)}</span><div class="bar"><i style="width:${cnt[j] / mx * 100}%"></i></div><span class="num" style="text-align:right">${cnt[j]}</span></div>`).join("")}</div>${mean ? `<p class="caption steel" style="margin-top:8px">평균 ${mean}점</p>` : ""}`;
    } else {
      const txt = rs.map(e => e.responses[qq.id]).filter(Boolean);
      inner = txt.length ? `<ul style="margin:0;padding-left:18px" class="body-sm charcoal">${txt.slice(0, 5).map(t => `<li>${esc(t)}</li>`).join("")}</ul><p class="caption steel" style="margin-top:6px">${txt.length}건 중 5건 표시</p>` : `<p class="body-sm steel">응답이 없어요.</p>`;
    }
    return `<div class="card"><p class="caption steel">${i+1}. ${QTYPES[qq.type]}</p><h3 class="h5" style="margin:4px 0 14px">${esc(qq.text)}</h3>${inner}</div>`;
  }).join("")}</div>`;
}
function studyInfoHtml(st){
  const cr = st.criteria;
  return `<div class="stack">
    <div class="card"><h2 class="h5" style="margin-bottom:12px">한눈에 보기</h2><dl class="kv">
      <div><dt>연구 유형</dt><dd>${TYPES[st.type]}</dd></div><div><dt>1회 소요 시간</dt><dd>${st.minutes}분</dd></div><div><dt>목표 인원</dt><dd>${st.target}명</dd></div>
      <div><dt>IRB 승인번호</dt><dd class="mono">${esc(st.irbNo || "미입력")}</dd></div><div><dt>IRB 만료일</dt><dd>${fmtD(endTs(st.irbUntil))}</dd></div><div><dt>지도교수</dt><dd>${esc(st.advisor || "-")}</dd></div>
      <div><dt>참여 대상</dt><dd>만 ${cr.ageMin}~${cr.ageMax}세 ${cr.statuses.join("·") || "신분 무관"}</dd></div><div><dt>보상</dt><dd>${esc(rewardText(st))}</dd></div>${st.location ? `<div><dt>장소</dt><dd>${esc(st.location)}</dd></div>` : ""}
      ${st.irbFile ? `<div><dt>IRB 승인 통지서</dt><dd class="body-sm">${st.irbFileId ? `<button class="btn-link" data-act="dlFile" data-id="${esc(st.irbFileId)}">${esc(st.irbFile)}</button>` : esc(st.irbFile)}</dd></div>` : ""}</dl>
      ${cr.exclude ? `<p class="body-sm slate" style="margin-top:12px"><b>제외 기준</b> ${esc(cr.exclude)}</p>` : ""}</div>
    <div><h2 class="h5" style="margin-bottom:10px">연구설명문</h2><div class="expl">${EXPL.map(([k, t]) => `<details open><summary>${t}</summary><p>${esc(st.explanation[k] || "(작성 전)")}</p></details>`).join("")}</div></div>
    <div class="card"><h2 class="h5" style="margin-bottom:10px">동의서 항목 ${st.consent.length}개</h2><ol class="body-sm charcoal" style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px">${st.consent.map(c => `<li>${esc(c)}</li>`).join("")}</ol><p class="caption steel" style="margin-top:10px">서명 방식: 성명 입력 전자서명${st.consentCopy ? " · 동의서 사본 이메일 발송" : ""}</p></div>
    <div class="card"><h2 class="h5" style="margin-bottom:10px">설문지 ${st.survey.length}문항</h2>${st.survey.length ? `<ol class="body-sm charcoal" style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:8px">${st.survey.map(qq => `<li>${esc(qq.text)} <span class="tag tag-gray" style="margin-left:4px">${QTYPES[qq.type]}</span>${qq.required ? "" : ` <span class="caption steel">선택 응답</span>`}${qq.options.length ? `<div class="caption steel">${qq.options.map(esc).join(" / ")}</div>` : ""}</li>`).join("")}</ol>` : `<p class="body-sm steel">문항이 없어요.</p>`}</div>
    ${st.slots.length ? `<div class="card"><h2 class="h5" style="margin-bottom:10px">예약 가능한 시간 ${st.slots.length}개</h2><div class="chips">${st.slots.map(s => `<span class="tag tag-gray num">${fmtDT(s.at)} · ${s.cap}명</span>`).join("")}</div></div>` : ""}
  </div>`;
}
function tInfo(st){
  const lock = ["recruiting","closed","review"].includes(st.status);
  return `${st.status === "rejected" && st.reviewComment ? `<div class="callout rose" style="margin-bottom:16px">${icon("info",18)}<span><b>연구지원팀 보완 요청</b><br>${esc(st.reviewComment)}</span></div>` : ""}
  ${lock ? `<div class="callout" style="margin-bottom:16px">${icon("lock",18)}<span>${st.status === "review" ? "심사 중에는 내용을 바꿀 수 없어요." : "공개된 연구의 설명문·동의서·설문을 바꾸려면 IRB 변경 승인 후 연구지원팀에 수정 요청을 해 주세요."}</span></div>` : ""}
  ${studyInfoHtml(st)}`;
}

/* ----- 연구 등록 마법사 ----- */
const WSTEPS = ["기본 정보","연구설명문","동의서","설문지","참여 조건","안내·보상","검토·제출"];
function blankStudy(u){
  const now = Date.now();
  return {id:uid("s"), ownerId:u.id, title:"", summary:"", type:"survey", minutes:20, target:60, start:toYMD(now + 7*DAY), end:toYMD(now + 37*DAY), location:"", irbNo:"", irbUntil:toYMD(now + 365*DAY), advisor:u.advisor || "", tint:"sky", status:"draft",
    explanation:defaultExplanation({contact:`연구책임자 ${u.name} (${u.dept})\n연구 관련 문의는 플랫폼 메시지로 보내 주세요.`}), consent:defaultConsent(), consentCopy:true, survey:[], slots:[], notices:[],
    criteria:{ageMin:19, ageMax:39, statuses:["학부생"], genders:[], depts:[], exclude:""}, reward:{type:"모바일 상품권", amount:5000, timing:"참여 완료 후 3일 이내"}, templates:defaultTemplates(), irbFile:"", createdAt:now, updatedAt:now};
}
function checks(d){
  return [
    ["제목과 한 줄 소개", !!(d.title.trim() && d.summary.trim())],
    ["IRB 승인번호", !!d.irbNo.trim()],
    ["모집 기간 (시작 ≤ 마감 ≤ IRB 만료)", d.start && d.end && d.start <= d.end && d.end <= d.irbUntil],
    ["연구설명문 7개 항목", EXPL.every(([k]) => (d.explanation[k] || "").trim())],
    ["동의서 항목 1개 이상", d.consent.filter(c => c.trim()).length > 0],
    [d.type === "survey" ? "설문 문항 1개 이상" : "설문 문항 또는 예약 시간", d.survey.length > 0 || d.slots.length > 0],
    ...(ONSITE.includes(d.type) ? [["장소와 예약 가능한 시간", !!d.location.trim() && d.slots.length > 0]] : []),
    ["설문 문항 내용과 선택지", d.survey.every(q => String(q.text).trim() && (!["single","multi"].includes(q.type) || q.options.length >= 2))],
    ["목표 인원과 소요 시간", d.target > 0 && d.minutes > 0],
    ["IRB 승인 통지서 첨부", !!d.irbFile]
  ];
}
function rWizard(u){
  const d = ui.draft; if (!d) return "";
  const s = ui.step;
  const ch = checks(d);
  const stepFns = [w1, w2, w3, w4, w5, w6, w7];
  return `<div class="page">
    <div class="crumb"><button data-act="go" data-v="r-home">내 연구</button><span>/</span><span class="charcoal">${d.title ? esc(d.title) : "새 연구 등록"}</span></div>
    <div class="page-head" style="margin-bottom:24px"><div><h1 class="h3">${S.studies.some(x => x.id === d.id) ? "연구 수정" : "새 연구 등록"}</h1><p class="slate" style="margin-top:4px">작성 내용은 임시 저장할 수 있고, 7단계에서 심사에 제출합니다.</p></div>
      <button class="btn btn-secondary" data-act="wizSave">임시 저장</button></div>
    <div class="wiz">
      <nav class="wiz-steps" aria-label="등록 단계">${WSTEPS.map((t, i) => `<button class="${i===s?"on":""} ${i<s?"done":""}" data-act="wizStep" data-v="${i}" aria-current="${i===s?"step":"false"}"><span class="n">${i<s ? "✓" : i+1}</span>${t}</button>`).join("")}</nav>
      <section class="card card-lg"><h2 class="h4" style="margin-bottom:6px">${s+1}. ${WSTEPS[s]}</h2>${stepFns[s](d, u, ch)}
        <div class="wiz-foot"><button class="btn btn-secondary" data-act="wizPrev" ${s===0?"disabled":""}>이전</button>
          ${s < 6 ? `<button class="btn btn-primary" data-act="wizNext">다음: ${WSTEPS[s+1]}</button>` : `<button class="btn btn-primary" data-act="wizSubmit" ${u.verified ? "" : "disabled"}>심사에 제출</button>`}</div>
      </section></div></div>`;
}
const bindIn = (path, d, attrs = "") => `data-bind="${path}" value="${esc(getPath(d, path))}" ${attrs}`;
function w1(d, u){
  return `<p class="slate body-sm" style="margin-bottom:24px">참여자 목록과 연구 상세 화면에 보이는 정보입니다.</p><div class="form-grid">
    ${fld("연구 제목","w-title",`<input class="input" id="w-title" ${bindIn("title", d)} placeholder="예: 대학생의 수면 습관과 정서 조절">`,"",true)}
    ${fld("한 줄 소개","w-sum",`<input class="input" id="w-sum" ${bindIn("summary", d)} placeholder="참여자가 무엇을 하는지 한 문장으로">`,"모집 목록 카드에 보이는 문장입니다.",true)}
    <div class="three">${fld("연구 유형","w-type",`<select class="input" id="w-type" data-bind="type" data-rerender>${Object.entries(TYPES).map(([k, t]) => `<option value="${k}" ${d.type===k?"selected":""}>${t}</option>`).join("")}</select>`)}
      ${fld("1회 소요 시간(분)","w-min",`<input class="input num" id="w-min" type="number" min="1" ${bindIn("minutes", d)}>`)}
      ${fld("목표 인원","w-target",`<input class="input num" id="w-target" type="number" min="1" ${bindIn("target", d)}>`)}</div>
    ${ONSITE.includes(d.type) ? fld("장소","w-loc",`<input class="input" id="w-loc" ${bindIn("location", d)} placeholder="예: 장공관 3층 심리실험실">`,"",true) : ""}
    <div class="two">${fld("모집 시작일","w-start",`<input class="input" id="w-start" type="date" ${bindIn("start", d)}>`)}${fld("모집 마감일","w-end",`<input class="input" id="w-end" type="date" ${bindIn("end", d)}>`)}</div>
    <div class="two">${fld("IRB 승인번호","w-irb",`<input class="input mono" id="w-irb" ${bindIn("irbNo", d)} placeholder="HS-IRB-2026-0000">`,"승인 전이라면 비워 두고 임시 저장하세요.",true)}
      ${fld("IRB 승인 만료일","w-irbu",`<input class="input" id="w-irbu" type="date" ${bindIn("irbUntil", d)}>`,"모집 마감일보다 늦어야 합니다.")}</div>
    <div class="two">${fld("연구책임자","w-pi",`<input class="input" id="w-pi" value="${esc(u.name)} (${esc(u.program)})" disabled>`)}${fld("지도교수","w-adv",`<input class="input" id="w-adv" ${bindIn("advisor", d)}>`)}</div>
    <div class="field"><span class="label">카드 색상</span><div class="row">${Object.entries(TINTS).map(([k, [bg]]) => `<label class="swatch" style="background:${bg}" title="${k}"><input type="radio" name="tint" id="tint-${k}" data-bind="tint" value="${k}" ${d.tint===k?"checked":""} aria-label="${k}"></label>`).join("")}</div><p class="hint">내 연구 목록과 참여자 화면에서 이 연구를 구분하는 색입니다.</p></div>
  </div>`;
}
function w2(d){
  const hints = {purpose:"이 연구로 무엇을 알고 싶은지 쉬운 말로 적어 주세요.", procedure:"참여자가 실제로 하는 일을 순서대로. 소요 시간과 방문 횟수를 꼭 적어 주세요.", risks:"설문 문항으로 생길 수 있는 심리적 불편과 대처 방법", benefits:"직접적 이익이 없다면 그렇다고 적어 주세요.", privacy:"가명 처리, 보관 기간, 폐기 방법", withdraw:"철회 방법과 자료 처리", contact:"연구책임자 연락 방법과 IRB 문의처"};
  return `<p class="slate body-sm" style="margin-bottom:24px">참여자가 동의하기 전에 끝까지 읽는 문서입니다. 기본 문구가 들어 있으니 IRB 승인본과 같게 고쳐 주세요.</p><div class="form-grid">
    ${EXPL.map(([k, t]) => fld(t, "w-ex-" + k, `<textarea class="input" id="w-ex-${k}" data-bind="explanation.${k}" rows="4">${esc(d.explanation[k])}</textarea>`, hints[k], true)).join("")}</div>`;
}
function w3(d){
  return `<p class="slate body-sm" style="margin-bottom:24px">참여자는 항목마다 체크하고 성명을 입력해 서명합니다. 서명 일시와 동의서 버전이 함께 기록됩니다.</p>
  <div class="stack">${d.consent.map((c, i) => `<div class="row" style="flex-wrap:nowrap"><span class="caption steel num" style="min-width:20px">${i+1}</span><input class="input" id="w-ci-${i}" data-ci="${i}" value="${esc(c)}" aria-label="동의 항목 ${i+1}"><button class="icon-btn" data-act="delCI" data-v="${i}" aria-label="항목 삭제">${icon("trash",16)}</button></div>`).join("")}
  <button class="btn btn-secondary" style="align-self:flex-start" data-act="addCI">${icon("plus",15)}항목 추가</button>
  <label class="check" style="margin-top:8px"><input type="checkbox" id="w-copy" data-bind="consentCopy" ${d.consentCopy?"checked":""}><span>서명한 동의서 사본을 참여자 이메일로 보냅니다.</span></label></div>`;
}
function w4(d){
  return `<p class="slate body-sm" style="margin-bottom:20px">자기보고식 설문 문항을 만듭니다. 대면 실험이나 면담이라면 사전 설문으로 쓰거나 비워 두세요. 저작권이 있는 척도는 사용 허락을 받은 경우에만 옮겨 주세요.</p>
  <div class="stack">${d.survey.map((qq, i) => `<div class="qcard">
    <div class="qh"><span class="qn num">Q${i+1}</span><select class="input" style="max-width:160px;height:36px" id="w-qt-${i}" data-q="${i}" data-qf="type" aria-label="문항 유형">${Object.entries(QTYPES).map(([k, t]) => `<option value="${k}" ${qq.type===k?"selected":""}>${t}</option>`).join("")}</select>
      <label class="check" style="margin-left:8px"><input type="checkbox" id="w-qr-${i}" data-q="${i}" data-qf="required" ${qq.required?"checked":""}>필수</label>
      <span style="margin-left:auto" class="row"><button class="icon-btn" data-act="upQ" data-v="${i}" aria-label="위로">${icon("up",16)}</button><button class="icon-btn" data-act="downQ" data-v="${i}" aria-label="아래로">${icon("down",16)}</button><button class="icon-btn" data-act="delQ" data-v="${i}" aria-label="문항 삭제">${icon("trash",16)}</button></span></div>
    <input class="input" id="w-qx-${i}" data-q="${i}" data-qf="text" value="${esc(qq.text)}" placeholder="문항 내용" aria-label="문항 ${i+1} 내용">
    ${["single","multi"].includes(qq.type) ? `<textarea class="input" id="w-qo-${i}" data-q="${i}" data-qf="options" rows="3" aria-label="선택지 (한 줄에 하나)">${esc(qq.options.join("\n"))}</textarea><p class="hint">선택지를 한 줄에 하나씩 적어 주세요.</p>` : qq.type === "likert" ? `<p class="hint">${LIKERT.map((l, j) => `${j+1} ${l}`).join(" · ")}</p>` : ""}
  </div>`).join("") || `<div class="empty">아직 문항이 없어요. 아래에서 유형을 골라 추가하세요.</div>`}
  <div class="row">${Object.entries(QTYPES).map(([k, t]) => `<button class="btn btn-secondary btn-sm" data-act="addQ" data-v="${k}">${icon("plus",14)}${t}</button>`).join("")}</div></div>`;
}
function w5(d){
  const cr = d.criteria;
  const chips = (path, opts) => `<div class="chips">${opts.map((o, i) => `<label class="chip"><input type="checkbox" id="${path.replace(/\./g,"-")}-${i}" data-arr="${path}" value="${esc(o)}" ${getPath(d, path).includes(o)?"checked":""}>${esc(o)}</label>`).join("")}</div>`;
  return `<p class="slate body-sm" style="margin-bottom:24px">대기풀에서 안내를 받을 사람을 정합니다. 아무것도 고르지 않은 항목은 제한 없음으로 처리됩니다.</p>
  <div class="grid-main" style="grid-template-columns:minmax(0,1fr) 240px"><div class="form-grid">
    <div class="two">${fld("최소 나이(만)","w-amin",`<input class="input num" id="w-amin" type="number" min="19" ${bindIn("criteria.ageMin", d)}>`,"플랫폼 가입은 만 19세 이상만 가능합니다.")}${fld("최대 나이(만)","w-amax",`<input class="input num" id="w-amax" type="number" min="19" ${bindIn("criteria.ageMax", d)}>`)}</div>
    <div class="field"><span class="label">신분</span>${chips("criteria.statuses", STATUSES)}</div>
    <div class="field"><span class="label">성별</span>${chips("criteria.genders", GENDERS)}</div>
    <div class="field"><span class="label">학과</span>${chips("criteria.depts", DEPTS)}</div>
    ${fld("제외 기준","w-excl",`<textarea class="input" id="w-excl" data-bind="criteria.exclude" rows="2" placeholder="예: 최근 6개월 안에 같은 주제의 연구에 참여한 경우">${esc(cr.exclude)}</textarea>`,"참여자가 신청 전에 읽고 스스로 확인합니다.")}
    ${ONSITE.includes(d.type) ? `<div class="field"><span class="label">예약 가능한 시간</span><div class="stack-sm">${d.slots.map((s, i) => `<div class="row" style="flex-wrap:nowrap"><input class="input" type="datetime-local" id="w-sl-${i}" data-slot="${i}" data-sf="at" value="${toLocalDT(s.at)}" aria-label="일시"><input class="input num" style="max-width:110px" type="number" min="1" id="w-sc-${i}" data-slot="${i}" data-sf="cap" value="${s.cap}" aria-label="정원"><button class="icon-btn" data-act="delSlot" data-v="${i}" aria-label="시간 삭제">${icon("trash",16)}</button></div>`).join("")}
      <button class="btn btn-secondary btn-sm" style="align-self:flex-start" data-act="addSlot">${icon("plus",14)}시간 추가</button></div><p class="hint">참여자는 동의 후 남은 자리가 있는 시간 중 하나를 고릅니다.</p></div>` : ""}
  </div><aside class="livecount" style="position:sticky;top:20px"><p class="body-sm">지금 대기풀에서 조건에 맞는 인원</p><div class="v num" id="matchCount">${esc(_pc.text)}</div><p class="caption" style="margin-top:6px">일시정지한 참여자 제외 · 조건을 바꾸면 다시 계산합니다. 5명 미만은 정확한 수를 표시하지 않습니다.</p></aside></div>`;
}
function toLocalDT(t){ const d = new Date(t); return `${toYMD(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function w6(d){
  const t = d.templates;
  return `<p class="slate body-sm" style="margin-bottom:24px">대기풀 초대 문구와 보상을 정합니다. 문구 안의 {{참여자ID}} {{연구명}} {{마감일}} {{소요시간}} {{보상}}은 발송할 때 채워집니다.</p><div class="form-grid">
    <div class="three">${fld("보상 종류","w-rt",`<select class="input" id="w-rt" data-bind="reward.type">${REWARD_TYPES.map(r => `<option ${d.reward.type===r?"selected":""}>${r}</option>`).join("")}</select>`)}
      ${fld("1인 금액(원)","w-ra",`<input class="input num" id="w-ra" type="number" min="0" step="1000" ${bindIn("reward.amount", d)}>`)}
      ${fld("지급 시점","w-rtime",`<select class="input" id="w-rtime" data-bind="reward.timing">${["참여 완료 후 3일 이내","매주 금요일 일괄","실험 참여 당일 지급","면담 종료 후 3일 이내","모집 종료 후 일괄"].map(r => `<option ${d.reward.timing===r?"selected":""}>${r}</option>`).join("")}</select>`)}</div>
    ${fld("초대 이메일 제목","w-is",`<input class="input" id="w-is" ${bindIn("templates.inviteSubject", d)}>`)}
    ${fld("초대 이메일 본문","w-ib",`<textarea class="input" id="w-ib" data-bind="templates.inviteBody" rows="9">${esc(t.inviteBody)}</textarea>`)}
    ${fld("초대 문자","w-sms",`<textarea class="input" id="w-sms" data-bind="templates.sms" rows="2">${esc(t.sms)}</textarea>`, `<span class="bytes" data-bytes="w-sms" data-fill="1"></span> · 90byte를 넘으면 LMS로 발송됩니다. 연구명을 넣으면 대부분 LMS가 됩니다.`)}
    <div class="field"><span class="label">자동 리마인더</span>
      <label class="check"><input type="checkbox" id="w-r3" data-bind="templates.remind3" ${t.remind3?"checked":""}>초대 후 3일 동안 응답이 없으면 문자 1회</label>
      <label class="check"><input type="checkbox" id="w-re" data-bind="templates.remindEnd" ${t.remindEnd?"checked":""}>모집 마감 2일 전, 동의 후 미완료자에게 이메일 1회</label></div>
  </div>`;
}
function w7(d, u, ch){
  const okAll = ch.every(c => c[1]);
  return `<p class="slate body-sm" style="margin-bottom:24px">연구지원팀이 IRB 승인 내용과 같은지 확인한 뒤 공개합니다. 보통 2~3일 걸립니다.</p>
  ${u.verified ? "" : `<div class="callout warn" style="margin-bottom:20px">${icon("info",18)}<span>연구자 확인이 끝나면 제출할 수 있어요. 지금은 임시 저장만 됩니다.</span></div>`}
  <div class="stack">
    <div class="check-list">${ch.map(([t, ok]) => `<div class="ci"><span class="ok-dot" style="background:${ok ? "var(--t-mint)" : "var(--t-gray)"};color:${ok ? "var(--green-ink)" : "var(--stone)"}">${ok ? icon("check",13) : ""}</span><span class="${ok ? "" : "steel"}">${t}</span></div>`).join("")}</div>
    ${fld("IRB 승인 통지서","w-irbf",`<input class="input" type="file" id="w-irbf" data-dfile="irbFile" accept=".pdf" style="padding:9px 12px">`, d.irbFile ? `첨부됨: ${esc(d.irbFile)}` : "PDF 파일", true)}
    <label class="check"><input type="checkbox" id="w-pledge" data-f="pledge" ${ui.form.pledge?"checked":""}><span>입력한 연구설명문, 동의서, 설문지가 IRB 승인 내용과 같음을 확인합니다.</span></label>
    ${okAll ? `<div class="callout ok">${icon("check",18)}<span>필수 항목이 모두 채워졌어요.</span></div>` : `<div class="callout">${icon("info",18)}<span>회색으로 표시된 항목을 채워야 제출할 수 있어요. 왼쪽 단계를 눌러 이동하세요.</span></div>`}
    <details class="expl" style="border:1px solid var(--hair);border-radius:12px;padding:16px 20px"><summary>참여자에게 보일 내용 미리보기</summary><div style="margin-top:16px">${studyInfoHtml(d)}</div></details>
  </div>`;
}

function rPool(u){
  const p = S.pool || {total:0, active:0, paused:0, smsPct:0, breakdown:null}, b = p.breakdown;
  const block = (title, arr) => `<div class="card"><h2 class="h5" style="margin-bottom:14px">${title}</h2><div class="dist">${arr.map(([k, n]) => `<div class="d"><span class="slate">${esc(k)}</span><div class="bar"><i style="width:${pct(n, Math.max(...arr.map(a => a[1])))}%"></i></div><span class="num" style="text-align:right">${n}</span></div>`).join("")}</div></div>`;
  return `<div class="page"><div class="page-head"><div><p class="eyebrow">개인을 식별할 수 없는 집계만 표시합니다</p><h1 class="h2">대기풀 현황</h1></div></div>
    <div class="tiles"><div class="tile"><div class="l">등록 인원</div><div class="v">${p.total}명</div></div><div class="tile"><div class="l">지금 안내 받는 인원</div><div class="v">${p.active}명</div></div>
      <div class="tile"><div class="l">일시정지</div><div class="v">${p.paused}명</div></div><div class="tile"><div class="l">문자 수신 동의</div><div class="v">${p.smsPct}%</div></div></div>
    ${b ? `<div class="three" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">
      ${block("신분", b.status)}${block("연령대", b.age)}${block("성별", b.gender)}
      ${block("관심 분야 (복수)", b.interests)}${block("참여 가능 시간 (복수)", b.times)}${block("학부 학과 상위 6개", b.depts)}
    </div>` : `<div class="empty">안내를 받는 인원이 20명 이상일 때 분포를 보여 드려요. 인원이 적으면 개인이 드러날 수 있어 집계를 가립니다.</div>`}</div>`;
}
function tInquiries(st){
  const qs = S.inquiries.filter(q => q.studyId === st.id);
  return `<div class="callout info" style="margin-bottom:16px">${icon("lock",18)}<span>참여자의 문의는 가명 ID로만 표시됩니다. 답변은 플랫폼이 참여자의 알림함과 이메일로 전달하므로 개인 연락처를 주고받을 필요가 없습니다.</span></div>
  ${qs.length ? `<div class="stack">${qs.map(q => `<div class="card stack-sm"><div class="between"><b class="mono">${esc(q.pid)}</b><span class="caption steel">${fmtDT(q.at)}</span></div>
    ${q.reported ? `<p class="body-sm steel">신고한 문의입니다. 내용은 가려졌고 연구지원팀이 확인합니다.</p>` : `<p class="body-sm charcoal" style="white-space:pre-line">${esc(q.body)}</p>
    ${q.reply ? `<div style="padding:12px 14px;background:var(--surface-soft);border-radius:8px"><p class="caption steel">내 답변 · ${fmtDT(q.repliedAt)}</p><p class="body-sm charcoal" style="white-space:pre-line;margin-top:4px">${esc(q.reply)}</p></div>` :
    `<textarea class="input" id="rq-${q.id}" data-f="rq_${q.id}" rows="3" placeholder="답변을 적어 주세요" aria-label="${esc(q.pid)} 문의에 답변">${fv("rq_" + q.id)}</textarea>
    <div class="row" style="justify-content:flex-end"><button class="btn btn-ghost btn-sm" data-act="reportInq" data-id="${q.id}">부적절한 문의 신고</button><button class="btn btn-primary btn-sm" data-act="replyInq" data-id="${q.id}">답변 보내기</button></div>`}`}
  </div>`).join("")}</div>` : `<div class="empty">아직 받은 문의가 없어요.</div>`}`;
}
function rLogs(u){
  const ids = new Set(S.studies.filter(s => s.ownerId === u.id).map(s => s.id));
  const logs = S.sendLogs.filter(l => ids.has(l.studyId)).sort((a, b) => b.at - a.at);
  return `<div class="page"><div class="page-head"><h1 class="h2">발송 기록</h1></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>일시</th><th>연구</th><th>종류</th><th>채널</th><th>대상</th><th class="num">건수</th></tr></thead><tbody>
    ${logs.map(l => { const s = studyById(l.studyId); return `<tr><td class="num steel">${fmtDT(l.at)}</td><td><span class="row" style="flex-wrap:nowrap">${tintDot(s)}${esc(s.title)}</span></td><td>${esc(l.kind)}</td><td>${esc(l.channel)}</td><td class="steel">${esc(l.segment)}</td><td class="num">${l.count}</td></tr>`; }).join("") || `<tr><td colspan="6" class="steel" style="text-align:center;padding:24px">기록이 없어요.</td></tr>`}
    </tbody></table></div></div>`;
}

/* ========== 참여자 ========== */
function myEnr(u, sid){ return S.enrollments.find(e => e.userId === u.id && e.studyId === sid); }
function pCard(st, u){
  const e = myEnr(u, st.id), fit = matches(st, u);
  const full = doneOf(st) >= st.target;
  let badge = "";
  if (e && e.status === "invited" && e.source === "invite") badge = `<span class="badge">초대받음</span>`;
  else if (e && e.status !== "withdrawn") badge = tag(enrLabel(e));
  else if (!fit) badge = `<span class="tag tag-gray">${esc(mismatch(st, u))}</span>`;
  else if (full) badge = `<span class="tag tag-gray">모집 인원 마감</span>`;
  return `<article class="s-card" style="background:${tintBg(st)}">
    <div class="row">${typeTag(st)}${badge}</div>
    <h3>${esc(st.title)}</h3><p class="body-sm">${esc(st.summary)}</p>
    <div class="meta" style="color:var(--slate)"><span>${icon("clock",14)} ${st.minutes}분</span><span>${icon("gift",14)} ${esc(rewardText(st))}</span></div>
    <div class="foot"><span class="caption" style="font-weight:600">${dday(st.end)}</span><button class="btn btn-secondary btn-sm" style="background:var(--canvas)" data-act="pOpen" data-id="${st.id}">자세히 보기</button></div>
  </article>`;
}
function pHome(u){
  const rec = S.studies.filter(s => s.status === "recruiting");
  const mine = S.enrollments.filter(e => e.userId === u.id);
  const fit = rec.filter(s => matches(s, u) && (!myEnr(u, s.id) || (myEnr(u, s.id).status === "invited")) && doneOf(s) < s.target);
  const ongoing = mine.filter(e => ["invited","consented","scheduled"].includes(e.status) && e.source !== "invite" || ["consented","scheduled"].includes(e.status));
  const doneN = mine.filter(e => DONE.includes(e.status)).length;
  const rewardSum = mine.filter(e => e.status === "paid").reduce((a, e) => a + studyById(e.studyId).reward.amount, 0);
  const notices = mine.filter(e => e.status !== "withdrawn").flatMap(e => studyById(e.studyId).notices.map(n => ({...n, st:studyById(e.studyId)}))).sort((a, b) => b.at - a.at).slice(0, 3);
  const paused = !poolActive(u);
  return `<div class="page">
    <div class="page-head"><div><p class="eyebrow">${u.affiliation === "external" ? "학외 참여자" : `${esc(u.profile.dept)} · ${esc(u.profile.year)}`}</p><h1 class="h2">${esc(u.name)} 님, 안녕하세요</h1></div></div>
    <div class="pool-card ${paused ? "paused" : ""}"><div class="stack-sm">
      <div class="row"><span class="tag ${paused ? "tag-gray" : "tag-purple"}" style="background:var(--canvas)">${u.pool.joined ? (paused ? "안내 일시정지" : "대기풀 등록 중") : "대기풀 미등록"}</span><span class="mono caption">${u.pid}</span></div>
      <h2 class="h4">${paused ? "지금은 새 연구 안내를 받지 않아요" : "조건에 맞는 연구가 열리면 바로 알려드려요"}</h2>
      <p class="body-sm">${u.contact.sms ? "이메일과 문자" : "이메일"}로 안내합니다 · 등록일 ${fmtD(u.pool.since || u.joinedAt)} · 참여 완료 ${doneN}회 · 받은 보상 ${won(rewardSum)}</p></div>
      <div class="row"><button class="btn ${paused ? "btn-primary" : "btn-secondary"}" ${paused ? "" : 'style="background:var(--canvas)"'} data-act="togglePause">${paused ? "안내 다시 받기" : `${icon("pause",15)}안내 일시정지`}</button></div></div>
    ${ongoing.length ? `<section style="margin-bottom:32px"><h2 class="h5" style="margin-bottom:12px">이어서 할 일</h2><div class="list">${ongoing.map(e => { const st = studyById(e.studyId); const sl = e.slotId ? slotById(st, e.slotId) : null; return `<div class="srow" style="cursor:default"><div><h3>${tintDot(st)}${esc(st.title)}</h3><div class="meta">${tag(enrLabel(e))}${sl ? `<span>${fmtDT(sl.at)} · ${esc(st.location)}</span>` : ""}</div></div><div style="text-align:right">${e.status === "scheduled" ? `<span class="body-sm steel">예약한 시간에 방문해 주세요</span>` : `<button class="btn btn-primary btn-sm" data-act="pApply" data-id="${st.id}">이어서 참여하기</button>`}</div></div>`; }).join("")}</div></section>` : ""}
    <section style="margin-bottom:32px"><div class="between" style="margin-bottom:12px"><h2 class="h5">회원님께 맞는 연구 <span class="steel num" style="font-weight:500">${fit.length}</span></h2><button class="btn-link" data-act="go" data-v="p-studies">모집 중인 연구 모두 보기</button></div>
      ${fit.length ? `<div class="cards3">${fit.map(s => pCard(s, u)).join("")}</div>` : `<div class="empty">지금은 조건에 맞는 연구가 없어요. 새 연구가 열리면 알려드릴게요.</div>`}</section>
    ${notices.length ? `<section><h2 class="h5" style="margin-bottom:12px">참여한 연구의 공지</h2><div class="list">${notices.map(n => `<div class="card" style="padding:18px 20px"><div class="between"><b>${esc(n.title)}</b><span class="caption steel">${fmtMD(n.at)}</span></div><p class="caption steel" style="margin-top:2px">${esc(n.st.title)}</p><p class="body-sm charcoal" style="margin-top:8px">${esc(n.body)}</p></div>`).join("")}</div></section>` : ""}
  </div>`;
}
function pStudies(u){
  const rec = S.studies.filter(s => s.status === "recruiting" && (ui.pFilter === "all" || s.type === ui.pFilter) && (!ui.pOnlyFit || matches(s, u)));
  return `<div class="page"><div class="page-head"><div><h1 class="h2">모집 중인 연구</h1><p class="slate" style="margin-top:4px">모든 연구는 IRB 승인을 연구지원팀이 확인한 뒤 공개됩니다.</p></div></div>
    <div class="between" style="margin-bottom:20px"><div class="pills">${[["all","전체"],...Object.entries(TYPES)].map(([k, t]) => `<button class="${ui.pFilter===k?"on":""}" data-act="pFilter" data-v="${k}">${t}</button>`).join("")}</div>
      <label class="check"><input type="checkbox" id="onlyfit" data-act="onlyFit" ${ui.pOnlyFit?"checked":""}>참여 가능한 연구만</label></div>
    ${rec.length ? `<div class="cards3">${rec.map(s => pCard(s, u)).join("")}</div>` : `<div class="empty">해당하는 연구가 없어요.</div>`}</div>`;
}
function pStudy(u){
  const st = studyById(ui.p.id); if (!st) return "";
  const e = myEnr(u, st.id), fit = matches(st, u), c = {done:doneOf(st)};
  const full = c.done >= st.target, open = st.status === "recruiting";
  const owner = userById(st.ownerId);
  const myQs = S.inquiries.filter(q => q.studyId === st.id);
  const canAsk = (e && e.status !== "withdrawn") || (open && fit);
  const sl = e && e.slotId ? slotById(st, e.slotId) : null;
  let cta;
  if (e && e.status === "withdrawn") cta = `<div class="callout">${icon("info",18)}<span>이 연구는 ${fmtMD(e.withdrawnAt || Date.now())}에 철회했어요. 같은 연구에는 다시 참여할 수 없습니다.</span></div>`;
  else if (e && ["completed","paid"].includes(e.status)) cta = `<div class="callout ok">${icon("check",18)}<span>${fmtMD(e.completedAt)}에 참여를 마쳤어요. ${e.status === "paid" ? (st.reward.type === "모바일 상품권" && !e.rewardSentAt ? "보상 지급이 접수되었고, 상품권은 영업일 3일 안에 발송됩니다." : `보상이 ${fmtMD(e.rewardSentAt || e.paidAt)}에 지급되었습니다.`) : `보상은 ${esc(st.reward.timing)} 발송됩니다.`}</span></div>`;
  else if (e && e.status === "scheduled") cta = `<div class="callout info">${icon("clock",18)}<span><b>${sl ? fmtDT(sl.at) : ""}</b> ${esc(st.location)}<br>예약한 시간에 방문해 주세요. 일정을 바꿔야 하면 철회하지 말고 '연구자에게 문의하기'로 알려 주세요.</span></div>`;
  else if (e && e.status === "consented") cta = `<button class="btn btn-primary" data-act="pApply" data-id="${st.id}">이어서 참여하기</button>`;
  else if (!open) cta = `<div class="callout">${icon("info",18)}<span>모집이 끝난 연구입니다.</span></div>`;
  else if (!fit) cta = `<div class="callout">${icon("info",18)}<span>참여 조건에 맞지 않아요: ${esc(mismatch(st, u))}</span></div>`;
  else if (full) cta = `<div class="callout">${icon("info",18)}<span>모집 인원이 모두 찼어요.</span></div>`;
  else cta = `<button class="btn btn-primary" data-act="pApply" data-id="${st.id}">참여 신청하기</button><p class="caption steel" style="margin-top:8px">신청하면 연구설명문 확인과 전자동의 단계로 이어집니다.</p>`;
  return `<div class="s-hero" style="background:${tintBg(st)}"><div class="page" style="padding-bottom:32px">
    <div class="crumb"><button data-act="go" data-v="p-studies">모집 중인 연구</button><span>/</span><span class="charcoal">${esc(st.title)}</span></div>
    <div class="row" style="margin-bottom:10px">${typeTag(st)}${e ? tag(enrLabel(e)) : ""}<span class="tag tag-gray" style="background:var(--canvas)">${icon("shield",13)} IRB 승인 확인됨</span></div>
    <h1 class="h2" style="color:var(--ink);max-width:800px">${esc(st.title)}</h1><p class="sub" style="margin-top:10px;max-width:680px;color:var(--charcoal)">${esc(st.summary)}</p>
  </div></div>
  <div class="page"><div class="grid-main">
    <div class="stack">
      <dl class="kv"><div><dt>소요 시간</dt><dd>${st.minutes}분${st.slots.length ? " · 1회 방문" : ""}</dd></div><div><dt>보상</dt><dd>${esc(rewardText(st))}</dd></div><div><dt>모집 마감</dt><dd>${fmtMD(endTs(st.end))} (${dday(st.end)})</dd></div>
        <div><dt>연구책임자</dt><dd>${esc(owner.name)} · ${esc(owner.program)}</dd></div><div><dt>IRB 승인번호</dt><dd class="mono">${esc(st.irbNo)}</dd></div>${st.location ? `<div><dt>장소</dt><dd class="body-sm">${esc(st.location)}</dd></div>` : `<div><dt>방식</dt><dd>온라인</dd></div>`}</dl>
      <div class="card"><h2 class="h5" style="margin-bottom:8px">참여 대상</h2><p class="body-sm charcoal">만 ${st.criteria.ageMin}~${st.criteria.ageMax}세 ${st.criteria.statuses.join("·") || ""}${st.criteria.genders.length ? " · " + st.criteria.genders.join("·") : ""}</p>${st.criteria.exclude ? `<p class="body-sm slate" style="margin-top:6px"><b>참여할 수 없는 경우</b> ${esc(st.criteria.exclude)}</p>` : ""}</div>
      <div><h2 class="h5" style="margin-bottom:10px">연구설명문</h2><div class="expl">${EXPL.map(([k, t], i) => `<details ${i < 2 ? "open" : ""}><summary>${t}</summary><p>${esc(st.explanation[k])}</p></details>`).join("")}</div></div>
      ${st.notices.length ? `<div><h2 class="h5" style="margin-bottom:10px">공지</h2><div class="list">${st.notices.map(n => `<div class="card" style="padding:16px 20px"><div class="between"><b>${esc(n.title)}</b><span class="caption steel">${fmtMD(n.at)}</span></div><p class="body-sm charcoal" style="margin-top:6px">${esc(n.body)}</p></div>`).join("")}</div></div>` : ""}
      ${myQs.length ? `<div><h2 class="h5" style="margin-bottom:10px">내 문의</h2><div class="list">${myQs.map(q => `<div class="card" style="padding:16px 20px"><div class="between"><span class="caption steel">${fmtDT(q.at)}</span>${q.reply ? '<span class="tag tag-green">답변 완료</span>' : '<span class="tag tag-gray">답변 대기</span>'}</div><p class="body-sm charcoal" style="margin-top:6px;white-space:pre-line">${esc(q.body)}</p>${q.reply ? `<div style="margin-top:10px;padding:12px 14px;background:var(--surface-soft);border-radius:8px"><p class="caption steel">연구자 답변</p><p class="body-sm charcoal" style="white-space:pre-line;margin-top:4px">${esc(q.reply)}</p></div>` : ""}</div>`).join("")}</div></div>` : ""}
    </div>
    <aside class="card stack" style="position:sticky;top:20px">${cta}
      ${e && !["withdrawn"].includes(e.status) ? `<button class="btn btn-danger btn-sm" data-act="withdraw" data-id="${e.id}">참여 철회하기</button>` : ""}
      ${canAsk ? `<button class="btn btn-secondary btn-sm" data-act="askOpen" data-id="${st.id}">연구자에게 문의하기</button>` : ""}
      <p class="caption steel">연구자는 회원님의 이름과 연락처를 볼 수 없고, 가명 ID ${u.pid}로만 확인합니다.</p></aside>
  </div></div>`;
}
function flowSteps(st){ return ["explain","consent", ...(st.slots.length ? ["slot"] : []), ...(st.survey.length ? ["survey"] : []), "done"]; }
const FLOW_LABEL = {explain:"설명문 확인", consent:"전자동의", slot:"일정 선택", survey:"설문", done:"완료"};
function pFlow(u){
  const f = ui.flow; if (!f) return "";
  const st = studyById(f.studyId), steps = flowSteps(st), cur = steps[f.i];
  let body = "";
  if (cur === "explain"){
    body = `<p class="slate" style="margin-bottom:16px">끝까지 읽은 뒤 아래에 체크해 주세요. 궁금한 점은 참여 전에 연구자에게 메시지로 물어볼 수 있습니다.</p>
    <div class="doc" tabindex="0" aria-label="연구설명문"><h4>${esc(st.title)}</h4><p class="caption steel">IRB 승인번호 ${esc(st.irbNo)} · 연구책임자 ${esc(userById(st.ownerId).name)}</p>${EXPL.map(([k, t]) => `<h4>${t}</h4><p>${esc(st.explanation[k])}</p>`).join("")}</div>
    <label class="check" style="margin-top:16px"><input type="checkbox" id="fl-read" data-fl="readOk" ${f.readOk?"checked":""}><span>연구설명문을 끝까지 읽었습니다.</span></label>`;
  } else if (cur === "consent"){
    body = `<p class="slate" style="margin-bottom:16px">항목마다 확인하고 성명을 입력하면 서명이 완료됩니다. 동의하지 않으면 언제든 나갈 수 있어요.</p>
    <div class="agree" style="background:var(--canvas)">${st.consent.map((c, i) => `<label class="check"><input type="checkbox" id="fl-c${i}" data-fc="${i}" ${f.checks[i]?"checked":""}><span>${esc(c)}</span></label>`).join("")}</div>
    <div class="two" style="margin-top:20px">${fld("서명 (성명 입력)","fl-sig",`<input class="input" id="fl-sig" data-fl="signature" value="${esc(f.signature)}" placeholder="${esc(u.name)}" autocomplete="off">`, "가입할 때 등록한 이름과 같게 입력해 주세요.")}${fld("서명 일시","fl-date",`<input class="input" id="fl-date" value="${fmtD(Date.now())} ${pad(new Date().getHours())}:${pad(new Date().getMinutes())}" disabled>`)}</div>
    ${st.consentCopy ? `<label class="check" style="margin-top:12px"><input type="checkbox" id="fl-copy" data-fl="copy" ${f.copy?"checked":""}><span>서명한 동의서 사본을 이메일로 받겠습니다.</span></label>` : ""}`;
  } else if (cur === "slot"){
    body = `<p class="slate" style="margin-bottom:16px">${esc(st.location)}에서 진행합니다. 가능한 시간을 하나 골라 주세요.</p>
    <div class="stack-sm">${st.slots.filter(s => s.at > Date.now()).map(s => { const left = s.cap - s.booked; return `<label class="opt" ${left <= 0 ? 'style="opacity:.5;cursor:not-allowed"' : ""}><input type="radio" name="slot" id="fl-s-${s.id}" data-fl="slotId" value="${s.id}" ${f.slotId===s.id?"checked":""} ${left <= 0 ? "disabled" : ""}><span style="flex:1" class="num">${fmtDT(s.at)}</span><span class="caption steel">${left > 0 ? `${left}자리 남음` : "마감"}</span></label>`; }).join("")}</div>`;
  } else if (cur === "survey"){
    const req = st.survey.filter(q => q.required), answered = req.filter(q => hasAns(f.answers[q.id])).length;
    body = `<div class="between" style="margin-bottom:16px"><p class="slate">정답은 없어요. 평소 모습에 가까운 쪽을 골라 주세요.</p><span class="caption steel" id="flowProg">필수 ${answered}/${req.length}</span></div>
    <div class="stack">${st.survey.map((qq, i) => `<fieldset class="q" style="margin:0"><legend class="qt" style="padding:0">${i+1}. ${esc(qq.text)}${qq.required ? "" : ' <span class="caption steel">(선택)</span>'}</legend>${ansInput(qq, f.answers[qq.id])}</fieldset>`).join("")}</div>`;
  } else {
    const e = myEnr(u, st.id); const sl = e && e.slotId ? slotById(st, e.slotId) : null;
    body = `<div class="card card-tint" style="background:var(--t-mint);padding:32px"><h2 class="h3" style="color:var(--ink)">${sl ? "예약이 확정되었어요" : "참여해 주셔서 감사합니다"}</h2>
      <p class="sub" style="margin-top:10px">${sl ? `${fmtDT(sl.at)}, ${esc(st.location)}에서 만나요. 하루 전에 문자로 다시 알려드립니다.` : `보상(${esc(rewardText(st))})은 ${esc(st.reward.timing)} 등록하신 휴대전화로 발송됩니다.`}</p>
      <div class="row" style="margin-top:20px"><button class="btn btn-dark" data-act="go" data-v="p-history">내 참여 기록 보기</button><button class="btn btn-secondary" style="background:var(--canvas)" data-act="go" data-v="p-home">홈으로</button></div></div>`;
  }
  return `<div class="page" style="max-width:820px">
    <div class="crumb"><button data-act="pOpen" data-id="${st.id}">${esc(st.title)}</button><span>/</span><span class="charcoal">참여하기</span></div>
    <div class="stepper">${steps.map((s, i) => `<span class="${i===f.i?"on":""} ${i<f.i?"done":""}">${i+1} ${FLOW_LABEL[s]}</span>`).join("")}</div>
    <h1 class="h3" style="margin-bottom:8px">${FLOW_LABEL[cur]}</h1>${body}
    ${cur !== "done" ? `<p id="flowErr" class="body-sm" style="color:var(--err);margin-top:12px" role="alert"></p>
    <div class="wiz-foot"><button class="btn btn-secondary" data-act="flowExit">${cur === "consent" ? "동의하지 않고 나가기" : "나중에 하기"}</button><button class="btn btn-primary" data-act="flowNext">${cur === "consent" ? "동의하고 서명하기" : steps[f.i+1] === "done" ? "제출하기" : "다음"}</button></div>` : ""}
  </div>`;
}
const hasAns = a => Array.isArray(a) ? a.length > 0 : a !== undefined && a !== null && String(a).trim() !== "";
function ansInput(qq, a){
  const n = "ans-" + qq.id;
  if (qq.type === "likert") return `<div class="likert">${LIKERT.map((l, j) => `<label><input type="radio" name="${n}" id="${n}-${j}" data-ans="${qq.id}" value="${j+1}" ${Number(a)===j+1?"checked":""}><b>${j+1}</b><span>${l}</span></label>`).join("")}</div>`;
  if (qq.type === "single") return `<div class="stack-sm">${qq.options.map((o, j) => `<label class="opt"><input type="radio" name="${n}" id="${n}-${j}" data-ans="${qq.id}" value="${esc(o)}" ${a===o?"checked":""}>${esc(o)}</label>`).join("")}</div>`;
  if (qq.type === "multi") return `<div class="stack-sm">${qq.options.map((o, j) => `<label class="opt"><input type="checkbox" id="${n}-${j}" data-ans="${qq.id}" data-multi value="${esc(o)}" ${(a||[]).includes(o)?"checked":""}>${esc(o)}</label>`).join("")}</div>`;
  if (qq.type === "short") return `<input class="input" id="${n}" data-ans="${qq.id}" value="${esc(a || "")}" aria-label="답변">`;
  return `<textarea class="input" id="${n}" data-ans="${qq.id}" rows="4" aria-label="답변">${esc(a || "")}</textarea>`;
}
function pHistory(u){
  const mine = S.enrollments.filter(e => e.userId === u.id).sort((a, b) => b.invitedAt - a.invitedAt);
  return `<div class="page"><div class="page-head"><h1 class="h2">내 참여 기록</h1></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>연구</th><th>상태</th><th>동의</th><th>완료</th><th>보상</th><th></th></tr></thead><tbody>
    ${mine.length ? mine.map(e => { const st = studyById(e.studyId); return `<tr><td><button class="btn-link" style="color:var(--ink);text-align:left" data-act="pOpen" data-id="${st.id}"><span class="row" style="flex-wrap:nowrap">${tintDot(st)}${esc(st.title)}</span></button></td><td>${tag(enrLabel(e))}</td>
      <td class="num steel">${e.consentAt ? fmtD(e.consentAt) : "-"}</td><td class="num steel">${e.completedAt ? fmtD(e.completedAt) : "-"}</td>
      <td class="body-sm">${e.status === "paid" ? `${won(st.reward.amount)} 지급` : e.status === "completed" ? "지급 대기" : "-"}</td>
      <td><div class="row" style="flex-wrap:nowrap">${e.consentAt ? `<button class="btn btn-ghost btn-sm" data-act="viewConsent" data-id="${e.id}">동의서 보기</button>` : ""}${["invited","consented"].includes(e.status) && st.status === "recruiting" ? `<button class="btn btn-secondary btn-sm" data-act="pApply" data-id="${st.id}">참여하기</button>` : ""}</div></td></tr>`; }).join("") : `<tr><td colspan="6" class="steel" style="text-align:center;padding:28px">아직 참여한 연구가 없어요.</td></tr>`}
    </tbody></table></div></div>`;
}
function pInbox(u){
  const ms = S.messages.filter(m => m.toUserId === u.id).sort((a, b) => b.at - a.at);
  return `<div class="page" style="max-width:880px"><div class="page-head"><div><h1 class="h2">알림함</h1><p class="slate" style="margin-top:4px">플랫폼이 보낸 이메일과 문자가 모두 여기에 남습니다.</p></div>${ms.some(m => !m.read) ? `<button class="btn btn-secondary btn-sm" data-act="readAll">모두 읽음으로</button>` : ""}</div>
    ${ms.length ? ms.map(m => `<div class="msg ${m.read ? "" : "unread"}"><button class="mh" data-act="readMsg" data-id="${m.id}" aria-expanded="${ui.openMsg===m.id}">
      <span class="tag ${m.channel === "email" ? "tag-sky" : "tag-green"}">${m.channel === "email" ? "이메일" : "문자"}</span>
      <span style="min-width:0"><span class="t body-sm" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.read ? "" : '<span class="udot"></span>'}${esc(m.subject || m.body)}</span><span class="caption steel">${esc(studyById(m.studyId)?.title || "")}</span></span>
      <span class="caption steel when num">${fmtDT(m.at)}</span></button>
      ${ui.openMsg === m.id ? `<div class="mb">${esc(m.body)}${m.studyId && studyById(m.studyId).status === "recruiting" && ["invite","newstudy"].includes(m.kind) ? `<div style="margin-top:12px"><button class="btn btn-primary btn-sm" data-act="pOpen" data-id="${m.studyId}">연구 보러 가기</button></div>` : ""}</div>` : ""}</div>`).join("") : `<div class="empty">받은 알림이 없어요.</div>`}</div>`;
}
function pProfile(u){
  const p = u.profile;
  const chips = (path, opts) => `<div class="chips">${opts.map((o, i) => `<label class="chip"><input type="checkbox" id="pp-${path}-${i}" data-uarr="profile.${path}" value="${esc(o)}" ${p[path].includes(o)?"checked":""}>${esc(o)}</label>`).join("")}</div>`;
  const views = S.audit.slice(0, 5);
  return `<div class="page" style="max-width:880px"><div class="page-head"><h1 class="h2">내 정보·대기풀</h1></div><div class="stack">
    <div class="card stack"><div class="between"><h2 class="h5">대기풀 안내</h2><span class="tag ${poolActive(u) ? "tag-purple" : "tag-gray"}">${u.pool.joined ? (poolActive(u) ? "안내 받는 중" : "일시정지") : "미등록"}</span></div>
      <label class="check"><input type="checkbox" id="pp-join" data-ub="pool.joined" ${u.pool.joined?"checked":""}><span>참여자 대기풀에 등록하고 조건에 맞는 연구 안내를 받습니다.</span></label>
      <label class="check"><input type="checkbox" id="pp-pause" data-ub="pool.paused" ${u.pool.paused?"checked":""} ${u.pool.joined ? "" : "disabled"}><span>안내 일시정지 (시험 기간 등)</span></label>
      <div class="field"><span class="label">안내 받을 방법</span><label class="check"><input type="checkbox" checked disabled>이메일 ${esc(u.email)} (필수)</label><label class="check"><input type="checkbox" id="pp-sms" data-ub="contact.sms" ${u.contact.sms?"checked":""}>문자 ${esc(u.phone)}</label></div></div>
    <div class="card stack"><h2 class="h5">매칭에 쓰는 정보</h2><p class="body-sm slate">연구자는 이 정보를 개별로 볼 수 없고, 조건에 맞는 인원 수만 확인합니다.</p>
      <div class="three"><div><p class="caption steel">출생연도</p><p>${p.birthYear}년 (만 ${ageOf(u)}세)</p></div><div><p class="caption steel">성별</p><p>${p.gender}</p></div><div><p class="caption steel">신분 · 학과</p><p>${p.status} · ${esc(p.dept)}</p></div></div>
      <div class="field"><span class="label">관심 분야</span>${chips("interests", INTERESTS)}</div>
      <div class="field"><span class="label">참여 가능한 시간</span>${chips("times", TIMES)}</div></div>
    <div class="card stack"><h2 class="h5">내 정보 처리 기록</h2>${views.length ? views.map(a => `<div class="todo"><span class="caption steel num" style="min-width:90px">${fmtDT(a.at)}</span><span class="body-sm">${esc(a.actor)} · ${esc(a.action)}</span></div>`).join("") : `<p class="body-sm steel">연구자는 가명 ID로만 참여 현황을 확인합니다. 보상 지급이나 철회 처리가 생기면 여기에 남습니다.</p>`}</div>
    <div class="card stack" style="border-color:#f0c4c4"><h2 class="h5">회원 탈퇴</h2><p class="body-sm slate">탈퇴하면 대기풀에서 바로 빠지고 이름과 연락처가 삭제됩니다. 이미 마친 연구의 가명 응답과 동의서는 법령에 따른 보관 기간 동안 남습니다.</p><button class="btn btn-danger" style="align-self:flex-start" data-act="deleteAccount">회원 탈퇴</button></div>
  </div></div>`;
}

/* ========== 관리자 ========== */
function aHome(u){
  const t = ui.adminTab, rq = S.rewardQueue || [];
  const rev = S.studies.filter(s => s.status === "review"), pend = S.users.filter(x => x.role === "researcher");
  const tabs = [["review","심사 대기",rev.length],["researchers","연구자 확인",pend.filter(x => !x.verified).length],["rewards","보상 발송",rq.filter(r => !r.sentAt).length],["studies","전체 연구"],["audit","처리 기록"]];
  let body = "";
  if (t === "review") body = rev.length ? `<div class="list">${rev.map(s => { const o = userById(s.ownerId); return `<div class="srow" style="cursor:default"><div><h3>${tintDot(s)}${esc(s.title)}</h3><div class="meta"><span>${esc(o.name)} · ${esc(o.program)} ${o.verified ? '<span class="tag tag-green">연구자 확인됨</span>' : '<span class="tag tag-orange">연구자 미확인</span>'}</span><span>${typeTag(s)}</span><span class="mono">${esc(s.irbNo)}</span><span>제출 ${fmtDT(s.submittedAt)}</span></div></div><div style="text-align:right"><button class="btn btn-primary btn-sm" data-act="aReview" data-id="${s.id}">검토하기</button></div></div>`; }).join("")}</div>` : `<div class="empty">심사를 기다리는 연구가 없어요.</div>`;
  else if (t === "researchers") body = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>이름</th><th>과정 · 소속</th><th>지도교수</th><th>윤리교육 이수일</th><th>이수증</th><th>상태</th><th></th></tr></thead><tbody>
    ${pend.sort((a, b) => a.verified - b.verified).map(x => `<tr><td><b>${esc(x.name)}</b><div class="caption steel">${esc(x.email)}</div></td><td class="body-sm">${esc(x.program)}<div class="caption steel">${esc(x.dept)}</div></td><td>${esc(x.advisor)}</td><td class="num">${x.ethicsDate ? fmtD(endTs(x.ethicsDate)) : "-"}</td><td class="caption">${x.ethicsFileId ? `<button class="btn-link" data-act="dlFile" data-id="${esc(x.ethicsFileId)}">${esc(x.ethicsFile)}</button>` : esc(x.ethicsFile || "-")}</td>
    <td>${x.verified ? '<span class="tag tag-green">확인됨</span>' : '<span class="tag tag-orange">확인 대기</span>'}</td><td>${x.verified ? "" : `<button class="btn btn-primary btn-sm" data-act="verify" data-id="${x.id}">재학·이수 확인</button>`}</td></tr>`).join("")}</tbody></table></div>`;
  else if (t === "rewards") body = `<div class="callout info" style="margin-bottom:16px">${icon("lock",18)}<span>연구자가 지급 처리한 모바일 상품권입니다. 연구자는 참여자의 번호를 볼 수 없으므로 연구지원팀이 상품권을 보낸 뒤 '발송 완료'를 눌러 주세요. 발송 완료 후에는 번호가 다시 가려지고, 참여자에게 발송 안내 문자가 나갑니다.</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>가명 ID</th><th>연구</th><th>수신 번호</th><th class="num">금액</th><th>지급 처리</th><th>상태</th><th></th></tr></thead><tbody>
    ${rq.length ? rq.map(r => `<tr><td class="mono">${esc(r.pid)}</td><td class="body-sm">${esc(r.study)}</td><td class="mono">${esc(r.phone)}</td><td class="num">${won(r.amount)}</td><td class="num steel">${fmtDT(r.paidAt)}</td><td>${r.sentAt ? `<span class="tag tag-green">발송 완료 ${fmtMD(r.sentAt)}</span>` : `<span class="tag tag-orange">발송 대기</span>`}</td><td>${r.sentAt ? "" : `<button class="btn btn-primary btn-sm" data-act="rewardSent" data-id="${r.id}">발송 완료</button>`}</td></tr>`).join("") : `<tr><td colspan="7" class="steel" style="text-align:center;padding:28px">발송할 상품권이 없어요.</td></tr>`}</tbody></table></div>`;
  else if (t === "studies") body = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>연구</th><th>연구자</th><th>상태</th><th>IRB</th><th class="num">완료/목표</th><th>마감</th></tr></thead><tbody>
    ${S.studies.map(s => { const c = {done:doneOf(s)}; return `<tr><td><span class="row" style="flex-wrap:nowrap">${tintDot(s)}${esc(s.title || "제목 없음")}</span></td><td>${esc(userById(s.ownerId).name)}</td><td>${stTag(s)}</td><td class="mono">${esc(s.irbNo || "-")}</td><td class="num">${c.done}/${s.target}</td><td class="num steel">${fmtD(endTs(s.end))}</td></tr>`; }).join("")}</tbody></table></div>`;
  else body = `${S.inquiries.length ? `<div class="card stack-sm" style="margin-bottom:16px"><h2 class="h5">연구자가 신고한 문의 ${S.inquiries.length}건</h2>${S.inquiries.map(q => `<div class="todo"><span class="caption steel num" style="min-width:90px">${fmtDT(q.at)}</span><span class="body-sm"><b class="mono">${esc(q.pid)}</b> · ${esc((studyById(q.studyId) || {}).title || "")}<br>${esc(q.body)}</span></div>`).join("")}</div>` : ""}<div class="tbl-wrap"><table class="tbl"><thead><tr><th>일시</th><th>사용자</th><th>역할</th><th>내용</th></tr></thead><tbody>${S.audit.slice(0, 80).map(a => `<tr><td class="num steel">${fmtDT(a.at)}</td><td>${esc(a.actor)}</td><td class="steel">${esc(a.role)}</td><td class="body-sm">${esc(a.action)}</td></tr>`).join("")}</tbody></table></div>`;
  return `<div class="page"><div class="page-head"><div><p class="eyebrow">한신대학교 일반대학원</p><h1 class="h2">연구윤리지원팀</h1></div></div>
    <nav class="seg" style="margin-bottom:24px">${tabs.map(([k, l, n]) => `<button class="${t===k?"on":""}" data-act="aTab" data-v="${k}">${l}${n ? ` <span class="num steel">${n}</span>` : ""}</button>`).join("")}</nav>${body}</div>`;
}
const REVIEW_CHECKS = ["IRB 승인번호·만료일이 승인 통지서와 일치", "연구설명문 필수 항목과 동의서가 승인본과 일치", "보상 금액과 지급 방식이 적정함", "취약 대상 포함 시 추가 보호 조치를 확인함"];
function aReview(u){
  const st = studyById(ui.p.id); if (!st) return "";
  const o = userById(st.ownerId);
  const allChecked = REVIEW_CHECKS.every((_, i) => ui.form["rc" + i]);
  return `<div class="s-hero" style="background:${tintBg(st)}"><div class="page" style="padding-bottom:28px">
    <div class="crumb"><button data-act="aTab" data-v="review">심사 대기</button><span>/</span><span class="charcoal">${esc(st.title)}</span></div>
    <div class="row" style="margin-bottom:10px">${stTag(st)}${typeTag(st)}<span class="tag tag-gray mono" style="background:var(--canvas)">${esc(st.irbNo)}</span></div>
    <h1 class="h3" style="color:var(--ink)">${esc(st.title)}</h1>
    <p class="body-sm slate" style="margin-top:6px">${esc(o.name)} · ${esc(o.program)} · ${esc(o.dept)} · 지도교수 ${esc(st.advisor)} · 제출 ${fmtDT(st.submittedAt)}</p></div></div>
  <div class="page"><div class="grid-main"><div>${studyInfoHtml(st)}</div>
    <aside class="stack" style="position:sticky;top:20px">
      <div class="card stack"><h2 class="h5">확인 항목</h2>${REVIEW_CHECKS.map((c, i) => `<label class="check"><input type="checkbox" id="rc${i}" data-f="rc${i}" data-rr ${ui.form["rc" + i]?"checked":""}><span>${c}</span></label>`).join("")}
        <div class="livecount" style="padding:14px 16px"><p class="caption">조건에 맞는 대기풀</p><div class="num" style="font-size:24px;font-weight:600;color:var(--ink)">${st._poolMatch ?? 0}명</div></div>
        <label class="check"><input type="checkbox" id="rbc" data-f="rbc" ${ui.form.rbc !== false ? "checked" : ""}><span>승인과 함께 조건에 맞는 대기풀에 새 연구 안내 보내기</span></label>
        <button class="btn btn-primary" data-act="approve" data-id="${st.id}" ${allChecked ? "" : "disabled"}>승인하고 공개</button>
        ${allChecked ? "" : `<p class="caption steel">확인 항목 4개를 모두 체크하면 승인할 수 있어요.</p>`}</div>
      <div class="card stack"><h2 class="h5">보완 요청</h2>${fld("연구자에게 보낼 의견","f-rj",`<textarea class="input" id="f-rj" data-f="rj" rows="4" placeholder="예: 연구설명문의 녹음 파일 보관 기간이 승인본과 다릅니다.">${fv("rj")}</textarea>`)}
        <button class="btn btn-secondary" data-act="reject" data-id="${st.id}">보완 요청 보내기</button></div>
    </aside></div></div>`;
}

/* ========== 렌더 ========== */
function vVerify(u){
  return `<div class="auth-wrap"><div class="auth-card card stack">
    <div class="auth-brand"><img src="${LOGO_HORIZ}" alt="한신대학교"></div>
    <div><h1 class="h3">이메일 인증을 마쳐 주세요</h1><p class="slate" style="margin-top:8px"><b>${esc(u.email)}</b>로 인증 메일을 보냈어요. 메일의 링크를 누른 뒤 아래 버튼을 눌러 주세요.</p></div>
    ${S.demo ? `<div class="callout info">${icon("info",18)}<span>에뮬레이터에서는 메일이 실제로 가지 않습니다. 에뮬레이터를 띄운 터미널에 인증 링크가 출력되니 그 주소를 열어 주세요.</span></div>` : ""}
    <button class="btn btn-primary w100" data-act="checkVerified">인증을 마쳤어요</button>
    <div class="between"><button class="btn-link" data-act="resendVerify">인증 메일 다시 받기</button><button class="btn-link" data-act="logout">로그아웃</button></div>
  </div></div>`;
}
function render(){
  const u = me();
  let html = "";
  if (!u) html = promo() + (ui.view === "auth" ? vAuth() : vLanding());
  else if (S.needVerify) html = promo() + vVerify(u);
  else {
    if (!ui.view.startsWith(u.role === "researcher" ? "r-" : u.role === "participant" ? "p-" : "a-")) ui.view = homeOf(u);
    html += shell(u);
  }
  $("#app").innerHTML = html + modalHtml();
  updateLive();
}
function updateLive(){
  document.querySelectorAll("[data-bytes]").forEach(el => {
    const src = document.getElementById(el.dataset.bytes); if (!src) return;
    let txt = src.value; if (el.dataset.fill && ui.draft) txt = fillTpl(txt, ui.draft, SAMPLE);
    const b = eucBytes(txt); el.textContent = `${b} byte · ${b <= 90 ? "SMS" : "LMS"}`; el.classList.toggle("over", b > 90);
  });
  liveCount();
  const cp = $("#composePreview"); if (cp && ui.view === "r-study"){ const st = studyById(ui.p.id); cp.textContent = (ui.form.ch !== "sms" && ui.form.subj ? `[제목] ${fillTpl(ui.form.subj, st, SAMPLE)}\n` : "") + fillTpl(ui.form.body || "", st, SAMPLE); }
  const fp = $("#flowProg"); if (fp && ui.flow){ const st = studyById(ui.flow.studyId); const req = st.survey.filter(q => q.required); fp.textContent = `필수 ${req.filter(q => hasAns(ui.flow.answers[q.id])).length}/${req.length}`; }
}

/* ========== 입력 처리 ========== */
function onInput(e){
  const t = e.target, d = t.dataset;
  const val = t.type === "checkbox" ? t.checked : t.type === "number" ? (t.value === "" ? "" : Number(t.value)) : t.value;
  if (d.bind !== undefined && ui.draft){ if (t.type === "radio" && !t.checked) return; setPath(ui.draft, d.bind, val); if (d.rerender !== undefined && e.type === "change") render(); }
  if (d.arr && ui.draft && e.type === "change"){ const arr = getPath(ui.draft, d.arr); const i = arr.indexOf(t.value); if (t.checked && i < 0) arr.push(t.value); if (!t.checked && i >= 0) arr.splice(i, 1); }
  if (d.q !== undefined && ui.draft){ const qq = ui.draft.survey[+d.q]; const f = d.qf;
    if (f === "options") qq.options = t.value.split("\n").map(s => s.trim()).filter(Boolean);
    else if (f === "required") qq.required = t.checked;
    else qq[f] = t.value;
    if (f === "type" && e.type === "change"){ if (["single","multi"].includes(qq.type) && !qq.options.length) qq.options = ["선택지 1","선택지 2"]; if (!["single","multi"].includes(qq.type)) qq.options = []; render(); } }
  if (d.ci !== undefined && ui.draft) ui.draft.consent[+d.ci] = t.value;
  if (d.slot !== undefined && ui.draft){ const s = ui.draft.slots[+d.slot]; if (d.sf === "cap") s.cap = Math.max(1, Number(t.value) || 1); else if (t.value) s.at = new Date(t.value).getTime(); }
  if (d.f !== undefined){ if (t.type === "radio" && !t.checked) return; ui.form[d.f] = val; if (d.rr !== undefined && e.type === "change") render(); }
  if (d.farr && e.type === "change"){ const arr = ui.form[d.farr] = ui.form[d.farr] || []; const i = arr.indexOf(t.value); if (t.checked && i < 0) arr.push(t.value); if (!t.checked && i >= 0) arr.splice(i, 1); }
  if (d.ffile && e.type === "change"){ readFile(t.files[0]).then(f => { ui.form[d.ffile] = f ? f.name : ""; ui.form[d.ffile + "Data"] = f ? f.data : ""; render(); }); }
  if (d.dfile && e.type === "change" && ui.draft){ readFile(t.files[0]).then(async f => { if (!f) return; const j = await call("uploadIrb", {file:f}); if (!j) return; ui.draft.irbFile = j.file.name; ui.draft.irbFileId = j.file.id; render(); toast("승인 통지서를 올렸어요."); }); }
  if (d.sb && e.type === "change"){ call("setReminder", {id:d.sid, key:d.sb.split(".")[1], value:t.checked}).then(j => { if (j) toast(j.toast); }); }
  if (d.sel && e.type === "change"){ if (t.checked) ui.sel.add(d.sel); else ui.sel.delete(d.sel); render(); }
  if ((d.ub || d.uarr) && e.type === "change"){
    if (d.ub) call("setPref", {key:d.ub, value:t.checked}).then(done);
    else { const arr = getPath(me(), d.uarr).slice(); const i = arr.indexOf(t.value); if (t.checked && i < 0) arr.push(t.value); if (!t.checked && i >= 0) arr.splice(i, 1); call("setProfileList", {path:d.uarr.split(".")[1], values:arr}).then(done); }
  }
  if (ui.flow){
    if (d.fl){ if (t.type === "radio" && !t.checked) return; ui.flow[d.fl] = val; }
    if (d.fc !== undefined) ui.flow.checks[+d.fc] = t.checked;
    if (d.ans){ if (d.multi !== undefined){ const arr = ui.flow.answers[d.ans] = ui.flow.answers[d.ans] || []; const i = arr.indexOf(t.value); if (t.checked && i < 0) arr.push(t.value); if (!t.checked && i >= 0) arr.splice(i, 1); }
      else if (t.type !== "radio" || t.checked) ui.flow.answers[d.ans] = t.type === "radio" && /^\d$/.test(t.value) && studyById(ui.flow.studyId).survey.find(q => q.id === d.ans).type === "likert" ? Number(t.value) : t.value; }
  }
  updateLive();
}
document.addEventListener("input", onInput);
document.addEventListener("change", onInput);
document.addEventListener("submit", e => { e.preventDefault(); const f = e.target.dataset.form; if (FORMS[f]) FORMS[f](); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && ui.modal) closeModal(); });
document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]"); if (!el) return;
  if (el.dataset.act === "modalBg" && e.target !== el) return;
  const fn = ACT[el.dataset.act]; if (fn){ if (el.tagName !== "INPUT") e.preventDefault(); fn(el, e); }
});
function go(view, p = {}){
  ui.view = view; ui.p = p; ui.modal = null; render(); window.scrollTo(0, 0);
  // 화면을 옮길 때 서버의 최신 데이터를 받아 온다. 입력 중인 화면은 건드리지 않는다.
  if (S.session && !["r-wizard","p-flow"].includes(view)) refresh().then(() => { const a = document.activeElement; if (ui.view === view && !ui.modal && !(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) render(); });
}
async function copyText(text, label){
  try { await navigator.clipboard.writeText(text); toast(`${label}를 클립보드에 복사했어요. 엑셀에 붙여넣으세요.`); }
  catch(err){ openModal({title:label, body:`<p class="body-sm slate">자동 복사가 막혀 있어요. 아래 내용을 전체 선택해 복사하세요.</p><textarea class="input mono" rows="10" readonly>${esc(text)}</textarea>`, actions:[{label:"닫기", act:"modalClose"}]}); }
}

/* ========== 폼 ========== */
function enter(){ const u = me(); if (!u) return; $("#toast").classList.add("hide"); ui.form = {}; ui.filter = "all"; ui.tab = "overview"; go(homeOf(u)); }
const FORMS = {
  async login(){
    const j = await call("login", {email:ui.form.lemail, pw:ui.form.lpw});
    if (j) enter();
  },
  async signup(){
    const f = ui.form, isP = ui.signRole === "participant";
    const j = await call("signup", {role:ui.signRole, name:f.name, phone:f.phone, email:f.email, code:f.code, pw:f.pw, a1:!!f.a1, a2:!!f.a2, a3:f.a3 !== false,
      by:f.by, gender:f.gender, status:f.status, dept:f.dept, year:f.year, interests:f.interests || [], times:f.times || [], sms:f.sms !== false,
      prog:f.prog, rdept:f.rdept, adv:f.adv, eth:f.eth, ethFile:!isP && f.ethFileData ? {name:f.ethFile, data:f.ethFileData} : null});
    if (!j){ const el = $("#formErr"); if (el) el.textContent = call.lastError; return; }
    enter(); if (j.toast) toast(j.toast);
  }
};

/* ========== 동작 ========== */
// 화면 안에서만 끝나는 동작(탭 이동, 초안 편집)은 그대로 처리하고,
// 데이터를 바꾸는 동작은 모두 서버에 요청한 뒤 서버가 돌려준 최신 데이터로 다시 그린다.
const ACT = {
  go: el => { if (el.dataset.v === "landing" && me()) return go(homeOf(me())); go(el.dataset.v); },
  scrollTo: el => { const id = el.dataset.v, beh = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"; const t = document.getElementById(id); if (t) return t.scrollIntoView({behavior:beh}); go("landing"); setTimeout(() => { const x = document.getElementById(id); if (x) x.scrollIntoView(); }, 0); },
  toAuth: el => { ui.authMode = el.dataset.v; if (el.dataset.role) ui.signRole = el.dataset.role; ui.form = {}; go("auth"); },
  authMode: el => { ui.authMode = el.dataset.v; render(); },
  signRole: el => { ui.signRole = el.dataset.v; render(); },
  checkVerified: async () => { const j = await call("checkVerified"); if (!j) return; enter(); toast(j.toast); },
  resendVerify: async () => { const j = await run("resendVerify"); toast(j.error || j.toast); },
  dlFile: el => HS.downloadFile(el.dataset.id).catch(e => toast(HS.errorText(e))),
  demoLogin: async el => { const j = await call("demoLogin", {who:el.dataset.id}); if (j) enter(); },
  logout: async () => { await call("logout"); $("#toast").classList.add("hide"); ui.form = {}; ui.draft = null; ui.flow = null; go("landing"); },
  forgot: () => { ui.form.femail = ui.form.lemail || "";
    openModal({title:"비밀번호 재설정", body:`<p class="body-sm slate">가입한 이메일로 비밀번호를 다시 정할 수 있는 링크를 보내 드려요.</p>
      ${fld("이메일","fg-email",`<input class="input" id="fg-email" data-f="femail" type="email" autocomplete="username" value="${fv("femail")}">`)}`,
      actions:[{label:"취소", act:"modalClose"}, {label:"재설정 메일 받기", act:"forgotConfirm", cls:"btn-primary"}]}); },
  forgotConfirm: async () => { const j = await run("forgot", {email:ui.form.femail}); if (j.error) return toast(j.error); ui.modal = null; render(); toast(j.toast); },
  modalClose: closeModal, modalBg: closeModal,

  newStudy: () => { ui.draft = blankStudy(me()); ui.step = 0; ui.form.pledge = false; go("r-wizard"); },
  editStudy: el => { ui.draft = clone(studyById(el.dataset.id)); ui.step = 0; ui.form.pledge = false; go("r-wizard"); },
  openStudy: el => { ui.tab = el.dataset.tab || "overview"; ui.filter = "all"; ui.sel = new Set(); go("r-study", {id:el.dataset.id}); },
  tab: el => { ui.tab = el.dataset.v; ui.filter = "all"; render(); },
  filter: el => { ui.filter = el.dataset.v; render(); },
  wizStep: el => { ui.step = +el.dataset.v; render(); window.scrollTo(0, 0); },
  wizPrev: () => { ui.step = Math.max(0, ui.step - 1); render(); window.scrollTo(0, 0); },
  wizNext: () => { ui.step = Math.min(6, ui.step + 1); render(); window.scrollTo(0, 0); },
  wizSave: async () => { const j = await call("saveDraft", {draft:ui.draft}); if (!j) return; ui.draft.id = j.id; render(); toast(j.toast); },
  wizSubmit: async () => {
    const d = ui.draft, ch = checks(d), miss = ch.filter(c => !c[1]).map(c => c[0]);
    if (miss.length) return toast(`채워야 할 항목: ${miss.join(", ")}`);
    if (!ui.form.pledge) return toast("IRB 승인 내용과 같은지 확인란에 체크해 주세요.");
    const j = await call("submitStudy", {draft:d, pledge:true}); if (!j) return;
    ui.draft = null; ui.tab = "info"; go("r-study", {id:j.id}); toast(j.toast);
  },
  addQ: el => { const t = el.dataset.v; ui.draft.survey.push({id:"q" + Date.now().toString(36), type:t, text:"", options:["single","multi"].includes(t) ? ["선택지 1","선택지 2"] : [], required:t !== "long"}); render(); const last = document.getElementById(`w-qx-${ui.draft.survey.length - 1}`); if (last) last.focus(); },
  delQ: el => { ui.draft.survey.splice(+el.dataset.v, 1); render(); },
  upQ: el => { const i = +el.dataset.v, a = ui.draft.survey; if (i > 0) [a[i-1], a[i]] = [a[i], a[i-1]]; render(); },
  downQ: el => { const i = +el.dataset.v, a = ui.draft.survey; if (i < a.length - 1) [a[i+1], a[i]] = [a[i], a[i+1]]; render(); },
  addCI: () => { ui.draft.consent.push(""); render(); const el = document.getElementById(`w-ci-${ui.draft.consent.length - 1}`); if (el) el.focus(); },
  delCI: el => { ui.draft.consent.splice(+el.dataset.v, 1); render(); },
  addSlot: () => { const last = ui.draft.slots[ui.draft.slots.length - 1]; const t = last ? last.at + DAY : (() => { const d = new Date(Date.now() + 7*DAY); d.setHours(14, 0, 0, 0); return d.getTime(); })(); ui.draft.slots.push({id:uid("slot"), at:t, cap:3, booked:0}); render(); },
  delSlot: el => { ui.draft.slots.splice(+el.dataset.v, 1); render(); },

  closeStudy: el => openModal({title:"모집을 마감할까요?", body:`<p class="slate">새 신청과 초대가 멈춥니다. 이미 동의한 참여자는 계속 참여할 수 있고, 보상 지급과 응답 데이터 확인은 그대로 할 수 있어요.</p>`, actions:[{label:"취소", act:"modalClose"}, {label:"모집 마감", act:"closeConfirm", cls:"btn-dark", data:`data-id="${el.dataset.id}"`}]}),
  closeConfirm: async el => { ui.modal = null; done(await call("closeStudy", {id:el.dataset.id})); },
  markDone: async el => done(await call("markDone", {id:el.dataset.id})),
  sendInvites: async el => {
    const n = Math.round(Number(ui.form.invN) || 0); if (n < 1) return toast("초대 인원을 1명 이상 입력해 주세요.");
    const j = await call("sendInvites", {id:el.dataset.id, n, ch:ui.form.invCh || "both"}); if (!j) return;
    ui.form.invN = null; done(j);
  },
  sendCompose: async el => {
    const f = ui.form; if (!String(f.body || "").trim()) return toast("내용을 입력해 주세요.");
    done(await call("sendCompose", {id:el.dataset.id, seg:f.seg, ch:f.ch, subj:f.subj, body:f.body}));
  },
  addNotice: async el => {
    const f = ui.form; if (!String(f.nt || "").trim() || !String(f.nb || "").trim()) return toast("제목과 내용을 입력해 주세요.");
    const j = await call("addNotice", {id:el.dataset.id, title:f.nt, body:f.nb, notify:f.nn !== false}); if (!j) return;
    f.nt = ""; f.nb = ""; done(j);
  },
  selAll: el => { const pend = enrOf(el.dataset.id).filter(e => e.status === "completed"); const all = pend.every(e => ui.sel.has(e.id)); pend.forEach(e => all ? ui.sel.delete(e.id) : ui.sel.add(e.id)); render(); },
  payPick: el => { const st = studyById(el.dataset.id); const ids = enrOf(st.id).filter(e => e.status === "completed" && ui.sel.has(e.id));
    openModal({title:`${ids.length}건을 지급 처리할까요?`, body:`<p class="slate">${esc(st.reward.type)} ${won(st.reward.amount)} × ${ids.length}건 = <b class="num">${won(st.reward.amount * ids.length)}</b><br>${st.reward.type === "모바일 상품권" ? "참여자에게 지급 접수 안내가 가고, 연구지원팀이 등록된 번호로 상품권을 보냅니다." : "참여자에게 지급 안내가 가고, 지급 완료 목록으로 옮겨집니다."}</p>`, actions:[{label:"취소", act:"modalClose"}, {label:"지급 처리", act:"payConfirm", cls:"btn-primary", data:`data-id="${st.id}"`}]}); },
  payConfirm: async el => { const ids = enrOf(el.dataset.id).filter(e => e.status === "completed" && ui.sel.has(e.id)).map(e => e.id);
    ui.modal = null; const j = await call("pay", {id:el.dataset.id, ids}); if (!j) return; ui.sel = new Set(); done(j); },
  copyLedger: el => { const st = studyById(el.dataset.id); const rows = enrOf(st.id).filter(e => DONE.includes(e.status)).sort((a, b) => a.completedAt - b.completedAt);
    const txt = ["번호\t가명ID\t참여완료일\t지급일\t지급방식\t금액", ...rows.map((e, i) => [i + 1, userById(e.userId).pid, fmtD(e.completedAt), e.paidAt ? fmtD(e.paidAt) : "미지급", st.reward.type, st.reward.amount].join("\t"))].join("\n");
    HS.act("logExport", {id:st.id, kind:"ledger"}).catch(() => {}); copyText(txt, "지급 대장"); },
  copyCSV: el => { const st = studyById(el.dataset.id); const rs = enrOf(st.id).filter(e => e.responses && e.status !== "withdrawn");
    const head = ["pid","completed_at", ...st.survey.map(q => q.id)];
    const cell = v => { const s = Array.isArray(v) ? v.join("|") : (v ?? ""); return /[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : s; };
    const txt = [head.join(","), ...rs.map(e => [userById(e.userId).pid, e.completedAt ? fmtD(e.completedAt) : "", ...st.survey.map(q => cell(e.responses[q.id]))].join(","))].join("\n");
    HS.act("logExport", {id:st.id, kind:"csv"}).catch(() => {}); copyText(txt, "응답 데이터"); },
  replyInq: async el => { const k = "rq_" + el.dataset.id; if (!String(ui.form[k] || "").trim()) return toast("답변 내용을 입력해 주세요.");
    const j = await call("replyInquiry", {id:el.dataset.id, body:ui.form[k]}); if (!j) return; ui.form[k] = ""; done(j); },
  reportInq: el => openModal({title:"이 문의를 신고할까요?", body:`<p class="slate">내용이 화면에서 가려지고 연구지원팀이 확인합니다. 연구와 무관한 사적 연락, 폭언, 개인 연락처 요구 등에 사용해 주세요.</p>`, actions:[{label:"취소", act:"modalClose"}, {label:"신고하기", act:"reportConfirm", cls:"btn-dark", data:`data-id="${el.dataset.id}"`}]}),
  reportConfirm: async el => { ui.modal = null; done(await call("reportInquiry", {id:el.dataset.id})); },

  pOpen: el => go("p-study", {id:el.dataset.id}),
  pFilter: el => { ui.pFilter = el.dataset.v; render(); },
  onlyFit: el => { ui.pOnlyFit = el.checked; render(); },
  pApply: async el => {
    const st = studyById(el.dataset.id); if (!st) return;
    let e = myEnr(me(), st.id);
    if (e && ["scheduled","completed","paid","withdrawn"].includes(e.status)) return go("p-study", {id:st.id});
    if (!e){ const j = await call("apply", {studyId:st.id}); if (!j) return; e = myEnr(me(), st.id); if (!e) return render(); }
    ui.flow = {studyId:st.id, i:e.status === "consented" ? 2 : 0, readOk:false, checks:st.consent.map(() => false), signature:"", copy:true, slotId:null, answers:e.responses ? clone(e.responses) : {}};
    go("p-flow");
  },
  flowExit: () => { const sid = ui.flow.studyId; ui.flow = null; go("p-study", {id:sid}); },
  flowNext: async () => {
    const u = me(), f = ui.flow, st = studyById(f.studyId), steps = flowSteps(st), cur = steps[f.i];
    const err = m => { const x = $("#flowErr"); if (x) x.textContent = m; };
    if (cur === "explain" && !f.readOk) return err("연구설명문을 끝까지 읽고 체크해 주세요.");
    if (cur === "consent"){
      if (!f.checks.every(Boolean)) return err("모든 동의 항목에 체크해야 참여할 수 있어요.");
      if (f.signature.trim() !== u.name) return err(`서명란에 가입할 때 등록한 이름(${u.name})을 입력해 주세요.`);
      if (!await call("consent", {studyId:st.id, checks:f.checks, signature:f.signature.trim(), copy:f.copy})) return err(call.lastError);
    }
    if (cur === "slot"){ const sl = slotById(st, f.slotId); if (!sl) return err("시간을 하나 골라 주세요."); if (sl.booked >= sl.cap) return err("방금 그 시간이 마감됐어요. 다른 시간을 골라 주세요."); }
    if (cur === "survey"){ const miss = st.survey.findIndex(q => q.required && !hasAns(f.answers[q.id])); if (miss >= 0){ err(`${miss + 1}번 문항에 답해 주세요.`); const x = document.getElementById(`ans-${st.survey[miss].id}-0`) || document.getElementById(`ans-${st.survey[miss].id}`); if (x) x.focus(); return; } }
    if (steps[f.i + 1] === "done"){
      if (!await call("finish", {studyId:st.id, slotId:f.slotId, answers:f.answers})) return err(call.lastError);
    }
    f.i++; render(); window.scrollTo(0, 0);
  },
  withdraw: el => openModal({title:"참여를 철회할까요?", body:`<p class="slate">철회해도 어떤 불이익도 없습니다. 같은 연구에는 다시 참여할 수 없어요.</p>
    <div class="stack-sm"><p class="label">이미 제출한 응답은 어떻게 할까요?</p>
    <label class="opt"><input type="radio" name="wd" id="wd-del" data-f="wd" value="destroy" ${ui.form.wd !== "keep" ? "checked" : ""}>폐기해 주세요</label>
    <label class="opt"><input type="radio" name="wd" id="wd-keep" data-f="wd" value="keep" ${ui.form.wd === "keep" ? "checked" : ""}>가명 처리된 상태로 연구에 써도 됩니다</label></div>`,
    actions:[{label:"취소", act:"modalClose"}, {label:"철회하기", act:"withdrawConfirm", cls:"btn-dark", data:`data-id="${el.dataset.id}"`}]}),
  withdrawConfirm: async el => { const choice = ui.form.wd === "keep" ? "keep" : "destroy"; ui.form.wd = null; ui.modal = null; ui.flow = null; done(await call("withdraw", {id:el.dataset.id, choice})); },
  viewConsent: el => { const e = S.enrollments.find(x => x.id === el.dataset.id), st = studyById(e.studyId); const items = e.consentDoc ? e.consentDoc.items : st.consent;
    openModal({title:"연구참여 동의서", body:`<p class="body-sm slate">${esc(st.title)} · IRB ${esc(st.irbNo)}</p><ol class="body-sm" style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px">${items.map(c => `<li>${esc(c)} <span class="tag tag-green">동의</span></li>`).join("")}</ol><p class="body-sm">서명 ${esc(e.signature || me().name)} · ${fmtD(e.consentAt)}</p>`, actions:[{label:"닫기", act:"modalClose"}]}); },
  askOpen: el => { ui.form.askBody = ""; openModal({title:"연구자에게 문의하기", body:`<p class="body-sm slate">연구자에게는 가명 ID로만 전달됩니다. 답변은 알림함과 이메일로 알려드려요. 전화번호 같은 개인 연락처는 적지 말아 주세요.</p>
    ${fld("문의 내용","ask-body",`<textarea class="input" id="ask-body" data-f="askBody" rows="5" maxlength="1000" placeholder="예: 예약한 시간을 바꿀 수 있을까요?"></textarea>`)}`,
    actions:[{label:"취소", act:"modalClose"}, {label:"문의 보내기", act:"askSend", cls:"btn-primary", data:`data-id="${el.dataset.id}"`}]}); },
  askSend: async el => { const j = await run("ask", {studyId:el.dataset.id, body:ui.form.askBody}); if (j.error) return toast(j.error); ui.form.askBody = ""; ui.modal = null; render(); toast(j.toast); },
  togglePause: async () => done(await call("togglePause")),
  readMsg: el => { const m = S.messages.find(x => x.id === el.dataset.id); if (!m) return; ui.openMsg = ui.openMsg === m.id ? null : m.id; const was = m.read; m.read = true; render(); if (!was) HS.act("readMsg", {id:m.id}).catch(() => {}); },
  readAll: async () => done(await call("readAll")),
  deleteAccount: () => openModal({title:"정말 탈퇴할까요?", body:`<p class="slate">대기풀에서 빠지고 이름·연락처가 삭제됩니다. 진행 중인 참여는 철회 처리되며, 그 응답은 폐기됩니다. 이미 마친 연구의 가명 응답과 동의서는 법령에 따른 보관 기간 동안 남습니다.</p>`, actions:[{label:"취소", act:"modalClose"}, {label:"탈퇴하기", act:"deleteConfirm", cls:"btn-dark"}]}),
  deleteConfirm: async () => { ui.modal = null; const j = await call("deleteAccount"); if (!j) return; ui.form = {}; ui.flow = null; go("landing"); toast(j.toast); },

  aTab: el => { ui.adminTab = el.dataset.v; go("a-home"); },
  aReview: el => { REVIEW_CHECKS.forEach((_, i) => ui.form["rc" + i] = false); ui.form.rj = ""; ui.form.rbc = true; go("a-review", {id:el.dataset.id}); },
  verify: async el => done(await call("verify", {id:el.dataset.id})),
  approve: async el => { const j = await call("approve", {id:el.dataset.id, notify:ui.form.rbc !== false}); if (!j) return; ui.adminTab = "review"; go("a-home"); toast(j.toast); },
  reject: async el => { const c = String(ui.form.rj || "").trim(); if (!c) return toast("연구자에게 보낼 의견을 적어 주세요.");
    const j = await call("reject", {id:el.dataset.id, comment:c}); if (!j) return; ui.adminTab = "review"; go("a-home"); toast(j.toast); },
  rewardSent: async el => done(await call("rewardSent", {ids:[el.dataset.id]}))
};

/* ========== 시작 ========== */
// 에뮬레이터에서만: 자동 점검 스크립트가 화면 데이터와 Firestore 접근을 직접 시험할 수 있게 한다.
if (HS.demo) window.__hs = {state:() => S, act:(n, p) => HS.act(n, p).then(x => ({ok:true, ...x}), e => ({error:HS.errorText(e)})), fs:HS.raw};

(async function start(){
  await HS.ready;
  await refresh();
  if (S.session && me()) ui.view = homeOf(me());
  render();
})();
