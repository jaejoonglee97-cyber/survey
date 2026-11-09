/**
 * survey.test-cases.js  (참고용 - 그대로 실행되지 않음)
 *
 * Apps Script 프로토타입(reference/Survey.gs)을 검증한 시험 사례임. 이 사례들의 '기대값'이 새 TypeScript
 * 구현(src/lib/survey-core)의 명세임. Vitest 로 옮길 때:
 *   - makeEnv()/ctx.* 호출 부분은 survey-core 의 순수 함수 호출로 바꾼다(parseSurveyMd_ → importMd, buildRow_ → normalizeAnswers,
 *     aggregate_ → aggregate, buildReportLines_ → buildReportLines, dashboardRows_ → 서버 SQL 함수 dashboard_rows 로 대체).
 *   - 구글 시트·캐시·잠금·트리거 관련 사례(설정, 관리자 키, 캐시 등)는 Supabase 구조에 맞게 'RLS 시험'과 'API 시험'으로 대체한다.
 *   - 문구(보고서 문장, 오류 메시지)의 기대값은 그대로 유지한다.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { makeEnv, GS_DIR } = require('./harness');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('PASS ' + name); }
  catch (e) { fail++; console.log('FAIL ' + name + '\n     ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n     ') : e)); }
}
const J = (x) => JSON.parse(JSON.stringify(x));
function throwsMsg(fn, re) {
  let msg = null;
  try { fn(); } catch (e) { msg = String(e && e.message); }
  assert.ok(msg !== null, '예외가 발생해야 함');
  if (re) assert.ok(re.test(msg), '예외 메시지 불일치: ' + msg);
}

const sample = fs.readFileSync(path.join(__dirname, '..', 'samples', '2026-healingcamp.md'), 'utf8');
function mdWithDeadline(deadline, slug) {
  return sample.replace(/deadline: .*/, 'deadline: ' + deadline).replace(/slug: .*/, 'slug: ' + (slug || 'healing2026'));
}

/* ───────── 1. md 해석·검증 ───────── */
const base = makeEnv();
const parse = (md) => J(base.ctx.parseSurveyMd_(md));

test('샘플 md가 오류 없이 해석됨(12문항, 필수/유형/기타 처리)', () => {
  const r = parse(sample);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.spec.questions.length, 12);
  assert.strictEqual(r.spec.slug, 'healing2026');
  assert.strictEqual(r.spec.deadline, '2026-12-10 23:59');
  assert.strictEqual(r.spec.target, 40);
  const q2 = r.spec.questions[1];
  assert.strictEqual(q2.type, 'multi'); assert.strictEqual(q2.max, 2); assert.strictEqual(q2.required, true);
  assert.strictEqual(q2.options[5].other, true); assert.strictEqual(q2.options[5].label, '기타');
  assert.strictEqual(r.spec.questions[3].low, '매우 불만족');
  assert.strictEqual(r.spec.questions[11].type, 'text'); assert.strictEqual(r.spec.questions[11].required, false);
  assert.ok(r.spec.intro.includes('무기명'));
  assert.strictEqual(r.spec.questions[0].section, '참여 정보');
});

test('머리말 누락·형식 오류를 잡아냄', () => {
  assert.ok(!parse('## [단일*] 질문\n- a\n- b').ok);
  const bad = (m) => parse(sample.replace(/deadline: .*/, 'deadline: ' + m));
  assert.ok(!bad('2026-02-31').ok);
  assert.ok(!bad('내일').ok);
  assert.ok(!bad('2026-12-10 25:00').ok);
  assert.ok(bad('2026-12-10').ok && bad('2026-12-10').spec.deadline === '2026-12-10 23:59');
  assert.ok(!parse(sample.replace(/slug: .*/, 'slug: 한글')).ok);
  assert.ok(!parse(sample.replace(/target: .*/, 'target: 많이')).ok);
});

