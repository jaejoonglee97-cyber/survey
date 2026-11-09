// 마감 시각 해석과 설문 상태 판정. 모든 시각은 한국시간(+09:00) 기준.

const DEADLINE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/;

const pad2 = (n: number) => (n < 10 ? "0" : "") + n;

function parts(s: unknown): { y: number; mo: number; d: number; hh: number; mm: number } | null {
  const m = String(s ?? "").trim().match(DEADLINE_RE);
  if (!m) return null;
  const hh = m[4] === undefined ? 23 : parseInt(m[4], 10);
  const mm = m[5] === undefined ? 59 : parseInt(m[5], 10);
  if (hh > 23 || mm > 59) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  // 존재하지 않는 날짜(예: 2월 31일)는 Date 가 다음 달로 넘겨 버리므로 직접 확인함
  const chk = new Date(Date.UTC(y, mo - 1, d));
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d) return null;
  return { y, mo, d, hh, mm };
}

/**
 * 'YYYY-MM-DD' 또는 'YYYY-MM-DD HH:mm' → 접수가 끝나는 순간(Date).
 * 날짜만 있으면 23:59. 표기한 '분'이 끝날 때(:59.999)까지 접수함.
 */
export function parseDeadline(s: unknown): Date | null {
  const p = parts(s);
  if (!p) return null;
  const iso = `${p.y}-${pad2(p.mo)}-${pad2(p.d)}T${pad2(p.hh)}:${pad2(p.mm)}:59.999+09:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 마감일 문자열을 'YYYY-MM-DD HH:mm' 로 통일함. 해석 불가 시 null. */
export function normalizeDeadline(s: unknown): string | null {
  const p = parts(s);
  if (!p) return null;
  return `${p.y}-${pad2(p.mo)}-${pad2(p.d)} ${pad2(p.hh)}:${pad2(p.mm)}`;
}

export type SurveyStatus = "draft" | "open" | "closed";

/** 현재 시각 기준 실제 상태. 마감 시각이 지났으면 저장된 상태와 관계없이 closed. */
export function effectiveState(status: SurveyStatus, deadline: string, now: Date = new Date()): SurveyStatus {
  if (status === "draft") return "draft";
  if (status === "closed") return "closed";
  const d = parseDeadline(deadline);
  if (!d) return "closed";
  return now.getTime() > d.getTime() ? "closed" : "open";
}

/** 한국시간 기준 현재 연도 */
export function koreaYear(now: Date = new Date()): number {
  return new Date(now.getTime() + 9 * 3600 * 1000).getUTCFullYear();
}
