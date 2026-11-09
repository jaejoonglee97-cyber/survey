# 만족도 설문 앱 - 구성 계획 (v1)

작성일: 2026-11-09 · 기준 자료: `survey-platform-handoff/` 인계 패키지

## 1. 확정된 결정

| 항목 | 결정 | 인계 문서와의 차이 |
|---|---|---|
| 저장소 | 이 폴더(`D:\claude project\survey`)에 **독립 앱**으로 새로 만듦 | 기존 회원서비스 저장소에 통합 → 독립 앱. 디자인만 기존 '업무 홈'을 따름 |
| 실행 환경 | **Next.js(App Router, TypeScript) + Vercel** | 동일 |
| 데이터 저장 | **Google 스프레드시트**(Sheets API, 서버에서만 접근) | Supabase(Postgres·RLS) → 스프레드시트. `supabase/` 폴더는 쓰지 않음 |
| AI 문항 설계 | **보류**(v2 후보) | `docs/03-builder-chat.md` 전체 보류. 대신 문항 직접 편집기 + md 불러오기 |

## 2. 전체 구조

```
[응답자 휴대전화] /s/<slug>             [담당자·열람자 브라우저] /survey/**
          │                                         │ Google 로그인(협회 도메인)
          ▼                                         ▼
┌────────────────────── Vercel (Next.js, 리전 icn1) ──────────────────────┐
│ 공개  /s/[slug]                 설문 문항만 조회(대상 인원·내부 값 제외)   │
│ 공개  POST /api/s/[slug]/submit 크기·형식 검증 → survey-core 검증 → 행 추가 │
│ 직원  /survey/**                세션 + staff 탭의 역할(admin/viewer) 확인   │
│ 크론  /api/cron/close-surveys   CRON_SECRET 확인 → 마감 표시 → 결과 메일    │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ 서비스 계정(키는 서버 전용 환경변수)
                                ▼
             Google 스프레드시트 (협회 Workspace 공유 드라이브)
```

- 브라우저는 스프레드시트에 **직접 접근하지 않음.** 모든 읽기·쓰기는 서버 라우트가 서비스 계정으로 함.
- 스프레드시트는 서비스 계정과 담당자 몇 명에게만 공유함. '링크가 있는 모든 사용자' 공유 금지.
- 응답 차단은 크론과 무관하게 제출 시점에 서버가 마감 시각을 확인해 즉시 이루어짐.

## 3. 스프레드시트 구성 (DB 설계)

스프레드시트 1개에 탭을 나눠 씀. 운영용과 개발용(더미)은 **별도 파일**로 둠.

| 탭 | 한 행의 의미 | 주요 열 |
|---|---|---|
| `surveys` | 설문 1건 | id, slug, title, category, program, year, deadline, target, intro, questions_json, kpi_question_id, status(draft/open/closed), created_by, created_at, published_at, closed_at, closed_notified_at |
| `r_<slug>` | 응답 1건(설문마다 탭 1개) | submitted_at + 문항별 열(q1, q2 …). 게시 시점에 열을 만들고, 게시 후 문항은 바뀌지 않으므로 열이 고정됨 |
| `staff` | 직원 1명 | email, role(admin/viewer), active |
| `summary` | 마감된 설문의 대표 문항 집계 캐시 | survey_id, n, dist_1~5, mean, positive_rate (대시보드 속도용) |

- 응답 탭을 설문별로 나누는 이유: 담당자가 시트에서 바로 읽을 수 있고, 프로토타입 `buildRow_`가 이미 이 형태(문항=열)로 행을 만듦.
- 응답 행에 이름·연락처·IP·User-Agent를 저장하지 않음(무기명).
- 모든 셀은 `= + - @` 시작을 막아 수식 주입을 방지함(저장·CSV 모두).

## 4. 스프레드시트를 쓸 때 알아 둘 한계

| 한계 | 영향 | 대응 |
|---|---|---|
| Sheets API 쓰기 한도(서비스 계정 1개 기준 분당 약 60건) | 행사 현장에서 QR로 100명이 1분 안에 몰리면 일부 제출이 늦어질 수 있음 | 서버에서 재시도(지수 백오프), 실패 시 "잠시 후 다시 제출" 안내. 필요하면 Google에 한도 상향 요청 |
| 동시 쓰기 순서 보장 약함 | 행 추가(append)는 안전하지만, 같은 행을 동시에 고치는 작업은 충돌 가능 | 응답은 추가만 함. 설문 상태 변경은 담당자 동작·크론에서만 |
| 읽기 속도 | 대시보드가 모든 응답 탭을 읽으면 느림 | `summary` 탭 캐시 + Next.js 캐시(짧은 재검증) |
| Vercel 크론 | Hobby 요금제는 하루 1회만 가능, 기관 사용은 Pro 요금제 대상일 수 있음 | 응답 차단은 제출 시점 확인이라 영향 없음. 결과 메일만 하루 1회로 늦어짐. 요금제 확인 필요 |

## 5. 폴더 구조(안)

```
survey/
  PLAN.md                      이 문서
  survey-platform-handoff/     인계 자료(참고용, 그대로 둠)
  app/                         Next.js 앱
    src/
      app/
        s/[slug]/page.tsx              응답 화면(공개)
        api/s/[slug]/submit/route.ts   응답 제출
        survey/                        담당자 화면: 홈, list, new, [id]/edit, [id]/results, dashboard, settings
        api/cron/close-surveys/route.ts
        api/auth/[...nextauth]/route.ts
      lib/
        survey-core/   순수 TS: spec, validate, answers, aggregate, report, import-md (Survey.gs 이식)
        sheets/        server-only: client.ts(서비스 계정), surveys.ts, responses.ts, staff.ts, summary.ts
        auth/          Google 로그인 + 도메인 제한 + staff 역할 확인
        mail/          결과 요약 메일(수치만)
      components/      Sidebar, PageHeader, StatCard, ScaleBar(만족도 눈금) 등
    tests/             Vitest (survey-core, 라우트, 권한)
    scripts/           seed-dummy.ts(더미 시트 채우기), check-secrets.ts
    .env.example
```

