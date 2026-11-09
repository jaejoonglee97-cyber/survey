import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { replaceQuestions, starterSpec, tidy } from "@/lib/admin/editor-ops";
import { extractQuestionSets, normalizeAnswers, validateDraft } from "@/lib/survey-core";
import { sample, tpl } from "./helpers";

// 담당자가 정리한 문항 문서(표 형식)에서 질문만 뽑기
const summary = readFileSync(path.resolve(import.meta.dirname, "..", "fixtures", "survey-questions-summary.md"), "utf8");

describe("문항 정리 문서(표 형식)에서 질문 뽑기", () => {
  const sets = extractQuestionSets(summary);

  it("문서 안의 설문 2개를 각각 찾음(설계 기준 목록은 무시)", () => {
    expect(sets.map((s) => [s.label, s.questions.length])).toEqual([
      ["Ⅰ. 2026 서울사회복지사 힐링캠프 만족도 설문 (12문항)", 12],
      ["Ⅱ. 행사·교육 공통 템플릿 (7문항)", 7],
    ]);
  });

  it("힐링캠프: 유형·필수·최대 선택·직접입력·척도 라벨·영역·대표 문항", () => {
    const s = sets[0];
    expect(s.notes).toEqual([]);
    expect(s.kpiQuestionId).toBe("Q4");
    const [q1, q2, , q4, q5, , q7, , q9, , , q12] = s.questions;
    expect(q1).toMatchObject({ type: "single", required: true, section: "참여 정보" });
    expect(q1.options?.map((o) => o.label)).toEqual(["참여자주도형(국내)", "참여자주도형(해외)", "협회지정형(산티아고)"]);
    expect(q2).toMatchObject({ type: "multi", max: 2, required: true });
    expect(q2.options?.at(-1)).toEqual({ label: "기타", other: true });
    expect(q4).toMatchObject({ type: "scale5", text: "힐링캠프에 대해 전반적으로 만족하십니까?", low: "매우 불만족", high: "매우 만족" });
    expect([q5.low, q5.high]).toEqual(["매우 부족", "매우 충분"]);
    expect([q7.low, q7.high]).toEqual(["전혀 도움 안 됨", "매우 도움 됨"]);
    expect(q9.options?.map((o) => o.label)).toEqual(["공가 처리", "연차 사용", "일부 공가, 일부 연차", "기타"]);
    expect(q12).toMatchObject({ type: "text", required: false });
  });

  it("뽑은 문항은 기존 시스템 형식 샘플과 같음(같은 설문)", () => {
    const fromMd = extractQuestionSets(sample)[0];
    // 표에는 '질문 아래 안내(설명)' 열이 없으므로 그것만 빼고 비교
    const noNote = (qs: typeof fromMd.questions) =>
      qs.map((q) => {
        const copy = { ...q };
        delete copy.note;
        return copy;
      });
    expect(noNote(sets[0].questions)).toEqual(noNote(fromMd.questions));
    expect(sets[0].kpiQuestionId).toBe(fromMd.kpiQuestionId);
    const tplSet = extractQuestionSets(tpl)[0];
    expect(sets[1].questions.map((q) => q.text)).toEqual(tplSet.questions.map((q) => q.text));
    expect(sets[1].questions[5]).toMatchObject({ type: "multi", required: false, max: 2 });
  });

  it("기본 정보는 담당자가 입력한 그대로 두고 문항만 바꿈 → 게시 가능한 설문", () => {
    const base = { ...starterSpec(new Date("2026-11-09T12:00:00+09:00")), title: "2026 힐링캠프 만족도", slug: "healing-2026", category: "사업", program: "힐링캠프" };
    const s = tidy(replaceQuestions(base, sets[0].questions, sets[0].kpiQuestionId));
    expect([s.title, s.slug, s.category, s.program, s.deadline, s.intro]).toEqual([base.title, base.slug, base.category, base.program, base.deadline, base.intro]);
    expect(s.questions).toHaveLength(12);
    expect(validateDraft(s).errorCount).toBe(0);
    // 실제 응답도 받을 수 있는 문항인지
    const r = normalizeAnswers(s, { Q1: "참여자주도형(국내)", Q2: ["기타: 걷기"], Q3: ["동료 네트워크"], Q4: 5, Q5: 4, Q6: 4, Q7: 4, Q8: 4, Q9: "연차 사용", Q10: "하고 있다", Q11: "있음" });
    expect(r.ok).toBe(true);
  });
});

describe("다양한 표 모양", () => {
  it("영역·비고 열이 없어도, 필수 열이 없어도 읽음(서술만 선택)", () => {
    const md = "| 번호 | 문항 | 유형 | 보기 |\n|---|---|---|---|\n| 1 | 전반적으로 만족하십니까? | 5점 | 1 매우 불만족 ~ 5 매우 만족 |\n| 2 | 의견 | 서술 | |";
    const [s] = extractQuestionSets(md);
    expect(s.questions.map((q) => [q.type, q.required])).toEqual([
      ["scale5", true],
      ["text", false],
    ]);
    expect(s.kpiQuestionId).toBe("Q1"); // 표시가 없으면 '전반적으로 만족' 5점 문항을 대표로
    expect(s.notes.join()).toContain("대표로 지정");
    expect(s.label).toBe("표 1");
  });

  it("알 수 없는 유형·보기 부족·라벨 없는 척도는 확인 사항으로 알려 줌", () => {
    const md =
      "## 시험\n| 문항 | 유형 | 필수 | 보기·척도 |\n|---|---|:-:|---|\n| 무엇? | 그림 | ○ | |\n| 고르기 | 단일선택 | ○ | 하나 |\n| 점수 | 5점 척도 | - | 없음 |";
    const [s] = extractQuestionSets(md);
    expect(s.questions.map((q) => q.text)).toEqual(["고르기", "점수"]);
    expect(s.notes.join("\n")).toMatch(/유형을 알 수 없어 건너뜀/);
    expect(s.notes.join("\n")).toMatch(/보기가 2개 미만/);
    expect(s.notes.join("\n")).toMatch(/양 끝 라벨을 찾지 못해/);
    expect(s.questions[1]).toMatchObject({ required: false, low: "매우 불만족", high: "매우 만족" });
    expect(s.kpiQuestionId).toBeNull();
  });

  it("문항 표가 아닌 표·빈 문서는 무시", () => {
    expect(extractQuestionSets("| 이름 | 값 |\n|---|---|\n| a | b |")).toEqual([]);
    expect(extractQuestionSets("")).toEqual([]);
    expect(extractQuestionSets("그냥 글")).toEqual([]);
  });

  it("시스템 형식은 머리말 없이 문항만 있어도 읽음", () => {
    const [s] = extractQuestionSets("## [5점*] 전반적으로 만족하십니까?\nlow: 매우 불만족\nhigh: 매우 만족\n지표: 대표만족\n## [서술] 의견");
    expect(s.questions).toHaveLength(2);
    expect(s.kpiQuestionId).toBe("Q1");
    expect(s.notes).toEqual([]);
  });
});