test('문항 오류(보기 부족·중복·금지문자·잘못된 유형)를 잡아냄', () => {
  const head = '---\ntitle: t\nslug: abc\ndeadline: 2026-12-31\n---\n';
  assert.ok(!parse(head + '## [단일*] 질문\n- 하나').ok);
  assert.ok(!parse(head + '## [단일*] 질문\n- 가\n- 가').ok);
  assert.ok(!parse(head + '## [단일*] 질문\n- 가|나\n- 다').ok);
  assert.ok(!parse(head + '## [단일*] 질문\n- =SUM\n- 다').ok);
  assert.ok(!parse(head + '## [객관식*] 질문\n- 가\n- 나').ok);
  assert.ok(!parse(head).ok);
  const w = parse(head + '## [5점] 질문\n- 무시될 보기\n알 수 없는 줄');
  assert.ok(w.ok && w.warnings.length >= 2);
});

/* ───────── 2. 응답 검증·집계 (순수 함수) ───────── */
test('응답 검증: 필수, 보기 외 값, 선택 개수, 직접입력, 척도 범위', () => {
  const spec = parse(sample).spec;
  const good = { Q1: '참여자주도형(국내)', Q2: ['쉼을 통한 회복'], Q3: ['동료 네트워크'], Q4: 5, Q5: 3, Q6: 4, Q7: 4, Q8: 5, Q9: '연차 사용', Q10: '하고 있다', Q11: '있음' };
  const b = (a) => J(base.ctx.buildRow_(spec, a));
  assert.ok(b(good).ok);
  assert.strictEqual(b(good).row.length, 12);
  assert.ok(!b(Object.assign({}, good, { Q1: undefined })).ok, '필수 누락');
  assert.ok(!b(Object.assign({}, good, { Q1: '없는 보기' })).ok, '보기 외 값');
  assert.ok(!b(Object.assign({}, good, { Q2: ['쉼을 통한 회복', '여행을 좋아해서', '동료 네트워크 확대'] })).ok, '최대 개수 초과');
  assert.ok(!b(Object.assign({}, good, { Q2: '쉼을 통한 회복' })).ok, '복수 문항에 문자열');
  assert.ok(!b(Object.assign({}, good, { Q9: '기타' })).ok, '직접입력 내용 없음');
  const o = b(Object.assign({}, good, { Q9: '기타: 외부 지원금 | 사용' }));
  assert.ok(o.ok); assert.strictEqual(o.row[8], '기타: 외부 지원금 / 사용', '| 문자 치환');
  assert.ok(!b(Object.assign({}, good, { Q4: 6 })).ok);
  assert.ok(!b(Object.assign({}, good, { Q4: 3.5 })).ok);
  assert.ok(!b(Object.assign({}, good, { Q4: 'abc' })).ok);
  const f = b(Object.assign({}, good, { Q12: '=HYPERLINK("http://x")' }));
  assert.ok(f.ok && f.row[11].startsWith("'="), '수식 주입 차단');
  assert.ok(!b(null).ok);
  const long = b(Object.assign({}, good, { Q12: 'ㄱ'.repeat(5000) }));
  assert.strictEqual(long.row[11].length, 1000, '서술 길이 제한');
});

/* ───────── 3. 서버 전체 흐름 ───────── */
const env = makeEnv();
const { ctx, state, run } = env;
const call = (fn, ...a) => J(ctx[fn](...a));
let KEY = '';

test('setup: 시트·키·트리거 준비, 반복 실행해도 키 유지', () => {
  ctx.setup();
  KEY = state.props.ADMIN_KEY;
  assert.ok(/^[0-9a-f]{14}$/.test(KEY));
  assert.strictEqual(state.triggers.length, 1);
  assert.ok(state.sheets['설문목록']);
  assert.ok(state.logs.some((l) => l.includes(KEY)));
  ctx.setup();
  assert.strictEqual(state.props.ADMIN_KEY, KEY);
  assert.strictEqual(state.triggers.length, 1, '트리거 중복 설치 안 됨');
});

