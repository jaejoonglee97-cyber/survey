-- 0001_init.sql : 만족도 설문 플랫폼 초기 스키마
-- 원칙: 모든 테이블 RLS 활성, 공개(익명) 접근 권한 없음. 응답 제출·설문 공개 조회는 서버(Route Handler)가
--       service_role 키(서버 전용 환경변수)로 처리함. 응답에는 개인 식별 정보를 저장하지 않음.

-- ───────── 권한 보조 ─────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  role text not null default 'viewer' check (role in ('admin', 'viewer')),
  created_at timestamptz not null default now()
);

create or replace function public.current_role_name() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() = 'admin', false)
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() in ('admin', 'viewer'), false)
$$;

-- 신규 가입자는 viewer로 시작(관리자가 admin으로 승격). 도메인 제한은 Supabase Auth 설정과 앱에서 처리함.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name) values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────── 설문 ─────────
create table public.surveys (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  title text not null check (char_length(title) between 1 and 100),
  category text not null default '기타' check (char_length(category) between 1 and 20),
  program text not null check (char_length(program) between 1 and 60),
  year int not null check (year between 2000 and 2100),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  deadline timestamptz,
  target int check (target is null or target between 1 and 100000),
  intro text not null default '',
  questions jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array'),
  kpi_question_id text,               -- 대표 만족도 문항 id (5점 문항 1개)
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_notified_at timestamptz,
  constraint open_requires_deadline check (status = 'draft' or deadline is not null)
);
create index surveys_status_deadline_idx on public.surveys (status, deadline);

-- 게시 후에는 문항과 대표 지표를 바꿀 수 없음(응답과의 불일치 방지)
create or replace function public.surveys_guard() returns trigger
language plpgsql as $$
begin
  if old.status <> 'draft' and (new.questions is distinct from old.questions
      or new.kpi_question_id is distinct from old.kpi_question_id) then
    raise exception '게시된 설문의 문항은 수정할 수 없음';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger surveys_guard_trg before update on public.surveys
  for each row execute function public.surveys_guard();

-- ───────── 응답(무기명) ─────────
create table public.responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys (id) on delete cascade,
  submitted_at timestamptz not null default now(),
  answers jsonb not null check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) <= 20000)
);
create index responses_survey_idx on public.responses (survey_id);

-- ───────── 대화형 문항 설계 세션 ─────────
create table public.builder_sessions (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users (id),
  survey_id uuid references public.surveys (id) on delete set null,
  messages jsonb not null default '[]'::jsonb,   -- 문항 설계 대화만 저장(개인정보 입력 금지 안내)
  draft jsonb not null default '{}'::jsonb,      -- 현재 설문 초안(JSON)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────── 서버 전용 함수(service_role만 실행) ─────────
-- 응답 제출: 진행 중·마감 전인 설문에만 저장. 마감 시각 경계 경쟁을 막기 위해 한 문장에서 확인함.
create or replace function public.submit_response(p_slug text, p_answers jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from public.surveys
   where slug = p_slug and status = 'open' and deadline >= now();
  if v_id is null then return 'closed'; end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' or pg_column_size(p_answers) > 20000 then return 'invalid'; end if;
  if (select count(*) from public.responses where survey_id = v_id) >= 5000 then return 'full'; end if;
  insert into public.responses (survey_id, answers) values (v_id, p_answers);
  return 'ok';
end $$;

-- 마감 처리: 마감 시각이 지난 설문을 닫고 방금 닫힌 설문을 반환(크론에서 호출)
create or replace function public.close_expired_surveys()
returns table (id uuid, slug text, title text)
language sql security definer set search_path = public as $$
  update public.surveys s set status = 'closed'
   where s.status = 'open' and s.deadline < now()
  returning s.id, s.slug, s.title
$$;

revoke all on function public.submit_response(text, jsonb) from public, anon, authenticated;
revoke all on function public.close_expired_surveys() from public, anon, authenticated;
grant execute on function public.submit_response(text, jsonb) to service_role;
grant execute on function public.close_expired_surveys() to service_role;

-- ───────── 대시보드 집계(직원 로그인 필요, 5건 미만 비공개) ─────────
create or replace function public.dashboard_rows(min_n int default 5)
returns table (
  slug text, title text, category text, program text, year int, status text,
  deadline timestamptz, target int, n bigint, valid bigint,
  d1 bigint, d2 bigint, d3 bigint, d4 bigint, d5 bigint
)
language sql stable security definer set search_path = public as $$
  with agg as (
    select s.id,
           count(r.id) as n,
           count(*) filter (where r.answers ->> s.kpi_question_id ~ '^[1-5]$') as valid,
           count(*) filter (where r.answers ->> s.kpi_question_id = '1') as c1,
           count(*) filter (where r.answers ->> s.kpi_question_id = '2') as c2,
           count(*) filter (where r.answers ->> s.kpi_question_id = '3') as c3,
           count(*) filter (where r.answers ->> s.kpi_question_id = '4') as c4,
           count(*) filter (where r.answers ->> s.kpi_question_id = '5') as c5
      from public.surveys s
      left join public.responses r on r.survey_id = s.id
     where s.status <> 'draft'
     group by s.id
  )
  select s.slug, s.title, s.category, s.program, s.year, s.status, s.deadline, s.target,
         a.n, a.valid,
         case when a.valid >= min_n then a.c1 end, case when a.valid >= min_n then a.c2 end,
         case when a.valid >= min_n then a.c3 end, case when a.valid >= min_n then a.c4 end,
         case when a.valid >= min_n then a.c5 end
    from public.surveys s join agg a on a.id = s.id
   where public.is_staff()
   order by s.deadline desc nulls last
$$;
revoke all on function public.dashboard_rows(int) from public, anon;
grant execute on function public.dashboard_rows(int) to authenticated;

-- ───────── RLS ─────────
alter table public.profiles enable row level security;
alter table public.surveys enable row level security;
alter table public.responses enable row level security;
alter table public.builder_sessions enable row level security;

create policy profiles_read on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy profiles_admin_update on public.profiles for update using (public.is_admin()) with check (public.is_admin());

create policy surveys_admin_all on public.surveys for all using (public.is_admin()) with check (public.is_admin());

create policy responses_admin_read on public.responses for select using (public.is_admin());
create policy responses_admin_delete on public.responses for delete using (public.is_admin());
-- insert/update 정책 없음 → 로그인 사용자도 직접 저장·수정 불가(서버의 submit_response만 가능)

create policy builder_owner_all on public.builder_sessions for all
  using (created_by = auth.uid() or public.is_admin())
  with check (created_by = auth.uid() or public.is_admin());

-- 익명 접근 차단(기본 권한 회수) 및 필요한 권한만 부여
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on public.profiles, public.surveys, public.builder_sessions to authenticated;
grant select, delete on public.responses to authenticated;
