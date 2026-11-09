import type { SurveyRecord, SurveyStore, SummaryRow } from "../store/survey-store";
import { dashboardRows, LIMITS, type DashboardRow } from "../survey-core";

// 대시보드 데이터(서버). 대표 문항 분포만 다루고 서술 의견·문항 원문·개별 응답은 다루지 않음.
// 대표 문항 응답이 5건 미만인 설문은 분포를 지운 채로 화면에 보냄(화면에서 숨기는 것이 아님).
//
// 집계 캐시(summary 탭) 사용 규칙:
//  - 진행 중인 설문: 응답이 계속 들어오므로 매번 응답 탭에서 계산(시트에 쓰지 않음)
//  - 마감된 설문: 마감 뒤에 계산한 캐시가 있으면 그대로 씀. 없거나 마감 전에 계산한 것이면 한 번 다시 계산해 기록

export interface DashboardData {
  rows: DashboardRow[];
  minN: number;
  generatedAt: string;
}

/** 마감된 설문의 캐시가 마감 이후에 계산된 것인지 */
export function summaryIsFinal(rec: Pick<SurveyRecord, "state" | "closedAt" | "spec">, s: SummaryRow | undefined): boolean {
  if (!s || rec.state !== "closed") return false;
  // 실제로 닫힌 시각: 담당자가 직접 마감한 시각과 마감 일시 중 이른 쪽(둘 다 한국시간 문자열)
  const deadlineEnd = `${rec.spec.deadline}:59`;
  const closedAt = rec.closedAt && rec.closedAt < deadlineEnd ? rec.closedAt : deadlineEnd;
  return s.updatedAt >= closedAt;
}

export async function loadDashboardData(store: SurveyStore, generatedAt: string): Promise<DashboardData> {
  const list = (await store.listSurveys()).filter((s) => s.status !== "draft");
  const summaries = await store.readSummaries();
  const rows = await Promise.all(
    list.map(async (rec) => {
      let s = summaries.get(rec.id);
      if (!summaryIsFinal(rec, s)) {
        s = rec.state === "closed" ? await store.refreshSummary(rec) : await store.computeSummary(rec);
      }
      const dist = s?.dist ?? null;
      return {
        slug: rec.spec.slug,
        title: rec.spec.title,
        category: rec.spec.category,
        program: rec.spec.program,
        year: rec.spec.year,
        deadline: rec.spec.deadline,
        state: rec.state,
        target: rec.spec.target,
        n: s?.n ?? 0,
        kpi: dist ? { valid: dist.reduce((a, b) => a + b, 0), dist } : null,
      };
    }),
  );
  return { rows: dashboardRows(rows, LIMITS.dashboardMinN), minN: LIMITS.dashboardMinN, generatedAt };
}