test('관리자 키: 오류 시 거부, 5회 실패 시 잠금, 성공 시 초기화', () => {
  throwsMsg(() => ctx.adminList('wrong'), /올바르지 않음/);
  assert.strictEqual(call('adminCheck', KEY).ok, true);
  for (let i = 0; i < 5; i++) throwsMsg(() => ctx.adminList('x' + i));
  throwsMsg(() => ctx.adminList(KEY), /너무 많음/);
  delete state.cache.fails;
  assert.ok(Array.isArray(call('adminList', KEY)));
  ['adminPreview', 'adminCreateSurvey', 'adminResults', 'adminSetDeadline', 'adminSetStatus', 'adminDelete'].forEach((fn) => {
    delete state.cache.fails;
    throwsMsg(() => ctx[fn]('bad', 'healing2026', 'x'), /올바르지 않음/);
  });
  delete state.cache.fails;
});

test('설문 생성: 검증 실패·중복·지난 마감일 거부, 정상 생성 시 링크 반환', () => {
  assert.strictEqual(call('adminCreateSurvey', KEY, '엉터리').ok, false);
  assert.strictEqual(call('adminCreateSurvey', KEY, mdWithDeadline('2026-11-01')).ok, false, '지난 마감일');
  const r = call('adminCreateSurvey', KEY, mdWithDeadline('2026-11-12 18:00'));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.link, 'https://script.google.com/macros/s/TEST/exec?s=healing2026');
  assert.ok(state.sheets['R_healing2026']);
  assert.strictEqual(call('adminCreateSurvey', KEY, mdWithDeadline('2026-11-12 18:00')).ok, false, 'slug 중복');
  const hdr = state.sheets['R_healing2026'].data[0];
  assert.strictEqual(hdr.length, 13);
  assert.strictEqual(hdr[0], '제출시각');
  const list = call('adminList', KEY);
  assert.strictEqual(list.length, 1); assert.strictEqual(list[0].state, 'open'); assert.strictEqual(list[0].count, 0); assert.strictEqual(list[0].target, 40);
});

test('응답자 화면 데이터: 대상 인원·원본 md 등 내부 정보는 노출하지 않음', () => {
  const s = call('getSurvey', 'healing2026');
  assert.strictEqual(s.state, 'open');
  assert.strictEqual(s.questions.length, 12);
  const raw = JSON.stringify(s);
  assert.ok(!raw.includes('specMd') && !raw.includes('target'));
  assert.strictEqual(call('getSurvey', 'nope-slug').state, 'notfound');
  assert.strictEqual(call('getSurvey', '../etc').state, 'notfound');
  assert.strictEqual(call('getSurvey', '').state, 'notfound');
});

function ans(over) {
  return Object.assign({ Q1: '참여자주도형(국내)', Q2: ['쉼을 통한 회복', '동료 네트워크 확대'], Q3: ['쉼을 통한 회복'], Q4: 5, Q5: 3, Q6: 4, Q7: 4, Q8: 5, Q9: '공가 처리', Q10: '하고 있다', Q11: '있음', Q12: '좋았음' }, over || {});
}

