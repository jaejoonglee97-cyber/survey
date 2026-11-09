# 서사협 만족도 설문 앱

구성 계획은 상위 폴더의 `../PLAN.md`, 원 설계 자료는 `../survey-platform-handoff/` 에 있음.

## 명령어

```
npm run dev            # 개발 서버 (http://localhost:3000)
npm test               # Vitest
npm run test:coverage  # 커버리지(survey-core 90% 미만이면 실패)
npm run typecheck      # 타입 검사
npm run lint           # 린트
npm run check:secrets  # 비밀 값 노출 검사 (npm run build 뒤에 실행하면 빌드 결과까지 검사)
npm run sheets:check   # 스프레드시트 연결 확인(읽기만 함)
npm run sheets:init    # 고정 탭(surveys, staff, summary) 만들기. 기존 데이터는 덮어쓰지 않음
npm run seed:dummy     # 더미 설문 5건·응답·직원 넣기 (-- --reset 으로 비우고 다시, -- --admin 내이메일 로 담당자 추가)
```

## 시트 없이 개발하기 (로컬 모드)

`.env.local` 에 `DATA_BACKEND=local` 만 넣으면 구글 시트 대신 `app/.local-data/sheets.json` 파일을 씀(시트와 같은 탭 구조). 배포 환경(Vercel)에서는 이 모드가 거부됨.

```
npm run seed:dummy
npm run sheets:check
```

## 더미 스프레드시트 연결 (단계 0, 처음 한 번)

개발에는 **더미 스프레드시트만** 씀. 운영 시트는 보안 점검(단계 7)이 끝난 뒤 Vercel Production 환경변수에만 넣음.

### 1. 구글 클라우드 프로젝트와 서비스 계정

가능하면 **협회(기관) 구글 계정**으로 진행함. 개인 Gmail 계정은 피함.

1. https://console.cloud.google.com 에서 새 프로젝트를 만듦(예: `sasw-survey`).
2. 'API 및 서비스 → 라이브러리'에서 **Google Sheets API** 를 사용 설정함. (Drive API는 필요 없음)
3. 'IAM 및 관리자 → 서비스 계정'에서 서비스 계정을 만듦(예: `survey-bot`). **역할은 부여하지 않음**(시트 공유로만 권한을 줌).
4. 만든 서비스 계정 → '키' → '키 추가 → 새 키 만들기 → JSON'. 내려받은 파일은 **이 폴더 밖**(예: 문서 폴더)에 두고, 아래 값만 옮긴 뒤 안전하게 보관하거나 지움.
   - 조직 정책으로 키 생성이 막혀 있으면 정보보안 담당자에게 문의함.

### 2. 더미 스프레드시트

1. 구글 드라이브(가능하면 협회 공유 드라이브)에 새 스프레드시트를 만들고 제목에 **`[더미]`** 를 넣음. 예: `[더미] 만족도 설문 DB`
   - 제목에 더미 표시가 없으면 `sheets:init` 이 실행을 거부함(운영 시트를 잘못 가리키는 사고 방지).
2. '공유'에서 서비스 계정 이메일(`...@...iam.gserviceaccount.com`)을 **편집자**로 추가함. '링크가 있는 모든 사용자' 공유는 쓰지 않음.

### 3. `.env.local`

`app/.env.example` 을 복사해 `app/.env.local` 을 만들고 채움(이 파일은 git 에 올라가지 않음).

```
DATA_BACKEND=google
GOOGLE_SHEETS_ID=<스프레드시트 URL의 /d/ 와 /edit 사이 값>
SHEETS_ENV=dummy
GOOGLE_SERVICE_ACCOUNT_EMAIL=<JSON 의 client_email>
GOOGLE_PRIVATE_KEY="<JSON 의 private_key 값을 그대로. \n 이 들어 있는 한 줄>"
```

### 4. 확인

```
npm run sheets:check   # "연결 성공" 과 탭 상태가 나옴
npm run sheets:init    # surveys, staff, summary 탭과 머리글을 만듦
npm run sheets:check   # 세 탭이 모두 [정상] 이면 완료
npm run seed:dummy     # 더미 데이터 넣기(시트 제목에 [더미]가 있어야 실행됨)
```

오류가 나면: 403 → 서비스 계정에 공유했는지, 404 → 시트 ID, '형식이 아님' → `.env.local` 값 확인.

## 응답 링크 속도 제한 (배포 시)

`POST /api/s/<slug>/submit` 은 로그인 없는 공개 경로라 Vercel Firewall 에서 속도 제한 규칙을 둠(예: 같은 IP 기준 1분에 20회). 앱 코드는 요청 크기(20KB)·형식(JSON)만 검사하고 IP 는 저장하지 않음. 행사장처럼 같은 와이파이(같은 IP)에서 수십 명이 동시에 응답할 수 있으므로 한도를 너무 낮게 잡지 않음.

## 직원 로그인

- 구글 계정 로그인 + `ALLOWED_EMAIL_DOMAIN`(협회 도메인) + 데이터 시트 `staff` 탭에 등록된 사람만 들어올 수 있음. 도메인 설정이 비어 있으면 아무도 로그인할 수 없음.
- 역할은 `staff` 탭의 `role`(admin=담당자, viewer=열람자)과 `active`(TRUE)로 정함. 역할은 요청마다 시트에서 다시 읽으므로, 시트에서 바꾸거나 `active` 를 FALSE 로 하면 바로 반영됨.
- 열람자는 만족도 대시보드만 볼 수 있음. 담당자 화면·CSV·서버 동작은 서버에서 다시 확인해 막음.
- 로컬 더미 모드(`DATA_BACKEND=local`)의 개발 서버에서만 '개발용 로그인'(admin@example.org / viewer@example.org)이 보임. 배포 환경과 구글 시트 모드에서는 나오지 않음.

