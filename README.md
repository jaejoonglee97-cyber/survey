# 서사협 만족도 설문

서울특별시사회복지사협회 사업·행사 참여자 만족도 설문 앱. 설문을 만들고 링크·QR로 무기명 응답을 받아, 마감 후 결과·보고서 문안·만족도 대시보드를 자동으로 정리함.

| 경로 | 내용 |
|---|---|
| [`app/`](app/) | Next.js 앱(코드·시험·배포 설정). 실행 방법은 [`app/README.md`](app/README.md) |
| [`app/docs/safety-report.md`](app/docs/safety-report.md) | 보안·개인정보 점검 보고서(배포 전 필수 확인) |
| [`PLAN.md`](PLAN.md) | 구성 계획(구글 스프레드시트 저장, Vercel 배포, AI 설계 보류) |
| [`survey-platform-handoff/`](survey-platform-handoff/) | 원 설계 인계 자료(요구사항, 디자인, 프로토타입) |

Vercel 에 연결할 때는 프로젝트의 **Root Directory 를 `app`** 으로 지정함.

> 개발·시험에는 더미 데이터만 씀. 비밀 값(`.env.local`, 서비스 계정 키)은 저장소에 올리지 않음.
