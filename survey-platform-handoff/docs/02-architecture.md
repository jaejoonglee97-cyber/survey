# 02. 구조 설계

## 1. 구성도

```
[응답자 휴대전화]                         [담당자·열람자 브라우저]
      │  /s/<slug>                               │  /survey/**
      ▼                                          ▼
┌───────────────────────────── Vercel (Next.js App Router, icn1) ─────────────────────────────┐
│ (public) /s/[slug]            서버 컴포넌트: 설문 공개 조회(정제된 문항만)                     │
│ (public) POST /api/s/[slug]/submit  검증 → rpc submit_response   ← service_role (서버 전용)    │
│ (staff)  /survey/**           Supabase 세션 + 역할(admin/viewer) 확인                         │
│ (staff)  POST /api/builder/chat    SSE: Claude API(도구 사용) ↔ 초안 갱신                      │
│ (cron)   GET  /api/cron/close-surveys   CRON_SECRET 확인 → close_expired_surveys → 메일       │
└───────────────┬──────────────────────────────────────────────┬──────────────────────────────┘
                │ Supabase (Postgres·Auth·RLS, 서울)             │ Anthropic API (설계 대화만)
                ▼                                                ▼
          surveys / responses / profiles / builder_sessions     문항 초안 생성·수정(도구 호출)
```

- 공개(익명) 경로는 **서버 코드만** DB에 접근함. 브라우저에서 Supabase 테이블을 직접 읽거나 쓰지 않음.
- 직원 경로는 Supabase 세션으로 RLS를 통과함(admin: 전체, viewer: 대시보드 함수만).
- AI 호출은 서버에서만 이루어지고 API 키는 클라이언트에 전달되지 않음.

## 2. 기술 선택

| 영역 | 선택 | 이유 |
|---|---|---|
| 프레임워크 | Next.js(App Router), TypeScript strict | 기존 사이트와 동일 |
| DB·인증 | Supabase(서울), RLS | 기존 스택, 행 수준 보안 |
| 검증 | zod + `survey-core`(순수 TS 라이브러리) | 서버·클라이언트가 같은 규칙 사용, 시험 용이 |
| AI | Anthropic Messages API, 도구 사용(tool use), 스트리밍 | 대화로 구조화된 초안을 안전하게 갱신 |
| 모델 | 환경변수 `ANTHROPIC_MODEL`(기본 `claude-sonnet-5-5`) | 교체 가능하게 둠 |
| 스타일 | 기존 저장소의 방식(Tailwind 등) + `04-design-system.md` 토큰 | 디자인 일관성 |
| 시험 | Vitest, PGlite 또는 Supabase 로컬 DB | RLS 시나리오 자동 검증 |
| 크론 | Vercel Cron(매시간) | 마감 자동 처리 |
| 메일 | Resend(대체 가능) | 결과 요약 1회 발송 |

## 3. 폴더 구조(안)

기존 저장소 구조를 우선하고, 아래는 새로 추가할 부분의 제안임.

```
src/
  app/
    (public)/s/[slug]/page.tsx            응답 화면
    api/s/[slug]/submit/route.ts          응답 제출
    survey/                               담당자 화면 (기존 레이아웃 안에 편입)
      page.tsx  list/  new/  [id]/edit/  [id]/results/  dashboard/  settings/
    api/builder/chat/route.ts             대화형 설계(SSE)
    api/cron/close-surveys/route.ts       마감 처리
  lib/survey-core/                        순수 TS (프레임워크 의존 없음)
    spec.ts        타입·zod 스키마
    validate.ts    설문 검증(대표 문항, 개인정보 문항 차단, 길이 기준)
    answers.ts     응답 검증·정규화
    aggregate.ts   집계(선택형, 5점, 서술)
    report.ts      결과보고서 문안(공문서 명사형)
    import-md.ts   md 문항 파일 가져오기·내보내기(선택)
  lib/supabase/    server.ts(service_role, server-only), staff.ts(세션)
  lib/builder/     prompt.ts, tools.ts, apply-tool.ts, stream.ts
supabase/
  migrations/0001_init.sql                스키마·RLS·함수 (검증 완료본)
  tests/rls.test.mjs                      권한 시나리오 시험
  seed.sql                                더미 데이터
```

## 4. 설문 명세(Spec) - 시스템의 기준 데이터

설문은 JSON 명세로 저장함(`surveys.questions`, `surveys.kpi_question_id` 등). md 파일은 가져오기·내보내기 형식일 뿐 기준이 아님.

