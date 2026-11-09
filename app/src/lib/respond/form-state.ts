import type { Question, RawAnswers } from "../survey-core";

// 응답 폼의 상태와 규칙(화면과 분리한 순수 함수). 프로토타입 Respondent.html 의 상호작용을 옮김:
// 복수 선택 개수 제한, 직접입력 칸, 필수 검증, 진행률.

export interface QuestionState {
  /** 선택한 보기 번호(single 은 0~1개) */
  selected: number[];
  /** 직접입력 보기 번호 → 입력한 내용 */
  other: Record<number, string>;
  scale: number | null;
  text: string;
}

export type FormState = Record<string, QuestionState>;

export const emptyQuestionState = (): QuestionState => ({ selected: [], other: {}, scale: null, text: "" });

export function initialFormState(questions: Question[]): FormState {
  return Object.fromEntries(questions.map((q) => [q.id, emptyQuestionState()]));
}

/** 보기 선택·해제. 복수 선택은 최대 개수를 넘기지 않음 */
export function toggleOption(q: Question, s: QuestionState, idx: number): QuestionState {
  if (q.type === "single") return { ...s, selected: [idx] };
  if (s.selected.includes(idx)) return { ...s, selected: s.selected.filter((i) => i !== idx) };
  if (q.max && s.selected.length >= q.max) return s;
  return { ...s, selected: [...s.selected, idx].sort((a, b) => a - b) };
}

/** 복수 선택에서 더 고를 수 없어 비활성화할 보기인지 */
export function isOptionDisabled(q: Question, s: QuestionState, idx: number): boolean {
  return q.type === "multi" && !!q.max && !s.selected.includes(idx) && s.selected.length >= q.max;
}

type Read = { kind: "empty" } | { kind: "bad_other" } | { kind: "ok"; value: unknown };

export function readAnswer(q: Question, s: QuestionState): Read {
  if (q.type === "text") {
    const v = s.text.trim();
    return v ? { kind: "ok", value: v } : { kind: "empty" };
  }
  if (q.type === "scale5") return s.scale ? { kind: "ok", value: s.scale } : { kind: "empty" };
  if (!s.selected.length) return { kind: "empty" };
  const vals: string[] = [];
  for (const i of s.selected) {
    const o = q.options?.[i];
    if (!o) continue;
    if (o.other) {
      const t = (s.other[i] ?? "").trim();
      if (!t) return { kind: "bad_other" };
      vals.push(`${o.label}: ${t}`);
    } else vals.push(o.label);
  }
  if (!vals.length) return { kind: "empty" };
  return { kind: "ok", value: q.type === "single" ? vals[0] : vals };
}

export interface FormProblem {
  questionId: string;
  kind: "required" | "other";
}

export function collectAnswers(questions: Question[], state: FormState): { answers: RawAnswers; problems: FormProblem[] } {
  const answers: RawAnswers = {};
  const problems: FormProblem[] = [];
  for (const q of questions) {
    const r = readAnswer(q, state[q.id] ?? emptyQuestionState());
    if (r.kind === "bad_other") problems.push({ questionId: q.id, kind: "other" });
    else if (r.kind === "empty") {
      if (q.required) problems.push({ questionId: q.id, kind: "required" });
    } else answers[q.id] = r.value;
  }
  return { answers, problems };
}

export function answeredCount(questions: Question[], state: FormState): number {
  return questions.filter((q) => readAnswer(q, state[q.id] ?? emptyQuestionState()).kind === "ok").length;
}

/** 오류 안내 한 줄(가장 먼저 걸린 문제 기준) */
export function problemMessage(problems: FormProblem[]): string {
  if (!problems.length) return "";
  return problems[0].kind === "other"
    ? "‘직접 입력’을 선택한 문항은 내용을 적어 주십시오."
    : "필수 문항에 응답해 주십시오.";
}
