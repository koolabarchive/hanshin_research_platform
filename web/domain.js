// 화면(public/app.js)과 같은 규칙을 서버에서 다시 확인하기 위한 순수 함수 모음.
// 화면에서 한 검사는 편의일 뿐이고, 실제 판단은 항상 여기서 한다.

const DAY = 864e5;
const CAMPUS_STATUSES = ['학부생', '대학원생', '교직원'];
const EXTERNAL_STATUS = '학외 일반인';
const STATUSES = [...CAMPUS_STATUSES, EXTERNAL_STATUS];
const GENDERS = ['여성', '남성'];
const DEPTS_UG = ['심리아동학부', '사회복지학과', '재활상담학과', '경영학과', '미디어영상광고홍보학부', '컴퓨터공학부', 'AI·SW융합학부', '신학과', '한국사학과', '국제경제학과', '응용통계학과', '유아교육과'];
const DEPTS = [...DEPTS_UG, '일반대학원'];
const INTERESTS = ['심리·정서', '학습·교육', '건강·운동', '미디어·SNS', 'AI·기술', '사회·복지', '조직·경영'];
const TIMES = ['평일 오전', '평일 오후', '평일 저녁', '주말'];
const TYPES = { survey: '온라인 설문', lab: '대면 실험', interview: '면담', program: '상담·프로그램', longitudinal: '종단 연구' };
const ONSITE = ['lab', 'interview', 'program']; // 장소와 예약 시간이 필요한 유형
const TINTS = ['sky', 'mint', 'peach', 'lav', 'rose', 'yellow', 'cream'];
const REWARD_TYPES = ['모바일 상품권', '현금', '없음'];
const REWARD_TIMINGS = ['참여 완료 후 3일 이내', '매주 금요일 일괄', '실험 참여 당일 지급', '면담 종료 후 3일 이내', '모집 종료 후 일괄'];
const QTYPES = ['likert', 'single', 'multi', 'short', 'long'];
const EXPL = ['purpose', 'procedure', 'risks', 'benefits', 'privacy', 'withdraw', 'contact'];
const PROGRAMS = ['석사과정', '박사과정', '석박사통합과정', '박사후연구원'];
const ACTIVE = ['consented', 'scheduled', 'completed', 'paid'];
const DONE = ['completed', 'paid'];
const AGE_BANDS = ['20대 초반', '20대 중반', '20대 후반', '30대', '40대 이상'];
const MIN_AGE = 19;
const LIKERT_MIN = 2;
const LIKERT_MAX = 10;
const WEEKLY_NOTICE_LIMIT = 3; // 한 사람에게 일주일 동안 보내는 모집 안내 상한
const MIN_COUNT = 5; // 임의 조건으로 조회한 인원이 이보다 적으면 정확한 숫자를 가린다.
const POOL_BREAKDOWN_MIN = 20; // 대기풀이 이보다 작으면 분포를 보여 주지 않는다.

const SEGMENTS = {
  pending: ['초대 후 미응답', (e) => e.status === 'invited'],
  consented: ['동의 후 미완료', (e) => e.status === 'consented'],
  scheduled: ['일정 확정자', (e) => e.status === 'scheduled'],
  done: ['참여 완료자', (e) => DONE.includes(e.status)],
  all: ['전체 참여자 (철회 제외)', (e) => e.status !== 'withdrawn'],
};
const CHANNEL_LABEL = { both: '이메일+문자', email: '이메일', sms: '문자' };

const pad = (n) => String(n).padStart(2, '0');
// 서버가 어느 시간대에서 돌든 날짜·시각 표기는 한국 시각 기준으로 한다.
const kst = (t) => new Date(t + 9 * 3600e3);
const toYMD = (t) => kst(t).toISOString().slice(0, 10);
const endTs = (ymd) => new Date(`${ymd}T23:59:59+09:00`).getTime();
const fmtD = (t) => toYMD(t).replace(/-/g, '.');
const fmtMD = (t) => `${kst(t).getUTCMonth() + 1}월 ${kst(t).getUTCDate()}일`;
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const fmtDT = (t) => {
  const d = kst(t);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WD[d.getUTCDay()]}) ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
