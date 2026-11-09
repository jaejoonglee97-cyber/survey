# 05. Claude Code 단계별 지시문

사용법: 이 폴더를 기존 사이트 저장소의 `docs/survey/` 또는 저장소 루트 옆에 두고, Claude Code를 저장소 루트에서 실행함. 아래 지시문을 **한 단계씩** 붙여 넣음. 각 단계는 완료 기준을 통과한 뒤 다음으로 넘어감. 단계 사이에 `git commit`과 변경 요약 확인을 권장함.

공통 머리말(매 단계 앞에 붙여도 되고, `CLAUDE.md`가 이미 읽히면 생략 가능):

```text
CLAUDE.md와 docs/ 를 먼저 읽고 그 규칙을 지킬 것. 이번 단계 범위 밖의 파일은 건드리지 말 것.
작업 전에 계획을 짧게 보고하고, 끝나면 변경 파일 목록과 시험 결과를 요약할 것.
```

---

## Phase 0. 저장소 파악 (읽기 전용)

```text
기존 저장소를 읽기만 하고 아무것도 수정하지 말 것. 아래를 조사해 docs/00-repo-audit.md 로 정리할 것.
1) 프레임워크·버전(Next.js App Router 여부), 패키지 매니저, 스타일링 방식, 아이콘·UI 라이브러리
2) 레이아웃 구조: 사이드바·상단바·페이지 머리·통계 카드·배너 컴포넌트가 이미 있는지, 위치와 props
3) 인증·권한 방식(로그인 방법, 역할 구분 유무), 미들웨어
4) Supabase 사용 여부(프로젝트, 마이그레이션 폴더, 클라이언트 생성 코드), Google Sheets 연동 방식
5) 환경변수 목록(값은 적지 말고 이름만), 배포 설정(vercel.json, 리전)
6) 디자인 토큰이 있는지(색·반경·서체). 있으면 docs/04-design-system.md 의 값과 차이를 표로 정리
7) docs/01-prd.md 8절 '결정이 필요한 사항' 5개에 대해 저장소에서 확인되는 사실과 권장안
그리고 docs/ 의 가정과 실제가 다른 점, 내가 결정해야 할 질문을 목록으로 보고할 것.
```

완료 기준: `docs/00-repo-audit.md` 작성, 사람이 결정할 질문 목록 확정.

---

## Phase 1. 데이터베이스

```text
설문 전용 Supabase 프로젝트를 쓰는 것을 전제로 supabase/migrations/0001_init.sql 을 저장소에 추가하고
로컬 Supabase(supabase start)에 적용할 것. 마이그레이션 내용은 약화시키지 말 것.
1) supabase/tests/rls.test.mjs 의 시나리오를 저장소의 시험 환경(Vitest + 로컬 DB 또는 PGlite)으로 옮겨 자동 시험으로 만들 것.
2) supabase/seed.sql 에 더미 데이터를 만들 것: 설문 4건(2025·2026년 같은 사업명 2건 포함), 설문당 3~60건의 임의 응답, 이름·연락처 등 실제로 보이는 값은 쓰지 말 것.
3) 타입 생성(supabase gen types)을 설정하고 npm 스크립트로 묶을 것.
시험 전체가 통과해야 완료임.
```

완료 기준: RLS 시험 10개 통과(익명 접근 불가, 열람자는 응답 원자료 불가, 대시보드 5건 미만 비공개, 마감 후 제출 거부 등), 시드 적용 성공.

---

## Phase 2. survey-core (순수 TypeScript 라이브러리)

```text
reference/Survey.gs 와 reference/survey.test-cases.js 를 참고해 src/lib/survey-core/ 를 TypeScript(strict)로 구현할 것.
docs/02-architecture.md 4절의 SurveySpec·Question 타입과 zod 스키마를 정의하고, 다음 함수를 만들 것.
- validate.ts: validateDraft(spec) → 오류·확인 사항 목록. 규칙과 코드명은 docs/03-builder-chat.md 5절을 따를 것(PII_QUESTION, NO_KPI 등 포함)
- answers.ts: normalizeAnswers(spec, raw) → 검증된 응답. Survey.gs 의 buildRow_ 규칙(보기 외 값 거부, 복수 선택 개수, 직접입력, 5점 정수, 서술 1000자 제한, 수식 주입 방어)을 동일하게 구현
- aggregate.ts: aggregate(spec, answers[]) → 선택형 건수·비율, 5점 분포·평균·긍정 비율(4~5점), 서술 목록
- report.ts: buildReportLines(spec, agg, target) → 공문서 명사형 문안. 출력이 reference 의 시험이 기대하는 문장과 같아야 함
- import-md.ts: md 문항 파일 가져오기·내보내기(선택 기능). reference/samples/*.md 를 해석해야 함
reference/survey.test-cases.js 의 모든 사례를 Vitest 로 옮기고, 새 규칙(PII_QUESTION 등) 시험을 추가할 것.
프레임워크나 DB 에 의존하지 않는 순수 함수여야 함.
```