test('응답 제출: 정상 저장, 잘못된 값 거부(시트에 저장되지 않음)', () => {
  assert.strictEqual(call('submitResponse', 'healing2026', ans()).ok, true);
  assert.strictEqual(call('submitResponse', 'healing2026', ans({ Q1: '참여자주도형(해외)', Q4: 4, Q5: 2, Q9: '기타: 기관 자체 지원', Q10: '하고 있지 않다', Q11: '잘 모르겠음', Q12: '=1+1' })).ok, true);
  assert.strictEqual(call('submitResponse', 'healing2026', ans({ Q1: '협회지정형(산티아고)', Q2: ['기타: 걷기 좋아서'], Q4: 3, Q12: undefined })).ok, true);
  const before = state.sheets['R_healing2026'].getLastRow();
  assert.strictEqual(call('submitResponse', 'healing2026', ans({ Q4: 9 })).ok, false);
  assert.strictEqual(call('submitResponse', 'healing2026', ans({ Q1: undefined })).ok, false);
  assert.strictEqual(call('submitResponse', 'healing2026', ans({ Q2: ['쉼을 통한 회복', '여행을 좋아해서', '동료 네트워크 확대'] })).ok, false);
  assert.strictEqual(call('submitResponse', 'nope', ans()).ok, false);
  assert.strictEqual(state.sheets['R_healing2026'].getLastRow(), before, '거부된 응답은 저장되지 않음');
  assert.strictEqual(before, 4);
  const row = state.sheets['R_healing2026'].data[2];
  assert.strictEqual(row[12], "'=1+1", '시트에는 수식 주입이 차단된 값으로 저장');
});

test('집계·보고서 문안: 평균, 긍정비율, 응답률, 기타·수식 복원', () => {
  const r = call('adminResults', KEY, 'healing2026');
  assert.strictEqual(r.n, 3);
  const q = (id) => r.agg.questions.find((x) => x.id === id);
  assert.strictEqual(q('Q4').mean, 4); assert.strictEqual(q('Q4').pos, 2); assert.strictEqual(q('Q4').posPct, 66.7);
  assert.deepStrictEqual(q('Q4').dist, [0, 0, 1, 1, 1]);
  assert.strictEqual(q('Q1').options.find((o) => o.label === '협회지정형(산티아고)').count, 1);
  assert.strictEqual(q('Q2').options.find((o) => o.label === '쉼을 통한 회복').count, 2);
  assert.strictEqual(q('Q2').options.find((o) => o.label === '기타').count, 1);
  assert.deepStrictEqual(q('Q2').otherTexts, ['걷기 좋아서']);
  assert.deepStrictEqual(q('Q9').otherTexts, ['기관 자체 지원']);
  assert.deepStrictEqual(q('Q12').texts.sort(), ['=1+1', '좋았음'].sort(), '수식 방지용 접두 문자는 집계 시 제거');
  assert.strictEqual(q('Q12').answered, 2);
  assert.ok(r.report.includes('대상 40명 중 3명이 응답하여 응답률 7.5%임.'));
  assert.ok(r.report.includes('평균 4점(5점 만점), 긍정 응답(4~5점) 비율 66.7%(2/3명)'));
  assert.ok(/나타났음\.|나타났음\(복수응답\)\./.test(r.report));
  assert.ok(r.report.split('\n').filter((l) => l.startsWith('-') && !/^- (설문명|설문 기한):/.test(l)).every((l) => /(임|음)(\(복수응답\))?\.$/.test(l)), '모든 문장이 명사형으로 종결됨');
});

test('마감일 연장·수동 마감·재개방 규칙', () => {
  assert.strictEqual(call('adminSetDeadline', KEY, 'healing2026', '내일').ok, false);
  const ext = call('adminSetDeadline', KEY, 'healing2026', '2026-11-20');
  assert.deepStrictEqual([ext.ok, ext.deadline, ext.state], [true, '2026-11-20 23:59', 'open']);
  assert.strictEqual(call('adminSetStatus', KEY, 'healing2026', 'closed').state, 'closed');
  assert.strictEqual(call('getSurvey', 'healing2026').state, 'closed');
  assert.strictEqual(call('submitResponse', 'healing2026', ans()).closed, true);
  assert.strictEqual(call('adminSetStatus', KEY, 'healing2026', 'open').ok, true);
  assert.strictEqual(call('getSurvey', 'healing2026').state, 'open');
  assert.strictEqual(call('adminSetStatus', KEY, 'healing2026', 'weird').ok, false);
});

