// 연결 확인(읽기 전용): npm run sheets:check
// 데이터 저장소를 열 수 있는지, 탭과 머리글이 계획대로인지 보고함. 아무것도 쓰지 않음.
import { looksLikeDummyTitle } from "../src/lib/sheets/config";
import { createBackend } from "../src/lib/sheets/backend";
import { SurveyStore } from "../src/lib/store/survey-store";

async function main() {
  const backend = createBackend(process.env);
  console.log(`저장 방식: ${backend.kind}, 환경: ${backend.env}`);
  const title = await backend.gateway.title();
  const tabs = await backend.gateway.listTabs();
  console.log(`연결 성공: "${title}" (탭 ${tabs.length}개: ${tabs.join(", ") || "없음"})`);

  if (backend.env === "dummy" && !looksLikeDummyTitle(title)) {
    console.warn("주의: 더미 환경인데 시트 제목에 '더미' 표시가 없음. 운영 시트를 가리키고 있지 않은지 확인할 것.");
  }

  const store = new SurveyStore(backend.gateway, { cacheMs: 0 });
  let problems = 0;
  for (const p of await store.planTabs()) {
    if (p.action === "ok") console.log(`  [정상] ${p.tab}`);
    else if (p.action === "create") console.log(`  [없음] ${p.tab} → npm run sheets:init 로 만들 수 있음`);
    else if (p.action === "write_header") console.log(`  [머리글 없음] ${p.tab} → npm run sheets:init`);
    else {
      problems++;
      console.log(`  [불일치] ${p.tab}\n    기대: ${p.expected.join(", ")}\n    실제: ${p.actual.join(", ")}`);
    }
  }
  if (!problems && tabs.includes("surveys")) {
    const list = await store.listSurveys();
    console.log(`  설문 ${list.length}건`);
  }
  if (problems) process.exitCode = 1;
}

main().catch((err: unknown) => {
  // 구글 오류 객체에는 요청 정보가 들어 있을 수 있어 메시지만 출력함
  const e = err as { code?: number; message?: string };
  if (e.code === 403) console.error("권한 없음(403): 스프레드시트를 서비스 계정 이메일에 '편집자'로 공유했는지 확인할 것.");
  else if (e.code === 404) console.error("찾을 수 없음(404): GOOGLE_SHEETS_ID 를 확인할 것.");
  else console.error(`실패: ${e.message ?? String(err)}`);
  process.exitCode = 1;
});
