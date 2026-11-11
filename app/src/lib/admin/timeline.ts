// 응답 현황(시간에 따른 응답 수). 제출 시각은 시(時) 단위로 저장되어 있음('YYYY-MM-DD HH:00').

export interface TimelineBar {
  key: string;
  label: string;
  count: number;
}

export interface Timeline {
  /** 응답이 이틀 안에 모였으면 시간대별, 아니면 날짜별 */
  unit: "hour" | "day";
  bars: TimelineBar[];
  total: number;
  peak: TimelineBar | null;
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}))?/;

function addDays(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const dayLabel = (key: string) => `${Number(key.slice(5, 7))}.${Number(key.slice(8, 10))}`;

export function responseTimeline(submittedAt: string[], maxDays = 31): Timeline {
  const parsed = submittedAt.map((s) => s.match(DAY_RE)).filter((m): m is RegExpMatchArray => !!m);
  const total = parsed.length;
  if (!total) return { unit: "day", bars: [], total: 0, peak: null };

  const days = parsed.map((m) => `${m[1]}-${m[2]}-${m[3]}`).sort();
  const first = days[0];
  const last = days[days.length - 1];
  const spanDays = Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86400_000) + 1;

  let bars: TimelineBar[];
  let unit: Timeline["unit"];
  if (spanDays <= 2) {
    unit = "hour";
    const counts = new Map<string, number>();
    for (const m of parsed) {
      const k = `${m[1]}-${m[2]}-${m[3]} ${m[4] ?? "00"}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const keys = [...counts.keys()].sort();
    // 첫 응답 시각부터 마지막 응답 시각까지 빈 시간대도 채움
    bars = [];
    let cur = keys[0];
    const end = keys[keys.length - 1];
    for (let guard = 0; guard < 48; guard++) {
      bars.push({ key: cur, label: `${spanDays > 1 ? dayLabel(cur.slice(0, 10)) + " " : ""}${Number(cur.slice(11, 13))}시`, count: counts.get(cur) ?? 0 });
      if (cur === end) break;
      const h = Number(cur.slice(11, 13)) + 1;
      cur = h === 24 ? `${addDays(cur.slice(0, 10), 1)} 00` : `${cur.slice(0, 10)} ${String(h).padStart(2, "0")}`;
    }
  } else {
    unit = "day";
    const counts = new Map<string, number>();
    for (const d of days) counts.set(d, (counts.get(d) ?? 0) + 1);
    // 기간이 길면 마지막 maxDays 일만
    const start = spanDays > maxDays ? addDays(last, -(maxDays - 1)) : first;
    bars = [];
    for (let d = start; d <= last; d = addDays(d, 1)) bars.push({ key: d, label: dayLabel(d), count: counts.get(d) ?? 0 });
  }
  const peak = bars.reduce<TimelineBar | null>((p, b) => (!p || b.count > p.count ? b : p), null);
  return { unit, bars, total, peak };
}