const won = (n) => `${Number(n || 0).toLocaleString('ko-KR')}원`;
// 문자 요금 기준(EUC-KR): 한글 2byte, 영문·숫자 1byte. 90byte를 넘으면 LMS.
const eucBytes = (s) => {
  let b = 0;
  for (const ch of String(s)) b += ch.charCodeAt(0) > 127 ? 2 : 1;
  return b;
};

const ageOf = (profile, now = Date.now()) => kst(now).getUTCFullYear() - profile.birthYear;
const ageBand = (a) => (a < 23 ? '20대 초반' : a < 27 ? '20대 중반' : a < 30 ? '20대 후반' : a < 40 ? '30대' : '40대 이상');

function matches(study, profile, now = Date.now()) {
  if (!profile) return false;
  const c = study.criteria;
  const a = ageOf(profile, now);
  if (a < c.ageMin || a > c.ageMax) return false;
  if (c.statuses.length && !c.statuses.includes(profile.status)) return false;
  if (c.genders.length && !c.genders.includes(profile.gender)) return false;
  if (c.depts.length && !c.depts.includes(profile.dept)) return false;
  return true;
}

const rewardText = (st) => (st.reward.type === '없음' || !st.reward.amount ? '보상 없음' : `${st.reward.type} ${won(st.reward.amount)}`);

function fillTpl(tpl, st, pid) {
  const map = {
    참여자ID: pid || 'P-0000',
    연구명: st.title || '(연구명)',
    마감일: st.end ? fmtMD(endTs(st.end)) : '',
    소요시간: `약 ${st.minutes}분`,
    보상: rewardText(st),
  };
  return String(tpl || '').replace(/\{\{(.+?)\}\}/g, (m, k) => map[k.trim()] ?? m);
}

function defaultConsent() {
  return [
    '연구설명문을 읽고 연구의 목적, 절차, 예상되는 위험과 이익을 이해했습니다.',
    '궁금한 점을 연구자에게 질문할 수 있다는 것을 안내받았습니다.',
    '참여는 자발적이며 언제든 불이익 없이 철회할 수 있음을 이해합니다.',
    '수집된 자료가 가명 처리되어 연구 목적으로만 쓰이는 것에 동의합니다.',
    '본인은 만 19세 이상입니다.',
  ];
}

function defaultTemplates() {
  return {
    inviteSubject: '[한신 리서치풀] {{연구명}} 참여 안내',
    inviteBody:
      '안녕하세요, {{참여자ID}} 님.\n대기풀에 등록하신 조건에 맞는 연구가 있어 안내드립니다.\n\n· 연구명: {{연구명}}\n· 소요 시간: {{소요시간}}\n· 보상: {{보상}}\n· 모집 마감: {{마감일}}\n\n참여 여부는 자유롭게 정하시면 되고, 참여하지 않아도 불이익은 없습니다. 한신 리서치풀에 로그인하면 연구설명문을 확인할 수 있습니다.',
    sms: '[한신리서치풀] 새 연구 안내: {{소요시간}}, {{보상}}. {{마감일}} 마감. 앱에서 확인하세요.',
    remind3: true,
    remindEnd: true,
  };
}

// ── 연구 초안 정리 ──────────────────────────────────────────
// 화면에서 온 값은 그대로 믿지 않는다. 아는 필드만, 정해진 형식과 길이로 다시 만든다.
const text = (v, max) => String(v ?? '').replace(/\r/g, '').slice(0, max);
const line = (v, max) => text(v, max).replace(/\n/g, ' ').trim();
const intIn = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const ymdOr = (v, fallback) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : fallback);
const subset = (v, allowed) => (Array.isArray(v) ? [...new Set(v.filter((x) => allowed.includes(x)))] : []);