test('마감 시각 경과: 응답 차단, 자동 마감, 결과 메일 1회 발송, 연장 후 재마감 시 재발송', () => {
  state.now = Date.parse('2026-11-20T23:59:30+09:00');
  assert.strictEqual(call('getSurvey', 'healing2026').state, 'open', '마감 시각 전');
  state.now = Date.parse('2026-11-21T00:00:30+09:00');
  assert.strictEqual(call('getSurvey', 'healing2026').state, 'closed');
  assert.strictEqual(call('submitResponse', 'healing2026', ans()).ok, false);
  assert.strictEqual(call('adminSetStatus', KEY, 'healing2026', 'open').ok, false, '마감일 지난 설문은 먼저 연장해야 함');
  ctx.checkDeadlines();
  assert.strictEqual(state.mails.length, 1);
  assert.strictEqual(state.mails[0].to, 'admin@example.org');
  assert.ok(state.mails[0].subject.includes('2026 서울사회복지사 힐링캠프'));
  assert.ok(state.mails[0].body.includes('응답률 7.5%'));
  assert.ok(!state.mails[0].body.includes('좋았음'), '메일에는 서술 원문을 싣지 않음');
  ctx.checkDeadlines();
  assert.strictEqual(state.mails.length, 1, '중복 발송 없음');
  assert.strictEqual(call('adminList', KEY)[0].state, 'closed');
  call('adminSetDeadline', KEY, 'healing2026', '2026-11-30 12:00');
  assert.strictEqual(call('getSurvey', 'healing2026').state, 'open');
  assert.strictEqual(call('submitResponse', 'healing2026', ans()).ok, true);
  state.now = Date.parse('2026-12-01T09:00:00+09:00');
  ctx.checkDeadlines();
  assert.strictEqual(state.mails.length, 2, '연장 후 재마감 시 다시 발송');
  assert.ok(state.mails[1].body.includes('4명이 응답'));
});

test('삭제: 응답이 있는 설문은 거부, 응답이 없는 설문은 시트까지 삭제', () => {
  assert.strictEqual(call('adminDelete', KEY, 'healing2026').ok, false);
  state.now = Date.parse('2026-11-09T12:00:00+09:00');
  const md2 = mdWithDeadline('2026-12-31', 'empty-test');
  assert.strictEqual(call('adminCreateSurvey', KEY, md2).ok, true);
  assert.ok(state.sheets['R_empty-test']);
  assert.strictEqual(call('adminDelete', KEY, 'empty-test').ok, true);
  assert.ok(!state.sheets['R_empty-test']);
  assert.strictEqual(call('adminList', KEY).length, 1);
});

test('doGet 라우팅: 관리자/응답자 화면, 쿼리 값은 slug로만 전달', () => {
  assert.strictEqual(ctx.doGet({ parameter: { page: 'admin' } }).file, 'Admin');
  const r = ctx.doGet({ parameter: { s: 'healing2026' } });
  assert.strictEqual(r.file, 'Respondent'); assert.strictEqual(r.slug, 'healing2026');
  assert.strictEqual(ctx.doGet({}).file, 'Respondent');
});

/* ───────── 3b. 분류·대표지표·대시보드 ───────── */
const tpl = fs.readFileSync(path.join(__dirname, '..', 'samples', 'template-event.md'), 'utf8');
function evMd(slug, program, year, cat, deadline, target) {
  let m = tpl.replace(/slug: .*/, 'slug: ' + slug).replace(/program: .*/, (year ? 'year: ' + year + '\n' : '') + 'program: ' + program)
    .replace(/category: .*/, 'category: ' + cat).replace(/deadline: .*/, 'deadline: ' + deadline).replace('target:', 'target: ' + (target || ''));
  return m;
}
const evAns = (s) => ({ Q1: s, Q2: s, Q3: s, Q4: s, Q5: '추천', Q6: ['내용'], Q7: '비밀의견' });

