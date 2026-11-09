import "server-only";
import { getStore } from "../sheets/client";
import { formatKst } from "../store/survey-store";
import { loadDashboardData, type DashboardData } from "./data";

// 열람자가 여러 명 동시에 열어도 시트를 매번 읽지 않도록 1분 동안 결과를 재사용함(새로고침 버튼은 즉시 갱신).
const TTL_MS = 60_000;
// 새로고침 버튼을 연달아 눌러도 15초 안에는 다시 계산하지 않음(시트 한도 보호)
const MIN_FORCE_MS = 15_000;
let cache: { at: number; data: DashboardData } | null = null;

export async function getDashboardData(force = false): Promise<DashboardData> {
  const now = Date.now();
  if (cache && now - cache.at < (force ? MIN_FORCE_MS : TTL_MS)) return cache.data;
  const data = await loadDashboardData(getStore(), formatKst(new Date(now)));
  cache = { at: now, data };
  return data;
}
