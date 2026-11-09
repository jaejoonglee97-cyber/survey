import { koreaYear, parseDeadline, pct, type SurveyStatus } from "../survey-core";

// 설문 홈·목록에 쓰는 계산(순수 함수)

export interface OverviewItem {
  id: string;
  title: string;
  slug: string;
  category: string;
  program: string;
  year: number;
  deadline: string;
  target?: number;
  state: SurveyStatus;
  responses: number;
}

/** 마감까지 남은 날(한국 날짜 기준). 오늘 마감이면 0, 지났으면 음수 */
export function daysLeft(deadline: string, now: Date): number | null {
  const d = parseDeadline(deadline);
  if (!d) return null;
  const day = (t: number) => Math.floor((t + 9 * 3600 * 1000) / 86400_000);
  return day(d.getTime()) - day(now.getTime());
}

export function dLabel(n: number | null): string {
  if (n === null) return "";
  if (n === 0) return "D-day";
  return n > 0 ? `D-${n}` : `D+${-n}`;
}

export function responseRate(responses: number, target?: number): number | null {
  return target ? pct(responses, target) : null;
}

export interface HomeStats {
  openCount: number;
  closingThisWeek: number;
  yearResponses: number;
  year: number;
  closingSoon: (OverviewItem & { days: number })[];
  recentClosed: OverviewItem[];
}

export function homeStats(items: OverviewItem[], now: Date): HomeStats {
  const year = koreaYear(now);
  const open = items.filter((i) => i.state === "open");
  const withDays = open
    .map((i) => ({ ...i, days: daysLeft(i.deadline, now) ?? 0 }))
    .sort((a, b) => (a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0));
  return {
    year,
    openCount: open.length,
    closingThisWeek: withDays.filter((i) => i.days >= 0 && i.days <= 7).length,
    yearResponses: items.filter((i) => i.year === year).reduce((s, i) => s + i.responses, 0),
    closingSoon: withDays.slice(0, 5),
    recentClosed: items
      .filter((i) => i.state === "closed")
      .sort((a, b) => (a.deadline < b.deadline ? 1 : -1))
      .slice(0, 3),
  };
}

/** 목록 정렬: 진행 중(마감 가까운 순) → 초안 → 마감(최근 순) */
export function sortForList(items: OverviewItem[]): OverviewItem[] {
  const rank = { open: 0, draft: 1, closed: 2 } as const;
  return [...items].sort((a, b) => {
    if (rank[a.state] !== rank[b.state]) return rank[a.state] - rank[b.state];
    if (a.state === "open") return a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0;
    return a.deadline < b.deadline ? 1 : a.deadline > b.deadline ? -1 : 0;
  });
}