## 6. 인계 문서에서 그대로 쓰는 것 / 바꾸는 것

| 자료 | 처리 |
|---|---|
| `reference/Survey.gs`, `survey.test-cases.js` | **그대로 이식**(survey-core). 시험 사례가 명세 |
| `reference/Respondent.html`, `Dashboard.html` | 응답 화면·대시보드 상호작용 이식 |
| `reference/samples/*.md` | md 불러오기 시험 자료, 새 설문의 출발 템플릿 |
| `docs/01-prd.md` | 그대로 따르되 3.1(대화형 설계)을 '문항 편집기 + md 불러오기'로 대체 |
| `docs/02-architecture.md` | 데이터 흐름·권한 매트릭스만 참고, Supabase 부분은 위 3절로 대체 |
| `docs/03-builder-chat.md` | 보류. 단 5절 **검증 규칙(PII_QUESTION, NO_KPI 등)은 편집기에도 그대로 적용** |
| `docs/04-design-system.md` | 그대로 사용(색·치수·화면 구성) |
| `docs/06-safety-checklist.md` | Supabase 항목을 스프레드시트 항목으로 바꿔 사용 |
| `supabase/` | 쓰지 않음. 권한 시나리오 10개는 라우트 시험으로 옮김 |

## 7. 단계

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| 0 | 준비: Next.js 앱 생성, 더미 스프레드시트·서비스 계정 연결, `.env.example`, `.gitignore` | 로컬에서 더미 시트 읽기 성공, 키가 저장소에 없음 |
| 1 | survey-core 이식 | 프로토타입 시험 전부 + 신규 검증 규칙 통과, 샘플 md 2개 해석 |
| 2 | sheets 어댑터 + 더미 시드 | 설문 4건(같은 사업 2025·2026 포함)·임의 응답 생성, 수식 주입 방어 시험 |
| 3 | 응답 화면(공개) | 정상 제출·마감 후 거부·필수 누락·보기 외 값·HTML 문자열 시험, 360px 폭 |
| 4 | 로그인·권한 + 담당자 화면(목록·결과·문항 편집기) | 열람자·비로그인의 담당자 경로 접근 거부 시험, 보고서 문안 복사, CSV |
| 5 | 대시보드 | 5건 미만 수치가 응답에 포함되지 않음, 연도별 추이 계산 시험 |
| 6 | 게시·마감·결과 메일 | 마감 경계(23:59:30 가능, 00:00:30 거부), 크론 인증 실패 401, 중복 발송 방지 |
| 7 | 보안 점검·배포 | 점검표 전 항목 통과 후 Vercel 배포(운영 시트는 이때 처음 연결) |
| 8 | 시범 운영(사람) | 더미 설문 1건으로 전체 흐름 확인 → 정보보안 담당자 검토 → 실제 설문 |
| (v2) | AI 문항 설계 | `docs/03-builder-chat.md` 기준으로 추가 |

## 8. 보안·개인정보 (스프레드시트 기준으로 바꾼 핵심)

1. 스프레드시트는 **협회(기관) Google Workspace 계정·공유 드라이브**에 둠. 개인 Gmail 계정 금지(위탁 문서 문제). Workspace는 데이터 처리 약관이 포함됨.
2. 서비스 계정 키(`GOOGLE_SERVICE_ACCOUNT_KEY`)와 `AUTH_SECRET`, `CRON_SECRET`, 메일 키는 **서버 전용 환경변수**. `NEXT_PUBLIC_` 금지, 저장소 커밋 금지.
3. 서비스 계정에는 해당 스프레드시트만 공유함(드라이브 전체 권한 부여 금지).
4. 개발·Preview 배포는 **더미 스프레드시트**에만 연결. 보안 점검이 끝나기 전에는 실제 응답을 받지 않음.
5. 무기명 응답, 문항에 개인 식별 정보 금지(서버 검증으로 차단), 서술 문항 안내문 자동 추가.
6. 저장 위치: Google Workspace의 데이터 리전은 요금제에 따라 지정 가능 여부가 다르므로 정보보안 담당자와 확인함.
7. 이 문서는 법률 자문이 아님. 운영 전 기관 정보보안 담당자의 검토를 받음.

## 9. 아직 확인이 필요한 것

| 번호 | 질문 | 기본값(답이 없으면) |
|---|---|---|
| 1 | 협회가 **Google Workspace**를 쓰는지(직원 메일이 Gmail 기반인지) | Workspace 있음 → Google 로그인 + 도메인 제한 |
| 2 | 운영용 스프레드시트를 둘 기관 계정·공유 드라이브 | 담당자가 생성 후 서비스 계정에 공유 |
| 3 | Vercel 요금제(Hobby/Pro) | Pro 권장(기관 사용, 매시간 크론) |
| 4 | 결과 메일 발송 수단 | Workspace 있으면 Gmail API, 없으면 Resend |
| 5 | 열람자(이사회·직원) 범위와 응답 보관 기간 | 열람자는 `staff` 탭에 수동 등록, 보관 기간은 미정 |
| 6 | 응답 링크 주소 | Vercel 기본 주소로 시작, 이후 협회 하위 도메인 연결 |