test('분류·사업명·연도·대표지표 해석과 검증', () => {
  const r = parse(sample);
  assert.strictEqual(r.spec.category, '사업'); assert.strictEqual(r.spec.program, '힐링캠프');
  assert.strictEqual(r.spec.questions.filter((q) => q.kpi).length, 1);
  assert.strictEqual(r.spec.questions[3].kpi, true);
  const d = parse(evMd('abc', '송년회', '2025', '행사', '2026-12-31'));
  assert.ok(d.ok); assert.strictEqual(d.spec.year, '2025');
  const noKpi = parse(evMd('abc', 'x', '', '행사', '2026-12-31').replace('지표: 대표만족\n', ''));
  assert.ok(noKpi.ok && noKpi.warnings.some((w) => w.includes('대표 지표')), '대표 지표가 없으면 확인 사항으로 안내');
  const onSingle = parse(evMd('abc', 'x', '', '행사', '2026-12-31').replace('- 적극 추천', '지표: 대표만족\n- 적극 추천'));
  assert.ok(!onSingle.ok, '선택형 문항에는 대표 지표를 지정할 수 없음');
  const two = parse(evMd('abc', 'x', '', '행사', '2026-12-31').replace('## [5점*] 내용(주제·구성)에 만족하십니까?', '## [5점*] 내용(주제·구성)에 만족하십니까?\n지표: 대표만족'));
  assert.ok(!two.ok && two.errors.some((e) => e.includes('1개만')));
  assert.ok(!parse(evMd('abc', 'x', '25', '행사', '2026-12-31')).ok, '연도 형식');
  assert.ok(!parse(evMd('abc', 'x', '', '가'.repeat(21), '2026-12-31')).ok, '분류 길이');
  assert.strictEqual(parse(tpl.replace(/category: .*\n/, '')).spec.category, '기타', '분류 기본값');
});

const denv = makeEnv(); const D = denv.ctx, DS = denv.state;
D.setup();
const AK = DS.props.ADMIN_KEY, VK = DS.props.VIEW_KEY;
const dcall = (fn, ...a) => J(D[fn](...a));
function mkSurvey(slug, program, year, cat, deadline, scores, stripKpi) {
  let m = evMd(slug, program, year, cat, deadline, 30);
  if (stripKpi) m = m.replace('지표: 대표만족\n', '');
  assert.ok(dcall('adminCreateSurvey', AK, m).ok, slug + ' 생성');
  scores.forEach((s) => assert.ok(dcall('submitResponse', slug, evAns(s)).ok));
}

test('대시보드: 열람 키 발급과 권한 분리(열람 키로는 설문 관리·서술 의견 접근 불가)', () => {
  assert.ok(/^[0-9a-f]{10}$/.test(VK));
  mkSurvey('edu2025', 'AI 교육', '2025', '교육', '2026-12-30', [5, 4, 4, 3, 5, 4]);
  mkSurvey('edu2026', 'AI 교육', '2026', '교육', '2026-12-29', [5, 5, 4, 5, 4]);
  mkSurvey('party2026', '송년회', '2026', '행사', '2026-12-28', [5, 5, 5]);
  mkSurvey('nokpi2026', '간담회', '', '교육', '2026-12-27', [3, 4, 5, 4, 4, 4], true);
  throwsMsg(() => D.getDashboard('wrong'), /키가 올바르지 않음/);
  delete DS.cache.fails;
  assert.ok(D.getDashboard(VK).rows);
  assert.ok(D.getDashboard(AK).rows);
  ['adminList', 'adminResults', 'adminPreview', 'adminCreateSurvey', 'adminDelete', 'adminSetStatus', 'adminSetDeadline'].forEach((fn) => {
    delete DS.cache.fails;
    throwsMsg(() => D[fn](VK, 'edu2025', 'x'), /관리자 키가 올바르지 않음/);
  });
  delete DS.cache.fails;
});

