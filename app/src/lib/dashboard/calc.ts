import type { DashboardRow } from "../survey-core";

// 만족도 대시보드 계산(순수 함수). 프로토타입 Dashboard.html 의 계산을 옮김.
// 입력 행은 서버에서 이미 5건 미만 설문의 분포를 지운 것(dist=null)임.

export type Dist = [number, number, number, number, number];

export const sum = (a: readonly number[]) => a.reduce((s, v) => s + v, 0);
export const fmt1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);

export function sumDist(rows: Pick<DashboardRow, "dist">[]): Dist {
  const d: Dist = [0, 0, 0, 0, 0];
  for (const r of rows) if (r.dist) r.dist.forEach((v, i) => (d[i] += v));
  return d;
}

export function meanOf(d: readonly number[]): number | null {
  const n = sum(d);
  return n ? (d[0] + 2 * d[1] + 3 * d[2] + 4 * d[3] + 5 * d[4]) / n : null;
}

export function posOf(d: readonly number[]): number | null {
  const n = sum(d);
  return n ? ((d[3] + d[4]) / n) * 100 : null;
}

/** 눈금 위의 위치(%): 1점 = 0%, 5점 = 100% */
export function rulerPct(mean: number): number {
  return Math.min(100, Math.max(0, ((mean - 1) / 4) * 100));
}

export interface Filter {
  year: number | "all";
  category: string | "all";
}

export function filterOptions(rows: DashboardRow[]): { years: number[]; categories: string[] } {
  return {
    years: [...new Set(rows.map((r) => r.year))].sort((a, b) => b - a),
    categories: [...new Set(rows.map((r) => r.category))].sort(),
  };
}

export interface DashboardView {
  /** 분류만 적용(연도별 추이용) */
  byCategory: DashboardRow[];
  /** 분류 + 연도 적용 */
  inYear: DashboardRow[];
  /** 그중 수치를 공개하는 설문 */
  shown: DashboardRow[];
  summary: { surveys: number; responses: number; mean: number | null; positive: number | null };
  overall: { label: string; mean: number } | null;
  categories: { category: string; surveys: number; responses: number; mean: number; positive: number }[];
  trends: Trend[];
}

export interface Trend {
  program: string;
  points: { year: number; mean: number; n: number }[];
  /** 마지막 두 해의 평균 차이 */
  delta: number;
  deltaText: string;
}

export function deltaText(delta: number): string {
  if (Math.abs(delta) < 0.05) return "전년 대비 변동 없음";
  return `전년 대비 ${delta > 0 ? "+" : "−"}${fmt1(Math.abs(delta))}점`;
}

/** 같은 사업(program)이 2개 연도 이상 공개 수치를 가진 경우의 연도별 평균 */
export function trends(rows: DashboardRow[]): Trend[] {
  const byProg = new Map<string, Map<number, Dist>>();
  for (const r of rows) {
    if (!r.shown || !r.dist) continue;
    const p = byProg.get(r.program) ?? new Map<number, Dist>();
    const cur = p.get(r.year) ?? [0, 0, 0, 0, 0];
    p.set(r.year, cur.map((v, i) => v + r.dist![i]) as Dist);
    byProg.set(r.program, p);
  }
  return [...byProg.entries()]
    .filter(([, years]) => years.size >= 2)
    .sort(([a], [b]) => a.localeCompare(b, "ko"))
    .map(([program, years]) => {
      const points = [...years.entries()].sort(([a], [b]) => a - b).map(([year, d]) => ({ year, mean: meanOf(d)!, n: sum(d) }));
      const delta = points[points.length - 1].mean - points[points.length - 2].mean;
      return { program, points, delta, deltaText: deltaText(delta) };
    });
}

export function buildView(rows: DashboardRow[], f: Filter): DashboardView {
  const byCategory = rows.filter((r) => f.category === "all" || r.category === f.category);
  const inYear = byCategory.filter((r) => f.year === "all" || r.year === f.year);
  const shown = inYear.filter((r) => r.shown && r.dist);
  const dist = sumDist(shown);
  const mean = meanOf(dist);
  const categories =
    f.category === "all"
      ? [...new Set(shown.map((r) => r.category))].sort().map((c) => {
          const rs = shown.filter((r) => r.category === c);
          const d = sumDist(rs);
          return { category: c, surveys: rs.length, responses: sum(d), mean: meanOf(d)!, positive: posOf(d)! };
        })
      : [];
  return {
    byCategory,
    inYear,
    shown,
    summary: { surveys: inYear.length, responses: sum(inYear.map((r) => r.n)), mean, positive: posOf(dist) },
    overall: mean === null ? null : { label: `${f.year === "all" ? "전체 기간" : `${f.year}년`} · ${f.category === "all" ? "전체 분류" : f.category}`, mean },
    categories,
    trends: trends(byCategory),
  };
}

/** 추이 그래프 좌표(SVG viewBox 260×96) */
export function trendPath(points: { mean: number }[], W = 260, H = 96): { x: number; y: number }[] {
  const padX = 30;
  const top = 26;
  const bot = 22;
  const ms = points.map((p) => p.mean);
  let lo = Math.max(1, Math.min(...ms) - 0.4);
  let hi = Math.min(5, Math.max(...ms) + 0.4);
  if (hi - lo < 0.8) {
    lo = Math.max(1, lo - 0.4);
    hi = Math.min(5, hi + 0.4);
  }
  const n = points.length;
  return points.map((p, i) => ({
    x: n === 1 ? W / 2 : padX + (i * (W - 2 * padX)) / (n - 1),
    y: top + ((hi - p.mean) / (hi - lo)) * (H - top - bot),
  }));
}
