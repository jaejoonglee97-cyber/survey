import { LIMITS, MULTI_SEP, type Question, type SurveySpec } from "./spec";

// 응답 검증·정규화. 프로토타입 buildRow_ 와 같은 규칙.
// 결과 row 는 문항 순서의 셀 문자열 배열(응답 탭에 그대로 한 행으로 저장).

/** 스프레드시트 수식 주입 방지: = + - @ 로 시작하면 앞에 ' 를 붙임 */
export function safeCell(v: unknown): string {
  const s = String(v ?? "");
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/** safeCell 로 붙인 ' 를 되돌림(집계·화면 표시용) */
export function unsafeCell(v: unknown): string {
  const s = String(v ?? "");
  return /^'[=+\-@]/.test(s) ? s.slice(1) : s;
}

/** 제어 문자 제거, 앞뒤 공백 제거, 길이 제한 */
export function cleanText(v: unknown, max: number): string {
  return String(v ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, max);
}

/** 선택값 하나가 보기에 해당하는지 확인하고 정규화된 문자열을 돌려줌. 해당 없으면 null. */
export function matchOption(q: Question, value: unknown): string | null {
  const v = String(value ?? "");
  for (const o of q.options ?? []) {
    if (v === o.label) {
      if (o.other) return null; // 직접입력 보기는 내용 입력이 필수임
      return o.label;
    }
    if (o.other && v.startsWith(o.label + ": ")) {
      const t = cleanText(v.slice(o.label.length + 2).replace(/\|/g, "/"), LIMITS.maxOtherAnswer);
      if (!t) return null;
      return o.label + ": " + t;
    }
  }
  return null;
}

export type RawAnswers = Record<string, unknown>;
export type NormalizeResult = { ok: true; row: string[] } | { ok: false; error: string; questionId?: string };

export function normalizeAnswers(spec: Pick<SurveySpec, "questions">, answers: unknown): NormalizeResult {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return { ok: false, error: "응답 형식이 올바르지 않음" };
  }
  const a0 = answers as RawAnswers;
  const row: string[] = [];
  for (const q of spec.questions) {
    const a = Object.prototype.hasOwnProperty.call(a0, q.id) ? a0[q.id] : undefined;
    const fail = (error: string): NormalizeResult => ({ ok: false, error, questionId: q.id });
    const empty = a === undefined || a === null || a === "" || (Array.isArray(a) && a.length === 0);
    if (empty) {
      if (q.required) return fail(q.id + "번 문항은 필수 응답임");
      row.push("");
      continue;
    }
    let cell: string;
    if (q.type === "single") {
      if (Array.isArray(a)) return fail(q.id + ": 하나만 선택할 수 있음");
      const m = matchOption(q, a);
      if (m === null) return fail(q.id + ": 올바르지 않은 선택값임");
      cell = m;
    } else if (q.type === "multi") {
      if (!Array.isArray(a)) return fail(q.id + ": 복수 선택 형식이 올바르지 않음");
      const vals: string[] = [];
      for (const item of a) {
        const mv = matchOption(q, item);
        if (mv === null) return fail(q.id + ": 올바르지 않은 선택값임");
        if (!vals.includes(mv)) vals.push(mv);
      }
      if (q.max && vals.length > q.max) return fail(q.id + ": 최대 " + q.max + "개까지 선택할 수 있음");
      cell = vals.join(MULTI_SEP);
    } else if (q.type === "scale5") {
      if (typeof a !== "number" && typeof a !== "string") return fail(q.id + ": 1~5 사이 값이어야 함");
      const n = Number(a);
      if (!(n >= 1 && n <= 5 && Math.floor(n) === n)) return fail(q.id + ": 1~5 사이 값이어야 함");
      cell = String(n);
    } else {
      if (typeof a !== "string") return fail(q.id + ": 서술 응답 형식이 올바르지 않음");
      cell = safeCell(cleanText(a, LIMITS.maxTextAnswer));
      if (q.required && cell === "") return fail(q.id + "번 문항은 필수 응답임");
    }
    row.push(cell);
  }
  return { ok: true, row };
}
