// 탭 준비: npm run sheets:init
// 없는 고정 탭(surveys, staff, summary)을 만들고 빈 탭에 머리글을 씀.
// 이미 있는 데이터·머리글은 덮어쓰지 않음. 운영 시트에는 --production 플래그가 있어야 실행됨.
import { looksLikeDummyTitle } from "../src/lib/sheets/config";
import { createBackend } from "../src/lib/sheets/backend";
import { SurveyStore } from "../src/lib/store/survey-store";

async function main() {
  const backend = createBackend(process.env);
  const title = await backend.gateway.title();

  if (backend.env === "production" && !process.argv.includes("--production")) {
    throw new Error("운영 시트(SHEETS_ENV=production)에는 --production 플래그를 붙여야 실행됨");
  }
  if (backend.env === "dummy" && !looksLikeDummyTitle(title)) {
    throw new Error(`더미 환경인데 시트 제목("${title}")에 '더미' 표시가 없어 중단함. 제목에 [더미]를 붙일 것`);
  }

  const plan = await new SurveyStore(backend.gateway, { cacheMs: 0 }).ensureTabs();
  for (const p of plan) {
    const label = { ok: "그대로 둠", create: "새로 만듦", write_header: "머리글 씀", mismatch: "불일치(손대지 않음)" }[p.action];
    console.log(`  ${p.tab}: ${label}`);
  }
  if (plan.some((p) => p.action === "mismatch")) process.exitCode = 1;
}

main().catch((err: unknown) => {
  const e = err as { code?: number; message?: string };
  if (e.code === 403) console.error("권한 없음(403): 스프레드시트를 서비스 계정 이메일에 '편집자'로 공유했는지 확인할 것.");
  else console.error(`실패: ${e.message ?? String(err)}`);
  process.exitCode = 1;
});
