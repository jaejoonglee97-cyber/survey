// 실행: npm i -D @electric-sql/pglite && node supabase/tests/rls.test.mjs  (Supabase 의 anon/authenticated/service_role 역할과 auth.uid() 를 흉내 내어 RLS 시나리오를 검증함)
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import assert from 'assert';
const db = new PGlite();
await db.exec(`
 create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
 create schema auth;
 create table auth.users (id uuid primary key default gen_random_uuid(), raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
 grant usage on schema auth to anon, authenticated, service_role;
 grant usage on schema public to anon, authenticated, service_role;
`);
await db.exec(fs.readFileSync(process.argv[2] || new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '\n   ', String(e.message).split('\n')[0]); } }
const as = async (role, uid) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false); set role ${role};`); };
const reset = () => db.exec('reset role');
const q = async (sql, params) => (await db.query(sql, params)).rows;
const expectErr = async (fn, re) => { let m = null; try { await fn(); } catch (e) { m = e.message; } assert.ok(m !== null, '오류가 나야 함'); if (re) assert.ok(re.test(m), m); };

const admin = (await q("insert into auth.users default values returning id"))[0].id;
const viewer = (await q("insert into auth.users default values returning id"))[0].id;
await db.exec(`update public.profiles set role='admin' where id='${admin}'`);

await t('가입 시 profiles 자동 생성(viewer 기본)', async () => {
  const r = await q('select id, role from public.profiles order by role');
  assert.strictEqual(r.length, 2); assert.deepStrictEqual(r.map((x) => x.role).sort(), ['admin', 'viewer']);
});

const qs = JSON.stringify([{ id: 'q1', type: 'scale5', text: '전반 만족', required: true }]);
let sid;
await t('관리자: 설문 생성, 게시 설정(마감일 없으면 거부)', async () => {
  await as('authenticated', admin);
  sid = (await q(`insert into public.surveys (slug,title,program,year,questions,kpi_question_id,created_by) values ('s2026','2026 행사','행사',2026,$1,'q1',$2) returning id`, [qs, admin]))[0].id;
  await expectErr(() => q(`update public.surveys set status='open' where id=$1`, [sid]), /open_requires_deadline/);
  await q(`update public.surveys set status='open', deadline = now() + interval '1 day' where id=$1`, [sid]);
  await expectErr(() => q(`insert into public.surveys (slug,title,program,year) values ('Bad Slug','x','x',2026)`), /slug|check/);
});
await t('게시 후 문항 수정 거부, 마감일 변경은 허용', async () => {
  await expectErr(() => q(`update public.surveys set questions='[]' where id=$1`, [sid]), /수정할 수 없음/);
  await q(`update public.surveys set deadline = now() + interval '2 day' where id=$1`, [sid]);
});
await t('응답 제출(service_role): 정상, 잘못된 형식, 없는 설문', async () => {
  await as('service_role');
  assert.strictEqual((await q(`select public.submit_response('s2026', '{"q1":"5"}') r`))[0].r, 'ok');
  assert.strictEqual((await q(`select public.submit_response('s2026', '[1]') r`))[0].r, 'invalid');
  assert.strictEqual((await q(`select public.submit_response('none', '{"q1":"5"}') r`))[0].r, 'closed');
});
await t('익명·일반 로그인 사용자는 제출 함수 실행과 테이블 접근 불가', async () => {
  await as('anon');
  await expectErr(() => q(`select public.submit_response('s2026', '{"q1":"5"}')`), /permission denied/);
  await expectErr(() => q('select * from public.responses'), /permission denied/);
  await expectErr(() => q('select * from public.surveys'), /permission denied/);
  await as('authenticated', viewer);
  await expectErr(() => q(`select public.submit_response('s2026', '{"q1":"5"}')`), /permission denied/);
  await expectErr(() => q(`insert into public.responses (survey_id, answers) values ('${sid}', '{"q1":"5"}')`), /row-level security|permission denied/);
  assert.strictEqual((await q('select * from public.responses')).length, 0, '열람자는 응답 원자료를 볼 수 없음');
  assert.strictEqual((await q('select * from public.surveys')).length, 0, '열람자는 설문 테이블을 볼 수 없음');
});
await t('관리자는 응답 원자료 열람 가능', async () => {
  await as('authenticated', admin);
  assert.strictEqual((await q('select * from public.responses')).length, 1);
});
await t('대시보드 함수: 5건 미만 비공개, 5건 이상 공개, 익명 불가, 열람자 가능', async () => {
  await as('service_role');
  for (const v of ['5', '4', '4', '3']) await q(`select public.submit_response('s2026', $1)`, [JSON.stringify({ q1: v })]);
  await as('authenticated', viewer);
  let r = (await q('select * from public.dashboard_rows()'))[0];
  assert.strictEqual(Number(r.n), 5); assert.strictEqual(Number(r.valid), 5);
  assert.deepStrictEqual([r.d1, r.d2, r.d3, r.d4, r.d5].map(Number), [0, 0, 1, 2, 2]);
  await as('service_role');
  await db.exec(`reset role`);
  await db.exec(`insert into public.surveys (slug,title,program,year,status,deadline,questions,kpi_question_id) values ('small','소규모','행사',2026,'open',now()+interval '1 day','${qs}','q1')`);
  await q(`select public.submit_response('small','{"q1":"5"}')`);
  await as('authenticated', viewer);
  r = (await q(`select * from public.dashboard_rows() where slug='small'`))[0];
  assert.strictEqual(Number(r.n), 1); assert.strictEqual(r.d5, null, '5건 미만은 분포를 반환하지 않음');
  await as('anon');
  await expectErr(() => q('select * from public.dashboard_rows()'), /permission denied/);
});
await t('마감 처리: 마감 시각이 지난 설문만 닫고, 이후 제출 거부', async () => {
  await reset();
  await db.exec(`update public.surveys set deadline = now() - interval '1 minute' where slug='small'`);
  await as('service_role');
  const closed = await q('select * from public.close_expired_surveys()');
  assert.deepStrictEqual(closed.map((x) => x.slug), ['small']);
  assert.strictEqual((await q(`select public.submit_response('small','{"q1":"5"}') r`))[0].r, 'closed');
  assert.strictEqual((await q(`select public.submit_response('s2026','{"q1":"5"}') r`))[0].r, 'ok');
  assert.strictEqual((await q('select * from public.close_expired_surveys()')).length, 0);
});
await t('설계 세션: 본인 것만 접근, 열람자는 만들 수 없는 설문과 무관', async () => {
  await as('authenticated', admin);
  await q(`insert into public.builder_sessions (created_by) values ($1)`, [admin]);
  await as('authenticated', viewer);
  assert.strictEqual((await q('select * from public.builder_sessions')).length, 0);
  await expectErr(() => q(`insert into public.builder_sessions (created_by) values ($1)`, [admin]), /row-level security/);
});
await t('역할 변경은 관리자만', async () => {
  await as('authenticated', viewer);
  await q(`update public.profiles set role='admin' where id=$1`, [viewer]);
  await reset();
  assert.strictEqual((await q('select role from public.profiles where id=$1', [viewer]))[0].role, 'viewer');
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