function sanitizeDraft(d, now = Date.now()) {
  const type = Object.keys(TYPES).includes(d.type) ? d.type : 'survey';
  const cr = d.criteria || {};
  const ageMin = intIn(cr.ageMin, MIN_AGE, 120, MIN_AGE);
  const rw = d.reward || {};
  const tp = d.templates || {};
  const ex = d.explanation || {};
  const survey = (Array.isArray(d.survey) ? d.survey : []).slice(0, 80).map((q, i) => {
    const qtype = QTYPES.includes(q.type) ? q.type : 'short';
    const options = ['single', 'multi'].includes(qtype)
      ? (Array.isArray(q.options) ? q.options : []).map((o) => line(o, 200)).filter(Boolean).slice(0, 30)
      : [];
    const out = { id: /^[a-z0-9]{1,20}$/i.test(String(q.id || '')) ? String(q.id) : `q${i + 1}${now.toString(36)}`, type: qtype, text: line(q.text, 500), options, required: !!q.required };
    // 리커트 척도: 몇 점 척도인지(2~10점)와 각 점수의 이름. 이름은 비워 둘 수 있다(양 끝만 적는 경우).
    if (qtype === 'likert') {
      out.points = intIn(q.points, LIKERT_MIN, LIKERT_MAX, 5);
      if (Array.isArray(q.labels)) out.labels = Array.from({ length: out.points }, (_, k) => line(q.labels[k], 40));
    }
    return out;
  });
  // 문항 ID가 겹치면 응답이 섞이므로 뒤쪽 것에 새 ID를 준다.
  const seen = new Set();
  survey.forEach((q, i) => {
    if (seen.has(q.id)) q.id = `q${i + 1}${now.toString(36)}`;
    seen.add(q.id);
  });
  const slots = (Array.isArray(d.slots) ? d.slots : [])
    .slice(0, 200)
    .map((s) => ({ id: /^slot-[\w-]{4,20}$/.test(String(s.id || '')) ? String(s.id) : null, at: Math.round(Number(s.at)) || 0, cap: intIn(s.cap, 1, 500, 1) }))
    .filter((s) => s.at > 0);
  return {
    title: line(d.title, 120),
    summary: line(d.summary, 200),
    type,
    minutes: intIn(d.minutes, 1, 1440, 20),
    target: intIn(d.target, 1, 100000, 60),
    start: ymdOr(d.start, toYMD(now)),
    end: ymdOr(d.end, toYMD(now + 30 * DAY)),
    location: ONSITE.includes(type) ? line(d.location, 200) : '',
    irbNo: line(d.irbNo, 60),
    irbUntil: ymdOr(d.irbUntil, toYMD(now + 365 * DAY)),
    advisor: line(d.advisor, 40),
    tint: TINTS.includes(d.tint) ? d.tint : 'sky',
    explanation: Object.fromEntries(EXPL.map((k) => [k, text(ex[k], 4000)])),
    consent: (Array.isArray(d.consent) ? d.consent : []).map((c) => line(c, 500)).slice(0, 20),
    consentCopy: d.consentCopy !== false,
    survey,
    slots: ONSITE.includes(type) ? slots : [],
    criteria: {
      ageMin,
      ageMax: intIn(cr.ageMax, ageMin, 120, 39),
      statuses: subset(cr.statuses, STATUSES),
      genders: subset(cr.genders, GENDERS),
      depts: subset(cr.depts, DEPTS),
      exclude: text(cr.exclude, 1000).trim(),
    },
    reward: {
      type: REWARD_TYPES.includes(rw.type) ? rw.type : '모바일 상품권',
      amount: rw.type === '없음' ? 0 : intIn(rw.amount, 0, 10000000, 0),
      timing: REWARD_TIMINGS.includes(rw.timing) ? rw.timing : REWARD_TIMINGS[0],
    },
    templates: {
      inviteSubject: line(tp.inviteSubject, 200),
      inviteBody: text(tp.inviteBody, 3000),
      sms: line(tp.sms, 300),
      remind3: !!tp.remind3,
      remindEnd: !!tp.remindEnd,
    },
  };
}

