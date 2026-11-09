import path from "node:path";
import { readSheetsConfig } from "./config";
import type { SheetsGateway } from "./gateway";
import { createSheetsApi } from "./google";
import { GoogleGateway } from "./google-gateway";
import { MemoryGateway } from "./memory-gateway";

// 데이터 저장 방식 선택.
//   DATA_BACKEND=google (기본): 구글 스프레드시트. GOOGLE_* 값 필요
//   DATA_BACKEND=local       : 이 PC의 JSON 파일(.local-data/sheets.json). 시트 준비 전 개발용. Vercel 에서는 거부

export type Backend = { kind: "google"; env: "dummy" | "production"; gateway: SheetsGateway } | { kind: "local"; env: "dummy"; gateway: SheetsGateway; filePath: string };

export const LOCAL_DATA_FILE = path.join(".local-data", "sheets.json");

export function createBackend(env: Record<string, string | undefined>, cwd = process.cwd()): Backend {
  const kind = (env.DATA_BACKEND ?? "google").trim();
  if (kind === "local") {
    if (env.VERCEL) throw new Error("DATA_BACKEND=local 은 로컬 개발 전용임. 배포 환경에서는 쓸 수 없음");
    const filePath = path.resolve(cwd, LOCAL_DATA_FILE);
    return { kind: "local", env: "dummy", gateway: new MemoryGateway(filePath), filePath };
  }
  if (kind !== "google") throw new Error(`DATA_BACKEND 값이 올바르지 않음(google 또는 local): ${kind}`);
  const config = readSheetsConfig(env);
  // Preview(미리보기) 배포는 더미 시트에만 연결함(운영 데이터를 미리보기 주소로 노출하지 않게)
  if (env.VERCEL_ENV && env.VERCEL_ENV !== "production" && config.env === "production") {
    throw new Error("운영 시트(SHEETS_ENV=production)는 Production 배포에서만 쓸 수 있음. Preview 환경변수를 더미 시트로 설정할 것");
  }
  return { kind: "google", env: config.env, gateway: new GoogleGateway(createSheetsApi(config), config.spreadsheetId) };
}
