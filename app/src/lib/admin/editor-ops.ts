import { koreaYear, nextQuestionId, normalizeDeadline, type Question, type QuestionType, type SurveySpec } from "../survey-core";

// 문항 편집기의 동작(순수 함수). 화면은 이 함수로만 초안을 바꿈.
// 문항 id 는 만들 때 한 번 정하고 바꾸지 않음(응답 열·대표 문항이 id 에 묶임).

export const KPI_LOW = "매우 불만족";
export const KPI_HIGH = "매우 만족";

export function kpiText(name: string): string {
  return `${name.trim() || "(사업·행사명)"}에 대해 전반적으로 만족하십니까?`;
}

function pad2(n: number) {
  return (n < 10 ? "0" : "") + n;
}

/** 오늘부터 14일 뒤 23:59 (한국시간) */
export function defaultDeadline(now: Date): string {
  const k = new Date(now.getTime() + 9 * 3600 * 1000 + 14 * 86400_000);
  return `${k.getUTCFullYear()}-${pad2(k.getUTCMonth() + 1)}-${pad2(k.getUTCDate())} 23:59`;
}

/** 새 설문의 출발점: 대표 만족도 + 핵심 평가 2개 + 추천 의향 + 서술 1개 */
export function starterSpec(now: Date): SurveySpec {
  const deadline = defaultDeadline(now);
  return {
    title: "",
    slug: "",
    category: "행사",
    program: "",
    year: koreaYear(now),
    deadline,
    intro: "참여해 주셔서 감사합니다. 소요 시간은 약 2분이며 무기명으로 진행됩니다.",
    questions: [
      { id: "Q1", type: "scale5", text: kpiText(""), required: true, low: KPI_LOW, high: KPI_HIGH },
      { id: "Q2", type: "scale5", text: "내용(주제·구성)에 만족하십니까?", required: true, low: KPI_LOW, high: KPI_HIGH },
      { id: "Q3", type: "scale5", text: "행사 진행 방식에 만족하십니까?", required: true, low: KPI_LOW, high: KPI_HIGH },
      {
        id: "Q4",
        type: "single",
        text: "다른 동료에게 추천하시겠습니까?",
        required: true,
        options: [{ label: "적극 추천" }, { label: "추천" }, { label: "보통" }, { label: "추천하지 않음" }],
      },
      { id: "Q5", type: "text", text: "개선 의견을 자유롭게 적어 주십시오.", required: false },
    ],
    kpiQuestionId: "Q1",
  };
}

export function blankQuestion(id: string, type: QuestionType): Question {
  switch (type) {
    case "single":
      return { id, type, text: "", required: true, options: [{ label: "" }, { label: "" }] };
    case "multi":
      return { id, type, text: "", required: true, options: [{ label: "" }, { label: "" }], max: 0 };
    case "scale5":
      return { id, type, text: "", required: true, low: KPI_LOW, high: KPI_HIGH };
    case "text":
      return { id, type, text: "", required: false };
  }
}

export function addQuestion(spec: SurveySpec, type: QuestionType): SurveySpec {
  return { ...spec, questions: [...spec.questions, blankQuestion(nextQuestionId(spec.questions), type)] };
}

export function updateQuestion(spec: SurveySpec, id: string, patch: Partial<Omit<Question, "id">>): SurveySpec {
  return { ...spec, questions: spec.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)) };
}

/** 유형을 바꾸면 그 유형에 맞게 보기·라벨을 정리함(문구·필수 여부는 유지) */
export function changeType(spec: SurveySpec, id: string, type: QuestionType): SurveySpec {
  const next = spec.questions.map((q) => {
    if (q.id !== id || q.type === type) return q;
    const base = blankQuestion(q.id, type);
    const keepOptions = (q.type === "single" || q.type === "multi") && (type === "single" || type === "multi");
    return { ...base, text: q.text, required: type === "text" ? false : q.required, section: q.section, note: q.note, ...(keepOptions ? { options: q.options } : {}) };
  });
  const kpiStillScale = next.find((q) => q.id === spec.kpiQuestionId)?.type === "scale5";
  return { ...spec, questions: next, kpiQuestionId: kpiStillScale ? spec.kpiQuestionId : null };
}

