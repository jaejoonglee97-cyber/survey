import { describe, expect, it } from "vitest";
import { moveQuestionTo, starterSpec, syncKpiText, tidy } from "@/lib/admin/editor-ops";
import {
  addFromBank,
  applyTemplate,
  hasQuestion,
  KPI_ITEM,
  OPTION_PRESETS,
  optionsToLines,
  parseOptionLines,
  QUESTION_BANK,
  START_TEMPLATES,
} from "@/lib/admin/question-bank";
import { validateDraft, type SurveySpec } from "@/lib/survey-core";

const NOW = new Date("2026-11-09T12:00:00+09:00");
const base = (): SurveySpec => ({ ...starterSpec(NOW), title: "2026 송년회 만족도", slug: "party-2026", program: "송년회" });

describe("문항 은행", () => {
  it("모든 문항이 설계 기준(개인정보·이중 질문·보기 규칙)에 걸리지 않음", () => {
    for (const g of QUESTION_BANK) {
      for (const item of g.items) {
        const s = tidy(addFromBank({ ...base(), questions: [], kpiQuestionId: null }, item));
        const own = validateDraft(s).issues.filter((i) => i.questionId === s.questions[0].id);
        expect(own, item.text).toEqual([]);
      }
    }
  });

  it("추가하면 맨 뒤에 새 번호로 들어가고, 같은 문구는 '추가됨'", () => {
    const item = QUESTION_BANK[1].items[0];
    const s = addFromBank(base(), item);
    expect(s.questions.at(-1)).toMatchObject({ id: "Q6", text: item.text, type: "scale5" });
    expect(hasQuestion(s, item)).toBe(true);
    expect(hasQuestion(base(), QUESTION_BANK[2].items[0])).toBe(false);
  });

  it("은행 문항을 고쳐도 원본 은행은 바뀌지 않음", () => {
    const item = QUESTION_BANK.find((g) => g.name === "성과·후속")!.items[0];
    const s = addFromBank(base(), item);
    s.questions.at(-1)!.options!.push({ label: "새 보기" });
    expect(item.options!.some((o) => o.label === "새 보기")).toBe(false);
  });

  it("대표 만족도 문항: 사업명을 넣은 문구로, 대표가 없을 때만 대표로 지정", () => {
    const empty = { ...base(), questions: [], kpiQuestionId: null };
    const s = addFromBank(empty, KPI_ITEM);
    expect(s.questions[0].text).toBe("송년회에 대해 전반적으로 만족하십니까?");
    expect(s.kpiQuestionId).toBe("Q1");
    expect(hasQuestion(s, KPI_ITEM)).toBe(true);
    const twice = addFromBank(s, KPI_ITEM);
    expect(twice.kpiQuestionId).toBe("Q1");
  });
});

describe("시작 템플릿", () => {
  it.each(START_TEMPLATES.map((t) => [t.name, t] as const))("%s: 기본 정보만 채우면 오류·확인 사항 없이 게시 가능", (_, t) => {
    const s = tidy(applyTemplate(base(), t));
    const r = validateDraft(s);
    expect(r.errorCount).toBe(0);
    expect(r.issues.filter((i) => i.level === "warning")).toEqual([]);
    expect(s.kpiQuestionId).toBe("Q1");
    expect(s.category).toBe(t.category);
    expect(s.questions.length).toBeLessThanOrEqual(12);
    expect([s.title, s.slug, s.program, s.deadline]).toEqual([base().title, base().slug, base().program, base().deadline]);
  });

  it("템플릿을 고른 뒤 사업명을 바꾸면 대표 문구가 따라 바뀜", () => {
    const t = START_TEMPLATES[0];
    const s = applyTemplate({ ...base(), program: "" }, t);
    expect(s.questions[0].text).toBe("(사업·행사명)에 대해 전반적으로 만족하십니까?");
    expect(syncKpiText({ ...s, program: "신년회" }, "", "신년회").questions[0].text).toBe("신년회에 대해 전반적으로 만족하십니까?");
  });
});

describe("보기 입력", () => {
  it("여러 줄 → 보기(글머리표·번호 제거, (직접입력) 인식, 빈 줄 무시)", () => {
    expect(parseOptionLines("- 이용시설\n2) 생활시설\n\n• 공공기관\n기타(직접입력)\r\n")).toEqual([
      { label: "이용시설" },
      { label: "생활시설" },
      { label: "공공기관" },
      { label: "기타", other: true },
    ]);
  });

  it("보기 → 여러 줄 → 보기 왕복", () => {
    for (const p of OPTION_PRESETS) expect(parseOptionLines(optionsToLines(p.options))).toEqual(p.options);
    expect(optionsToLines(undefined)).toBe("");
  });
});

describe("끌어서 순서 바꾸기", () => {
  it("문항을 원하는 위치로 옮기고 id 는 유지", () => {
    const s = base();
    expect(moveQuestionTo(s, "Q5", 0).questions.map((q) => q.id)).toEqual(["Q5", "Q1", "Q2", "Q3", "Q4"]);
    expect(moveQuestionTo(s, "Q1", 3).questions.map((q) => q.id)).toEqual(["Q2", "Q3", "Q4", "Q1", "Q5"]);
    expect(moveQuestionTo(s, "Q1", 99).questions.map((q) => q.id)).toEqual(["Q2", "Q3", "Q4", "Q5", "Q1"]);
    expect(moveQuestionTo(s, "Q2", 1)).toBe(s);
    expect(moveQuestionTo(s, "Q9", 0)).toBe(s);
  });
});