test('대시보드: 행 구성(최근 마감 순, 5건 미만 비공개, 대표 지표 없는 설문 구분)', () => {
  const res = dcall('getDashboard', VK, true);
  assert.deepStrictEqual(res.rows.map((r) => r.slug), ['edu2025', 'edu2026', 'party2026', 'nokpi2026']);
  const by = (s) => res.rows.find((r) => r.slug === s);
  assert.deepStrictEqual([by('edu2025').shown, by('edu2025').dist, by('edu2025').year, by('edu2025').category, by('edu2025').program], [true, [0, 0, 1, 3, 2], '2025', '교육', 'AI 교육']);
  assert.deepStrictEqual([by('edu2026').shown, by('edu2026').dist], [true, [0, 0, 0, 2, 3]], '정확히 5건이면 공개');
  assert.deepStrictEqual([by('party2026').shown, by('party2026').dist, by('party2026').valid, by('party2026').n], [false, null, 3, 3]);
  assert.deepStrictEqual([by('nokpi2026').hasKpi, by('nokpi2026').shown, by('nokpi2026').year], [false, false, '2026']);
  assert.strictEqual(by('edu2026').target, 30); assert.strictEqual(by('edu2026').state, 'open');
  assert.strictEqual(res.minN, 5);
  const raw = JSON.stringify(res);
  assert.ok(!raw.includes('비밀의견') && !raw.includes('specMd') && !raw.includes('내용(주제'), '서술 의견·문항 원문은 대시보드로 전달되지 않음');
});

test('대시보드: 5분 캐시, 새로고침(force)·설문 변경 시 갱신', () => {
  const n0 = dcall('getDashboard', VK).rows.find((r) => r.slug === 'party2026').n;
  assert.strictEqual(n0, 3);
  assert.ok(dcall('submitResponse', 'party2026', evAns(5)).ok);
  assert.strictEqual(dcall('getDashboard', VK).rows.find((r) => r.slug === 'party2026').n, 3, '캐시된 값');
  assert.strictEqual(dcall('getDashboard', VK, true).rows.find((r) => r.slug === 'party2026').n, 4, '강제 새로고침');
  assert.ok(dcall('submitResponse', 'party2026', evAns(5)).ok);
  assert.ok(dcall('adminSetStatus', AK, 'party2026', 'closed').ok);
  const r = dcall('getDashboard', VK).rows.find((x) => x.slug === 'party2026');
  assert.strictEqual(r.n, 5, '상태 변경 시 캐시 초기화');
  assert.deepStrictEqual([r.shown, r.state], [true, 'closed']);
  assert.ok(dcall('adminCreateSurvey', AK, evMd('late2026', '새 사업', '2026', '사업', '2026-12-31')).ok);
  assert.ok(dcall('getDashboard', VK).rows.some((x) => x.slug === 'late2026'), '설문 생성 시 캐시 초기화');
});

test('열람 키 재발급: 이전 키 즉시 무효', () => {
  const old = VK;
  D.resetViewKey();
  assert.notStrictEqual(DS.props.VIEW_KEY, old);
  throwsMsg(() => D.getDashboard(old), /키가 올바르지 않음/);
  delete DS.cache.fails;
  assert.ok(D.getDashboard(DS.props.VIEW_KEY).rows);
  const ctrl = D.adminCheck(AK);
  assert.strictEqual(J(ctrl).viewKey, DS.props.VIEW_KEY);
  assert.strictEqual(D.doGet({ parameter: { page: 'dashboard' } }).file, 'Dashboard');
});

/* ───────── 4. 화면 스크립트 문법 ───────── */
test('HTML 내 스크립트 문법 검사', () => {
  ['Respondent.html', 'Admin.html', 'Dashboard.html'].forEach((f) => {
    const html = fs.readFileSync(path.join(GS_DIR, f), 'utf8');
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(m, f + ': script 없음');
    new vm.Script(m[1], { filename: f });
  });
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
