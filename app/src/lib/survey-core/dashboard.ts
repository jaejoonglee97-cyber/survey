import { LIMITS } from "./spec";
import type { SurveyStatus } from "./deadline";

// 대시보드 행. 대표 문항 응답이 minN 건 미만이면 분포를 담지 않음(서버에서 제거해 화면으로 새지 않게 함).
// 서술 의견·문항 원문은 입력에도 출력에도 없음.

export interface DashboardInput {
  slug: string;
  title: string;
  category: string;
  program: string;
  year: number;
  deadline: string;
  state: SurveyStatus;
  target?: number;
  n: number;
  kpi: { valid: number; dist: [number, number, number, number, number] } | null;
}

export interface DashboardRow {
  slug: string;
  title: string;
  category: string;
  program: string;
  year: number;
  deadline: string;
  state: SurveyStatus;
  target: number;
  n: number;
  hasKpi: boolean;
  valid: number;
  shown: boolean;
  dist: [number, number, number, number, number] | null;
}

export function dashboardRows(items: DashboardInput[], minN: number = LIMITS.dashboardMinN): DashboardRow[] {
  return items
    .map((it) => {
      const valid = it.kpi ? it.kpi.valid : 0;
      const shown = !!(it.kpi && valid >= minN);
      return {
        slug: it.slug,
        title: it.title,
        category: it.category,
        program: it.program,
        year: it.year,
        deadline: it.deadline,
        state: it.state,
        target: it.target || 0,
        n: it.n,
        hasKpi: !!it.kpi,
        valid,
        shown,
        dist: shown && it.kpi ? ([...it.kpi.dist] as DashboardRow["dist"]) : null,
      };
    })
    .sort((a, b) => (a.deadline < b.deadline ? 1 : a.deadline > b.deadline ? -1 : 0));
}

/** 분포 → 평균(소수 1자리)과 긍정 비율 */
export function distStats(dist: readonly number[]): { n: number; mean: number; posPct: number } {
  const n = dist.reduce((a, b) => a + b, 0);
  if (!n) return { n: 0, mean: 0, posPct: 0 };
  const sum = dist.reduce((a, c, i) => a + c * (i + 1), 0);
  return { n, mean: Math.round((sum / n) * 10) / 10, posPct: Math.round(((dist[3] + dist[4]) / n) * 1000) / 10 };
}