구글 로그인 설정(구글 클라우드 콘솔): 'API 및 서비스 → 사용자 인증 정보 → OAuth 클라이언트 ID(웹 애플리케이션)'를 만들고, 승인된 리디렉션 URI에 `http://localhost:3000/api/auth/callback/google`(개발)과 `https://<배포 주소>/api/auth/callback/google`(운영)을 넣음. 동의 화면은 '내부'(협회 Workspace 사용자만)로 둠. 발급된 값을 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` 에 넣음.

## 마감 처리와 결과 메일

- 응답 차단은 제출 순간에 마감 시각을 확인해 바로 이루어짐(크론과 무관).
- `/api/cron/close-surveys` 를 Vercel Cron 이 매시간 호출함(`vercel.json`). `Authorization: Bearer $CRON_SECRET` 이 맞지 않으면 401. `CRON_SECRET` 은 16자 이상.
  - Vercel Hobby 요금제는 크론을 하루 1회만 허용하므로, 매시간 실행하려면 Pro 요금제가 필요함(Hobby 면 `schedule` 을 하루 1회로 바꿈. 결과 메일만 늦어짐).
- 마감된 설문마다 결과 요약 메일을 한 번 보냄(받는 사람: `ADMIN_NOTIFY_EMAIL` + 설문을 만든 담당자). 본문은 수치만 담은 일반 텍스트이며 서술 의견 원문은 싣지 않음. 마감일을 연장했다가 다시 마감되면 다시 보냄. 발송에 실패하면 다음 실행에서 다시 시도함.
- `MAIL_PROVIDER=log`(기본)는 실제로 보내지 않고 서버 로그에 제목만 남김. 실제 발송은 `MAIL_PROVIDER=resend` + `RESEND_API_KEY` + `MAIL_FROM`(Resend 에서 인증한 협회 도메인 주소).
- 로컬에서 수동 실행: `curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/close-surveys`

## 배포 절차 (Vercel)

보안 점검 보고서(`docs/safety-report.md`)의 미통과 항목이 모두 해결되거나 정보보안 담당자의 예외 승인이 있을 때만 배포함.

1. **GitHub**: 이 `app` 폴더를 저장소 루트로 올림(`.env.local`, `.local-data/` 는 `.gitignore` 로 제외됨). 기본 브랜치 보호: `ci` 검사 통과 필수.
2. **Vercel 프로젝트**: 협회 팀 계정에서 GitHub 저장소를 연결. Functions 리전은 `vercel.json` 의 `icn1`(서울).
3. **환경변수**(Settings → Environment Variables). Production 과 Preview 를 반드시 나눔.

   | 이름 | Production | Preview |
   |---|---|---|
   | `DATA_BACKEND` | `google` | `google` |
   | `GOOGLE_SHEETS_ID` | 운영 시트 | **더미 시트** |
   | `SHEETS_ENV` | `production` | `dummy` (Preview 에서 production 이면 앱이 실행을 거부함) |
   | `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` | 운영 서비스 계정 | 더미용 서비스 계정(권장) |
   | `NEXTAUTH_URL` | `https://<운영 주소>` | 비워 둠(Vercel 이 자동 설정) |
   | `NEXTAUTH_SECRET` | 임의 32바이트 | 다른 값 |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth 클라이언트 | 같은 것 또는 별도 |
   | `ALLOWED_EMAIL_DOMAIN` | `sasw.or.kr` | `sasw.or.kr` |
   | `CRON_SECRET` | 임의 16자 이상 | 다른 값 |
   | `MAIL_PROVIDER`, `RESEND_API_KEY`, `MAIL_FROM`, `ADMIN_NOTIFY_EMAIL` | 실제 값 | `MAIL_PROVIDER=log` |
   | `NEXT_PUBLIC_SITE_URL` | `https://<운영 주소>` | 비워 둠 |

   `NEXT_PUBLIC_` 이 붙은 값은 브라우저에 공개되므로 비밀 값을 넣지 않음. `DATA_BACKEND=local` 은 배포 환경에서 실행이 거부됨.
4. **Firewall**: Vercel Firewall 에 `/api/s/` 경로 속도 제한 규칙(예: IP 당 1분 20회).
5. **크론**: 배포 뒤 Settings → Cron Jobs 에 `/api/cron/close-surveys` 가 보이는지 확인(Hobby 요금제는 하루 1회만 가능).
6. **배포 후 점검**
   - 비로그인으로 `/survey` → 로그인 화면, 협회 외 계정 로그인 거부
   - 열람자 계정으로 `/survey/list` → 대시보드로 이동, CSV 주소 → 403
   - `curl https://<주소>/api/cron/close-surveys` → 401
   - 더미 설문 1건 게시 → 휴대전화로 응답 → 몇 분 뒤 마감 → 결과 메일 수신 → 대시보드(5건 미만 숨김) 확인
   - 시범 설문을 삭제(응답이 있으면 시트에서 응답 탭 정리)하고 실제 설문 진행