```ts
type QuestionType = 'single' | 'multi' | 'scale5' | 'text';

interface Question {
  id: string;                 // 'q1', 'q2' ... 생성 시 부여하고 순서를 바꿔도 유지
  type: QuestionType;
  text: string;               // 200자 이내
  required: boolean;
  section?: string;           // 영역 제목
  note?: string;              // 질문 아래 안내
  options?: { label: string; other?: boolean }[]; // single/multi: 2~20개, other=직접입력
  max?: number;               // multi: 선택 개수 제한
  low?: string; high?: string // scale5: 양 끝 라벨
}

interface SurveySpec {
  title: string; slug: string; category: string; program: string; year: number;
  deadline: string;           // ISO 8601, 한국시간. 표기한 분의 끝(:59.999)으로 저장
  target?: number; intro: string;
  questions: Question[];      // 최대 40개(권장 12개 이내)
  kpiQuestionId: string | null; // 대표 만족도 문항(scale5)
}
```

응답은 `responses.answers`에 `{ "<questionId>": value }` 로 저장함: single → 보기 문자열, multi → 문자열 배열, scale5 → 1~5 숫자, text → 문자열. 직접입력 보기는 `"기타: 내용"` 형태임.

검증 규칙의 상세는 `reference/Survey.gs`(`parseSurveyMd_`, `buildRow_`, `aggregate_`)와 그 시험 사례를 따름. 핵심만 요약하면:

- 보기에 `|` 불가, `= + - @`로 시작 불가(시트 수식 주입 방지), 중복 불가
- 서술 응답 1,000자 제한, 직접입력 200자 제한
- 5점 척도는 정수 1~5, 복수 선택은 `max` 초과 불가, 보기에 없는 값은 거부
- 표기한 마감 시각의 '분'이 끝날 때까지 접수

## 5. 주요 흐름

### 5.1 응답 제출
1. `/s/[slug]` 서버 컴포넌트가 `surveys`에서 `status='open'` 이고 마감 전인 설문을 service_role로 조회하여 **문항 정보만**(대상 인원·내부 필드 제외) 내려줌
2. 응답자가 제출하면 `POST /api/s/[slug]/submit`
3. 라우트가 요청 크기·형식을 확인하고, `survey-core`로 응답을 검증·정규화한 뒤 `rpc('submit_response')` 호출
4. 함수가 마감·상태를 원자적으로 확인하고 저장함. 결과 코드 `ok | closed | invalid | full`을 응답자에게 알맞은 문구로 변환함
5. 속도 제한(Vercel Firewall 속도 제한 규칙 등)과 본문 크기 제한(20KB)을 둠. IP·User-Agent는 저장하지 않음.

### 5.2 마감 자동 처리
1. Vercel Cron이 매시간 `/api/cron/close-surveys` 호출(`Authorization: Bearer $CRON_SECRET` 확인)
2. `close_expired_surveys()` 실행 → 방금 닫힌 설문 목록 반환
3. 각 설문의 결과 요약(수치만)을 담당자 메일로 발송하고 `closed_notified_at`을 기록함. 이미 기록된 설문은 재발송하지 않음.
4. 응답 차단은 크론과 무관하게 `submit_response`의 마감 확인으로 즉시 이루어짐.

### 5.3 대시보드
- `rpc('dashboard_rows', { min_n: 5 })`를 직원 세션으로 호출함. 5건 미만이면 분포가 `null`로 오며, 클라이언트는 '표시하지 않음' 안내를 보여 줌.
- 연도별 추이는 `program`이 같은 행을 연도별로 합산해 클라이언트에서 계산함. (`reference/Dashboard.html`의 계산 로직 참고)

## 6. 권한 매트릭스

| 동작 | anon | viewer | admin | service_role(서버) |
|---|:---:|:---:|:---:|:---:|
| 설문·응답 테이블 직접 접근 | 불가 | 불가 | 설문 전체, 응답 읽기·삭제 | 전체 |
| 응답 제출(함수) | 불가 | 불가 | 불가 | 가능(라우트 경유) |
| 대시보드 집계 함수 | 불가 | 가능 | 가능 | 가능 |
| 설계 세션 | 불가 | 불가 | 본인 것 | 전체 |
| 역할 변경 | 불가 | 불가 | 가능 | 가능 |

이 표는 `supabase/tests/rls.test.mjs`가 검증하는 시나리오와 같음. 마이그레이션을 수정하면 시험을 반드시 다시 실행함.

## 7. 환경변수

`.env.example` 참조. 서버 전용 값(`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `CRON_SECRET`, `RESEND_API_KEY`)에는 `NEXT_PUBLIC_`을 붙이지 않음.

## 8. 기존 Apps Script 프로토타입과의 관계

- `reference/`의 프로토타입은 같은 규칙으로 이미 시험을 마친 동작 사양임. 새 구현이 완료되면 대체하며, 그 전까지는 임시 운영 수단으로 쓸 수 있음.
- 프로토타입의 응답 데이터(구글 시트)는 이관 대상이 아님. 신규 설문부터 새 사이트에서 진행하는 것을 전제로 함.
