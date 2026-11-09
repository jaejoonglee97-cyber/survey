// 더미 데이터 넣기: npm run seed:dummy [-- --reset] [-- --admin 내이메일@도메인]
//   --reset : 기존 데이터를 비우고 다시 넣음(응답 탭 삭제, 고정 탭은 머리글만 남김)
//   --admin : 직원 탭에 담당자(admin)로 추가할 이메일(로그인 시험용)
// 운영 시트(SHEETS_ENV=production)에는 절대 실행되지 않음.
import { readFileSync } from "node:fs";
import path from "node:path";
import { looksLikeDummyTitle } from "../src/lib/sheets/config";
import { createBackend } from "../src/lib/sheets/backend";
import { defaultSeedSurveys, resetData, seedDummy } from "../src/lib/store/seed";

async function main() {
  const args = process.argv.slice(2);
  const backend = createBackend(process.env);
  if (backend.env === "production") throw new Error("운영 시트에는 더미 데이터를 넣을 수 없음");
  const title = await backend.gateway.title();
  if (!looksLikeDummyTitle(title)) throw new Error(`시트 제목("${title}")에 '더미' 표시가 없어 중단함`);
  console.log(`대상: ${backend.kind === "local" ? backend.filePath : `구글 시트 "${title}"`}`);

  if (args.includes("--reset")) {
    await resetData(backend.gateway);
    console.log("기존 데이터를 비움");
  }

  const staff = [
    { email: "admin@example.org", role: "admin" as const },
    { email: "viewer@example.org", role: "viewer" as const },
  ];
  const ai = args.indexOf("--admin");
  if (ai >= 0 && args[ai + 1]) staff.push({ email: args[ai + 1], role: "admin" });

  const fx = (f: string) => readFileSync(path.join(__dirname, "..", "tests", "fixtures", f), "utf8");
  const defs = defaultSeedSurveys(fx("2026-healingcamp.md"), fx("template-event.md"));
  const report = await seedDummy(backend.gateway, defs, { now: new Date(), staff });
  for (const s of report.surveys) console.log(`  ${s.slug.padEnd(14)} ${s.status.padEnd(6)} 응답 ${s.responses}건`);
  console.log(`  직원 ${report.staff}명`);
  console.log("완료");
}

main().catch((err: unknown) => {
  const e = err as { code?: number; message?: string };
  if (e.code === 403) console.error("권한 없음(403): 스프레드시트를 서비스 계정 이메일에 '편집자'로 공유했는지 확인할 것.");
  else console.error(`실패: ${e.message ?? String(err)}`);
  process.exitCode = 1;
});