export function removeQuestion(spec: SurveySpec, id: string): SurveySpec {
  return {
    ...spec,
    questions: spec.questions.filter((q) => q.id !== id),
    kpiQuestionId: spec.kpiQuestionId === id ? null : spec.kpiQuestionId,
  };
}

export function moveQuestion(spec: SurveySpec, id: string, delta: -1 | 1): SurveySpec {
  const i = spec.questions.findIndex((q) => q.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= spec.questions.length) return spec;
  const qs = [...spec.questions];
  [qs[i], qs[j]] = [qs[j], qs[i]];
  return { ...spec, questions: qs };
}

/** 끌어서 놓기: 문항을 to 위치(0부터)로 옮김 */
export function moveQuestionTo(spec: SurveySpec, id: string, to: number): SurveySpec {
  const i = spec.questions.findIndex((q) => q.id === id);
  if (i < 0) return spec;
  const j = Math.max(0, Math.min(spec.questions.length - 1, to));
  if (i === j) return spec;
  const qs = [...spec.questions];
  const [q] = qs.splice(i, 1);
  qs.splice(j, 0, q);
  return { ...spec, questions: qs };
}

/** 대표 만족도 문항 지정: 5점 문항만, 문구·라벨을 표준으로 맞춤 */
export function setKpi(spec: SurveySpec, id: string): SurveySpec {
  const q = spec.questions.find((x) => x.id === id);
  if (!q || q.type !== "scale5") return spec;
  return { ...updateQuestion(spec, id, { low: KPI_LOW, high: KPI_HIGH }), kpiQuestionId: id };
}

/** 사업·행사명이 바뀌면 표준 문구를 쓰는 대표 문항의 이름도 따라 바꿈 */
export function syncKpiText(spec: SurveySpec, oldName: string, newName: string): SurveySpec {
  const q = spec.questions.find((x) => x.id === spec.kpiQuestionId);
  if (!q || q.text !== kpiText(oldName)) return spec;
  return updateQuestion(spec, q.id, { text: kpiText(newName) });
}

export function setOptions(spec: SurveySpec, id: string, options: { label: string; other?: boolean }[]): SurveySpec {
  return updateQuestion(spec, id, { options: options.map((o) => (o.other ? { label: o.label, other: true } : { label: o.label })) });
}

/** 지난 설문의 문항을 그대로 가져옴(연도별 비교용). 기본 정보는 지금 것을 유지 */
export function copyQuestionsFrom(spec: SurveySpec, prev: Pick<SurveySpec, "questions" | "kpiQuestionId" | "intro">): SurveySpec {
  return { ...spec, intro: prev.intro || spec.intro, questions: prev.questions.map((q) => ({ ...q })), kpiQuestionId: prev.kpiQuestionId };
}

/** 파일에서 뽑은 문항으로 문항만 바꿈(제목·사업명·분류·마감일·안내문 등 기본 정보는 그대로) */
export function replaceQuestions(spec: SurveySpec, questions: Question[], kpiQuestionId: string | null): SurveySpec {
  return { ...spec, questions: questions.map((q) => ({ ...q })), kpiQuestionId };
}

/** 저장 전 정리: 앞뒤 공백, 빈 선택 필드 제거, 연도는 마감일에서 */
export function tidy(spec: SurveySpec): SurveySpec {
  const deadline = normalizeDeadline(spec.deadline) ?? spec.deadline;
  return {
    ...spec,
    title: spec.title.trim(),
    slug: spec.slug.trim().toLowerCase(),
    category: spec.category.trim(),
    program: spec.program.trim(),
    intro: spec.intro.trim(),
    deadline,
    year: /^\d{4}/.test(deadline) ? Number(deadline.slice(0, 4)) : spec.year,
    target: spec.target && spec.target > 0 ? Math.floor(spec.target) : undefined,
    questions: spec.questions.map((q) => {
      const out: Question = { id: q.id, type: q.type, text: q.text.trim(), required: q.required };
      if (q.section?.trim()) out.section = q.section.trim();
      if (q.note?.trim()) out.note = q.note.trim();
      if (q.type === "single" || q.type === "multi") out.options = (q.options ?? []).map((o) => (o.other ? { label: o.label.trim(), other: true } : { label: o.label.trim() }));
      if (q.type === "multi" && q.max) out.max = q.max;
      if (q.type === "scale5") {
        out.low = (q.low ?? "").trim();
        out.high = (q.high ?? "").trim();
      }
      return out;
    }),
  };
}