// 심사 제출 전에 채워야 하는 항목. [항목명, 충족 여부]
function checks(d, hasIrbFile) {
  return [
    ['제목과 한 줄 소개', !!(d.title && d.summary)],
    ['IRB 승인번호', !!d.irbNo],
    ['모집 기간 (시작 ≤ 마감 ≤ IRB 만료)', d.start <= d.end && d.end <= d.irbUntil],
    ['연구설명문 7개 항목', EXPL.every((k) => (d.explanation[k] || '').trim())],
    ['동의서 항목 1개 이상', d.consent.filter((c) => c.trim()).length > 0],
    [d.type === 'survey' ? '설문 문항 1개 이상' : '설문 문항 또는 예약 시간', d.survey.length > 0 || d.slots.length > 0],
    ...(ONSITE.includes(d.type) ? [['장소와 예약 가능한 시간', !!d.location && d.slots.length > 0]] : []),
    ['설문 문항 내용과 선택지', d.survey.every((q) => q.text && (!['single', 'multi'].includes(q.type) || q.options.length >= 2))],
    ['목표 인원과 소요 시간', d.target > 0 && d.minutes > 0],
    ['IRB 승인 통지서 첨부', !!hasIrbFile],
  ];
}

const hasAns = (a) => (Array.isArray(a) ? a.length > 0 : a !== undefined && a !== null && String(a).trim() !== '');

// 설문 응답을 문항 정의에 맞춰 다시 만든다. 정의에 없는 값은 버린다.
function cleanAnswers(survey, answers) {
  const out = {};
  for (const q of survey) {
    const a = (answers || {})[q.id];
    if (q.type === 'likert') {
      const n = Number(a);
      if (Number.isInteger(n) && n >= 1 && n <= (q.points || 5)) out[q.id] = n; // 예전 문항(점수 미지정)은 5점 척도
    } else if (q.type === 'single') {
      if (q.options.includes(a)) out[q.id] = a;
    } else if (q.type === 'multi') {
      const picked = subset(a, q.options);
      if (picked.length) out[q.id] = picked;
    } else if (hasAns(a)) {
      out[q.id] = text(a, q.type === 'short' ? 300 : 5000).trim();
    }
  }
  return out;
}

function counts(en) {
  const by = (s) => en.filter((e) => e.status === s).length;
  return {
    all: en.filter((e) => e.status !== 'withdrawn').length,
    invited: by('invited'),
    consented: by('consented'),
    scheduled: by('scheduled'),
    completed: by('completed'),
    paid: by('paid'),
    withdrawn: by('withdrawn'),
    active: en.filter((e) => ACTIVE.includes(e.status)).length,
    done: en.filter((e) => DONE.includes(e.status)).length,
  };
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffle = (arr, r = Math.random) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

module.exports = {
  DAY, CAMPUS_STATUSES, EXTERNAL_STATUS, STATUSES, GENDERS, DEPTS_UG, DEPTS, INTERESTS, TIMES, TYPES, ONSITE, TINTS,
  REWARD_TYPES, QTYPES, LIKERT_MIN, LIKERT_MAX, EXPL, PROGRAMS, ACTIVE, DONE, AGE_BANDS, MIN_AGE, WEEKLY_NOTICE_LIMIT, MIN_COUNT, POOL_BREAKDOWN_MIN,
  SEGMENTS, CHANNEL_LABEL,
  pad, toYMD, endTs, fmtD, fmtMD, fmtDT, won, eucBytes, ageOf, ageBand, matches, rewardText, fillTpl,
  defaultConsent, defaultTemplates, sanitizeDraft, checks, hasAns, cleanAnswers, counts, mulberry32, shuffle,
  text, line, subset,
};