완료 기준: 시험 통과(기존 프로토타입 사례 전부 + 신규 규칙), 샘플 md 2개가 오류 없이 해석됨, 커버리지 90% 이상.

---

## Phase 3. 응답 흐름 (공개)

```text
응답자용 공개 경로를 구현할 것. docs/02-architecture.md 5.1 과 docs/04-design-system.md 5.6 을 따를 것.
1) src/app/(public)/s/[slug]/page.tsx : 서버 컴포넌트가 service_role 클라이언트(server-only)로 진행 중이고 마감 전인 설문을 읽어 문항만 전달할 것.
   대상 인원, 작성자, 내부 id 등은 전달하지 말 것. 마감·없는 링크·완료 화면 포함.
2) 응답 폼 컴포넌트: reference/Respondent.html 의 상호작용을 옮길 것(복수 선택 개수 제한, 직접입력 칸, 필수 검증, 진행 막대, 이중 제출 방지).
   모든 문구는 텍스트로만 렌더링할 것.
3) POST /api/s/[slug]/submit : 본문 20KB 제한 → survey-core 로 검증 → rpc('submit_response'). 결과 코드(ok|closed|invalid|full)를 알맞은 상태 코드·문구로 변환.
   IP·User-Agent 는 저장하지 않을 것. 속도 제한은 Vercel Firewall 규칙을 쓸 수 있도록 문서화하고, 코드에서는 요청 크기·형식 검증을 할 것.
4) Playwright 또는 Vitest 로 시험: 정상 제출, 마감 후 제출 거부, 필수 누락 거부, 보기 외 값 거부, HTML 주입 문자열이 텍스트로만 표시됨.
```

완료 기준: 시험 통과, 360px 폭에서 가로 스크롤 없음, 키보드만으로 제출 가능.

---

## Phase 4. 담당자 화면 (목록·결과)

```text
담당자용 화면을 기존 레이아웃 안에 추가할 것(Phase 0 에서 파악한 Sidebar·PageHeader·StatCard 재사용).
사이드바에 '만족도 설문' 그룹을 추가: 설문 홈, 설문 목록, 새 설문, 만족도 대시보드(열람자에게는 대시보드만 표시).
1) /survey (홈), /survey/list, /survey/[id]/results 를 docs/04-design-system.md 5절 구성대로 구현
2) 목록의 작업: 링크 복사, 마감일 변경, 지금 마감(2단계 확인), 삭제(응답 0건일 때만)
3) 결과: 선택형 막대, 5점 분포·평균·긍정 비율, 서술 목록, 응답률, '결과보고서 문안(초안)' 복사, CSV 내려받기(담당자만, 수식 주입 방어 포함)
4) 모든 서버 동작은 admin 역할을 서버에서 다시 확인할 것(화면 숨김만으로 권한을 대신하지 말 것)
5) 권한 시험: 열람자·비로그인 사용자가 담당자 경로와 API 에 접근하면 거부됨
```

완료 기준: 더미 시드 기준으로 목록·결과가 올바르게 표시, 권한 시험 통과.

---

## Phase 5. 대시보드

```text
/survey/dashboard 를 구현할 것. reference/dashboard-preview.html 의 구성과 계산 로직(눈금자, 분포 막대, 연도별 추이, 필터, 5건 미만 비공개 안내)을
React 컴포넌트로 옮기고, 데이터는 rpc('dashboard_rows') 로 받을 것.
- 색은 docs/04-design-system.md 1절의 눈금 색 띠를 쓸 것
- 필터(연도·분류)는 클라이언트 상태, 연도별 추이는 program 이 같은 행을 연도별로 합산해 계산
- 열람자와 담당자 모두 접근 가능, 서술 의견·개별 응답은 어떤 경로로도 전달되지 않을 것
- 인쇄 스타일과 360px/1280px 반응형 확인
계산 함수(평균, 긍정 비율, 추이 증감)는 survey-core 또는 별도 순수 함수로 분리해 시험할 것.
```

완료 기준: 시드 데이터로 화면 표시, 5건 미만 설문의 수치가 응답에 포함되지 않음을 네트워크 응답으로 확인, 계산 시험 통과.

---

## Phase 6. 대화형 설문 설계

