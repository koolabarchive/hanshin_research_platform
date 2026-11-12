const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../web/domain');

const NOW = new Date('2026-06-15T03:00:00Z').getTime();
const study = (criteria = {}) => ({ criteria: { ageMin: 19, ageMax: 39, statuses: [], genders: [], depts: [], exclude: '', ...criteria } });
const person = (o = {}) => ({ birthYear: 2002, gender: '여성', status: '학부생', dept: '심리아동학부', ...o });

test('매칭: 나이·신분·성별·학과 조건', () => {
  assert.equal(D.matches(study(), person(), NOW), true);
  assert.equal(D.matches(study({ ageMax: 23 }), person(), NOW), false); // 만 24세
  assert.equal(D.matches(study({ statuses: ['대학원생'] }), person(), NOW), false);
  assert.equal(D.matches(study({ genders: ['남성'] }), person(), NOW), false);
  assert.equal(D.matches(study({ depts: ['경영학과'] }), person(), NOW), false);
  assert.equal(D.matches(study(), null, NOW), false);
});

test('매칭: 학외 일반인은 연구가 대상에 넣었을 때만 맞는다', () => {
  const outsider = person({ status: D.EXTERNAL_STATUS, dept: '학외' });
  assert.equal(D.matches(study({ statuses: ['학부생'] }), outsider, NOW), false);
  assert.equal(D.matches(study({ statuses: ['학부생', D.EXTERNAL_STATUS] }), outsider, NOW), true);
});

test('문자 byte 수: 한글 2, 영문·숫자 1', () => {
  assert.equal(D.eucBytes('abc'), 3);
  assert.equal(D.eucBytes('한신'), 4);
  assert.equal(D.eucBytes('[한신] 20분'), 11);
});

test('안내 문구 변수 채우기', () => {
  const st = { title: '수면 연구', end: '2026-07-01', minutes: 20, reward: { type: '모바일 상품권', amount: 5000 } };
  assert.equal(D.fillTpl('{{참여자ID}} 님, {{연구명}} · {{소요시간}} · {{보상}} · {{마감일}}', st, 'P-1234'), 'P-1234 님, 수면 연구 · 약 20분 · 모바일 상품권 5,000원 · 7월 1일');
  assert.equal(D.fillTpl('{{모르는변수}}', st, 'P-1'), '{{모르는변수}}');
});

test('초안 정리: 모르는 필드는 버리고 값은 범위 안으로', () => {
  const d = D.sanitizeDraft({
    title: '  제목\n줄바꿈  ', type: 'hack', minutes: -5, target: 'abc', tint: 'neon', status: 'recruiting', ownerId: 'r-1',
    criteria: { ageMin: 10, ageMax: 5, statuses: ['학부생', '외계인'], genders: 'x', depts: ['경영학과'] },
    reward: { type: '없음', amount: 99999 },
    survey: [{ id: '<script>', type: 'single', text: '질문', options: ['a', '', 'b'] }, { id: 'q1', type: 'nope', text: 'x' }, { id: 'q1', type: 'likert', text: 'y' }],
    slots: [{ at: 'x', cap: 3 }, { at: NOW, cap: 0 }],
  }, NOW);
  assert.equal(d.title, '제목 줄바꿈');
  assert.equal(d.type, 'survey');
  assert.equal(d.minutes, 1);
  assert.equal(d.target, 60);
  assert.equal(d.tint, 'sky');
  assert.equal(d.status, undefined);
  assert.equal(d.ownerId, undefined);
  assert.deepEqual(d.criteria.statuses, ['학부생']);
  assert.equal(d.criteria.ageMin, 19); // 가입 연령 아래로는 내려가지 않는다.
  assert.ok(d.criteria.ageMax >= d.criteria.ageMin);
  assert.deepEqual(d.criteria.genders, []);
  assert.equal(d.reward.amount, 0);
  assert.deepEqual(d.survey[0].options, ['a', 'b']);
  assert.notEqual(d.survey[0].id, '<script>');
  assert.equal(d.survey[1].type, 'short');
  assert.notEqual(d.survey[1].id, d.survey[2].id); // 겹치는 문항 ID는 새로 준다.
  assert.deepEqual(d.slots, []); // 설문 연구에는 예약 시간이 없다.
});

test('제출 조건: 대면·상담 연구는 장소와 예약 시간이 필요', () => {
  const base = { title: 't', summary: 's', irbNo: 'x', start: '2026-06-01', end: '2026-07-01', irbUntil: '2026-12-31', explanation: Object.fromEntries(D.EXPL.map((k) => [k, 'x'])), consent: ['동의'], survey: [], slots: [], target: 10, minutes: 10 };
  const miss = (d, file = true) => D.checks(d, file).filter((c) => !c[1]).map((c) => c[0]);
  assert.deepEqual(miss({ ...base, type: 'survey', survey: [{ type: 'likert', text: 'q', options: [] }] }), []);
  assert.ok(miss({ ...base, type: 'program', location: '', slots: [] }).includes('장소와 예약 가능한 시간'));
  assert.deepEqual(miss({ ...base, type: 'program', location: '상담실', slots: [{ at: 1, cap: 1 }] }), []);
  assert.ok(miss({ ...base, type: 'survey', survey: [{ type: 'single', text: 'q', options: ['하나'] }] }).includes('설문 문항 내용과 선택지'));
  assert.ok(miss({ ...base, type: 'survey', survey: [{ type: 'likert', text: 'q', options: [] }], end: '2027-01-15' }).includes('모집 기간 (시작 ≤ 마감 ≤ IRB 만료)'));
  assert.ok(miss({ ...base, type: 'survey', survey: [{ type: 'likert', text: 'q', options: [] }] }, false).includes('IRB 승인 통지서 첨부'));
});

test('설문 응답 정리: 문항 정의에 없는 값은 버린다', () => {
  const survey = [
    { id: 'a', type: 'likert', options: [] }, { id: 'b', type: 'single', options: ['x', 'y'] },
    { id: 'c', type: 'multi', options: ['p', 'q'] }, { id: 'd', type: 'short', options: [] },
  ];
  assert.deepEqual(D.cleanAnswers(survey, { a: 9, b: 'z', c: ['p', 'hack'], d: '  글  ', e: '없는 문항' }), { c: ['p'], d: '글' });
  assert.deepEqual(D.cleanAnswers(survey, { a: '3', b: 'x' }), { a: 3, b: 'x' });
});

test('리커트 척도: 2~10점을 고를 수 있고, 응답은 그 범위 안에서만 인정된다', () => {
  const d = D.sanitizeDraft({ survey: [
    { id: 'a', type: 'likert', text: '7점', points: 7, labels: ['전혀 아니다', '', '', '', '', '', '매우 그렇다', '넘치는 이름'] },
    { id: 'b', type: 'likert', text: '범위 밖', points: 99 },
    { id: 'c', type: 'likert', text: '예전 문항' },
    { id: 'e', type: 'single', text: '선택', options: ['x', 'y'], points: 7 },
  ] }, NOW);
  assert.equal(d.survey[0].points, 7);
  assert.deepEqual(d.survey[0].labels, ['전혀 아니다', '', '', '', '', '', '매우 그렇다']);
  assert.equal(d.survey[1].points, 10);
  assert.equal(d.survey[2].points, 5);
  assert.equal(d.survey[3].points, undefined); // 리커트가 아닌 문항에는 붙지 않는다.
  assert.deepEqual(D.cleanAnswers(d.survey, { a: 7, b: 10, c: 5 }), { a: 7, b: 10, c: 5 });
  assert.deepEqual(D.cleanAnswers(d.survey, { a: 8, b: 11, c: 6 }), {});
  assert.deepEqual(D.cleanAnswers(d.survey, { a: 0, b: 2.5, c: '3' }), { c: 3 });
  // 점수를 정하지 않은 예전 문항은 5점 척도로 본다.
  assert.deepEqual(D.cleanAnswers([{ id: 'old', type: 'likert', options: [] }], { old: 5 }), { old: 5 });
  assert.deepEqual(D.cleanAnswers([{ id: 'old', type: 'likert', options: [] }], { old: 6 }), {});
});