```text
docs/03-builder-chat.md 를 그대로 구현할 것.
1) src/lib/builder/: prompt.ts(3절 시스템 프롬프트 그대로), tools.ts(4절 도구 정의), apply-tool.ts(도구 실행·검증), stream.ts(SSE)
2) POST /api/builder/chat : 6절 흐름. 모델은 환경변수 ANTHROPIC_MODEL(기본 claude-sonnet-5-5). API 키는 서버 전용.
   admin 만 호출 가능, 사용자별 시간당 30건 제한, 본문 20KB 제한, 도구 호출 반복 8회 제한, 로그에는 대화 내용을 남기지 말 것.
3) 화면 /survey/new, /survey/[id]/edit : docs/04-design-system.md 5.2 구성(대화 + 실시간 초안 + 점검 패널 + 기본 정보 폼).
   초안 직접 편집(수정·순서 변경·삭제·추가) 지원, 'AI 보조 작성 · 담당자 최종 검토' 표시, 확정 버튼은 서버 검증 오류가 0일 때만 활성.
4) 이메일·전화번호 형식 문자열이 입력되면 전송 전에 경고하고 마스킹할 것.
5) 시험: docs/03-builder-chat.md 8절의 '코드' 종류 사례를 단위 시험으로, '모델' 종류 사례는 녹화 응답 또는 평가 스크립트로 구성.
   Anthropic API 호출은 시험에서 모킹하고, 실제 호출 시험은 별도 수동 스크립트(npm run eval:builder)로 분리할 것.
AI 가 게시·마감·삭제를 하는 도구는 만들지 말 것. 서술 의견·응답 원문을 AI 로 보내는 기능은 만들지 말 것.
```

완료 기준: 코드 사례 시험 전부 통과, 수동 평가에서 모델 사례 1·2·3·5·6이 기대대로 동작, 대화로 12문항 이내 설문을 만들어 확정하는 흐름이 더미 데이터로 통과.

---

## Phase 7. 게시·마감·메일

```text
1) 확정 후 게시 설정 화면: 마감일(분 단위, 저장 시 해당 분의 :59.999 로 보정), 링크 복사, QR 코드, 게시 버튼(담당자가 직접 누름)
2) 마감일 연장·조기 마감(지금 마감은 2단계 확인), 마감 후 재개방은 마감일이 미래일 때만
3) GET /api/cron/close-surveys : Authorization: Bearer $CRON_SECRET 확인 → rpc('close_expired_surveys') → 닫힌 설문별 결과 요약(수치만)을 담당자 메일로 발송 → closed_notified_at 기록.
   이미 발송한 설문은 재발송하지 말 것. vercel.json 에 매시간 크론을 등록할 것.
4) 메일 본문에는 서술 의견 원문을 넣지 말 것.
5) 시험: 마감 시각 경계(23:59:30 응답 가능, 00:00:30 거부), 크론 인증 실패 시 401, 중복 발송 방지
```

완료 기준: 위 시험 통과, 로컬에서 크론 라우트를 수동 호출해 메일(로그 출력 또는 시험용 수신함) 확인.

---

## Phase 8. 보안 점검과 배포

```text
docs/06-safety-checklist.md 의 모든 항목을 점검하고 결과를 docs/06-safety-report.md 로 남길 것(항목별 통과·미통과·근거).
1) .env 파일이 git 이력에 없는지, NEXT_PUBLIC_ 변수에 비밀 값이 없는지, 클라이언트 번들에 service_role·Anthropic 키 문자열이 없는지 검사하는 스크립트를 추가할 것(CI 에서 실행)
2) 가장 강한 모델로 코드 보안 검토를 수행: 접근통제 누락, 키 노출, 입력 검증 누락, 인젝션 가능성
3) GitHub Actions: typecheck, lint, test, 보안 검사 스크립트. main 병합 전 필수
4) Vercel: 프로젝트 연결, 환경변수 등록(Production/Preview 분리, Preview 는 더미 Supabase), Functions 리전 icn1, 크론 확인
5) 배포 후 점검 목록을 README 에 정리
미통과 항목이 있으면 배포하지 말고 보고할 것.
```

완료 기준: 안전 점검표 전 항목 통과 또는 사람이 승인한 예외 기록.

---

## Phase 9. 시범 운영

사람이 직접 수행함(Claude Code 작업 아님).

1. 더미 설문 1건을 대화로 만들어 게시하고 본인 휴대전화로 응답
2. 마감 시각을 몇 분 뒤로 설정해 자동 마감과 결과 메일 확인
3. 대시보드에서 열람자 계정으로 수치 확인, 5건 미만 숨김 확인
4. 기관 정보보안 담당자 검토(개인정보 처리방침 문구, 저장 위치, DPA 서명)
5. 시범 설문을 삭제하고 실제 사업의 설문을 진행
