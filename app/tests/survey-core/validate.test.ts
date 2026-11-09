import { describe, expect, it } from "vitest";
import { applyAutoFixes, PII_NOTICE, validateDraft, type Question, type SurveySpec } from "@/lib/survey-core";
import { evMd, sample, specOf } from "./helpers";

// docs/03-builder-chat.md 5절 검증 규칙과 8절 '코드' 시험 사례

const base = (): SurveySpec => ({
  title: "2026 송년회 만족도 설문",
  slug: "party2026",
  category: "행사",
  program: "송년회",
  year: 2026,
  deadline: "2026-12-31 23:59",
  intro: "참여해 주셔서 감사합니다.",
  questions: [
    { id: "Q1", type: "scale5", text: "송년회에 대해 전반적으로 만족하십니까?", required: true, low: "매우 불만족", high: "매우 만족" },
    { id: "Q2", type: "single", text: "다시 참여하시겠습니까?", required: true, options: [{ label: "예" }, { label: "아니요" }] },
  ],
  kpiQuestionId: "Q1",
});
const withQ = (q: Question, s = base()): SurveySpec => ({ ...s, questions: [...s.questions, q] });
const codes = (s: SurveySpec, opts = {}) => validateDraft(s, opts).issues.map((i) => `${i.level}:${i.code}`);

describe("validateDraft", () => {
  it("올바른 초안은 오류·확인 사항 없이 확정 가능", () => {
    const r = validateDraft(base());
    expect(r.issues).toEqual([]);
    expect(r.canConfirm).toBe(true);
    expect(r.estimatedSeconds).toBe(14);
  });

  it("샘플 두 개는 오류 없음", () => {
    expect(validateDraft(specOf(sample)).errorCount).toBe(0);
    expect(validateDraft(specOf(evMd("abc", "x", "", "행사", "2026-12-31"))).errorCount).toBe(0);
  });

  it("사례 1b: 이름·연락처를 묻는 문항은 PII_QUESTION 오류", () => {
    for (const text of ["성함을 적어 주십시오", "연락처를 남겨 주십시오", "이메일 주소", "생년월일을 입력해 주십시오", "휴대폰 번호"]) {
      const r = validateDraft(withQ({ id: "Q3", type: "text", text, required: false }));
      expect(r.issues.some((i) => i.code === "PII_QUESTION" && i.level === "error" && i.questionId === "Q3")).toBe(true);
      expect(r.canConfirm).toBe(false);
    }
  });

  it("사례 7: 서술 문항이 있으면 안내문 자동 보정", () => {
    const s = withQ({ id: "Q3", type: "text", text: "개선 의견을 적어 주십시오.", required: false });
    expect(codes(s)).toContain("autofix:NO_PII_NOTICE");
    expect(validateDraft(s).canConfirm).toBe(true);
    const fixed = applyAutoFixes(s);
    expect(fixed.intro).toBe("참여해 주셔서 감사합니다.\n" + PII_NOTICE);
    expect(codes(fixed)).not.toContain("autofix:NO_PII_NOTICE");
    expect(applyAutoFixes(fixed)).toBe(fixed);
    expect(applyAutoFixes({ ...s, intro: "" }).intro).toBe(PII_NOTICE);
    expect(applyAutoFixes(base())).toEqual(base());
  });

  it("사례 8: 5점 문항에 라벨이 없으면 SCALE_LABELS 오류", () => {
    expect(codes(withQ({ id: "Q3", type: "scale5", text: "장소에 만족하십니까?", required: true, low: "", high: "매우 만족" }))).toContain(
      "error:SCALE_LABELS",
    );
  });

  it("사례 9: 대표 문항이 없거나 삭제되면 NO_KPI 로 확정 불가", () => {
    expect(codes({ ...base(), kpiQuestionId: null })).toContain("error:NO_KPI");
    const removed = { ...base(), questions: base().questions.slice(1) };
    expect(codes(removed)).toContain("error:NO_KPI");
    expect(validateDraft(removed).canConfirm).toBe(false);
  });

  it("대표 문항은 5점 척도만", () => {
    expect(codes({ ...base(), kpiQuestionId: "Q2" })).toContain("error:KPI_NOT_SCALE5");
  });

  it("보기 규칙: 개수·중복·| 문자·수식 시작·빈 보기", () => {
    const sq = (options: { label: string }[]): Question => ({ id: "Q3", type: "single", text: "보기 시험", required: true, options });
    expect(codes(withQ(sq([{ label: "하나" }])))).toContain("error:OPTIONS");
    expect(codes(withQ(sq([{ label: "가" }, { label: "가" }])))).toContain("error:OPTIONS");
    expect(codes(withQ(sq([{ label: "가|나" }, { label: "다" }])))).toContain("error:OPTIONS");
    expect(codes(withQ(sq([{ label: "=SUM(1)" }, { label: "다" }])))).toContain("error:OPTIONS");
    expect(codes(withQ(sq([{ label: " " }, { label: "다" }])))).toContain("error:OPTIONS");
    expect(codes(withQ(sq([{ label: "가".repeat(101) }, { label: "다" }])))).toContain("error:OPTIONS");
    const multi: Question = { id: "Q3", type: "multi", text: "복수", required: true, max: 5, options: [{ label: "가" }, { label: "나" }] };
    expect(codes(withQ(multi))).toContain("warning:OPTIONS");
  });

  it("문항 수: 12개 초과는 확인, 40개 초과는 오류, 0개는 오류", () => {
    const many = (n: number): SurveySpec => ({
      ...base(),
      questions: [
        base().questions[0],
        ...Array.from({ length: n - 1 }, (_, i): Question => ({ id: `Q${i + 2}`, type: "scale5", text: `항목 ${i}`, required: true, low: "낮음", high: "높음" })),
      ],
    });
    expect(codes(many(13))).toContain("warning:TOO_MANY");
    expect(codes(many(41))).toContain("error:TOO_MANY");
    expect(codes({ ...base(), questions: [], kpiQuestionId: null })).toContain("error:NO_QUESTIONS");
  });

  it("예상 응답 시간 5분 초과·서술 3개 이상은 확인 사항", () => {
    const texts = Array.from({ length: 8 }, (_, i): Question => ({ id: `Q${i + 3}`, type: "text", text: `의견 ${i}`, required: false }));
    const s = { ...base(), questions: [...base().questions, ...texts] };
    const c = codes(s);
    expect(c).toContain("warning:TOO_LONG");
    expect(c).toContain("warning:TEXT_MANY");
    expect(validateDraft(s).estimatedSeconds).toBe(6 + 8 + 8 * 40);
  });

  it("이중 질문 휴리스틱", () => {
    for (const text of ["내용과 진행에 만족하십니까?", "강사 및 장소에 만족하십니까?", "음식 그리고 숙소는 어땠습니까?"]) {
      expect(codes(withQ({ id: "Q3", type: "scale5", text, required: true, low: "a", high: "b" }))).toContain("warning:DOUBLE_BARRELED");
    }
    expect(codes(withQ({ id: "Q3", type: "scale5", text: "강사와의 소통에 만족하십니까?", required: true, low: "a", high: "b" }))).not.toContain(
      "warning:DOUBLE_BARRELED",
    );
  });

  it("분류 문항 3개 이상은 CROSS_SEGMENT, 소속을 직접 적게 하면 AFFILIATION", () => {
    const seg = (id: string, text: string): Question => ({ id, type: "single", text, required: true, options: [{ label: "가" }, { label: "나" }] });
    const s = { ...base(), questions: [...base().questions, seg("Q3", "기관 유형은?"), seg("Q4", "연령대는?"), seg("Q5", "근무 형태는?")] };
    expect(codes(s)).toContain("warning:CROSS_SEGMENT");
    expect(codes(withQ({ id: "Q3", type: "text", text: "소속 기관을 적어 주십시오", required: false }))).toContain("warning:AFFILIATION");
    expect(codes(withQ(seg("Q3", "소속 기관 유형은 무엇입니까?")))).not.toContain("warning:AFFILIATION");
  });

  it("이전 설문과 비교: 대표 문항 문구·같은 문항의 보기가 바뀌면 확인 사항", () => {
    const prev = base();
    const changedKpi = base();
    changedKpi.questions[0] = { ...changedKpi.questions[0], text: "송년회가 좋았습니까?" };
    expect(codes(changedKpi, { previous: prev })).toContain("warning:PREV_WORDING_CHANGED");
    const changedOpts = base();
    changedOpts.questions[1] = { ...changedOpts.questions[1], options: [{ label: "예" }, { label: "아니요" }, { label: "모름" }] };
    expect(codes(changedOpts, { previous: prev })).toContain("warning:PREV_WORDING_CHANGED");
    expect(codes(base(), { previous: prev })).not.toContain("warning:PREV_WORDING_CHANGED");
  });

  it("기본 정보 오류(META), 문항만 볼 때는 건너뜀", () => {
    const bad: SurveySpec = { ...base(), title: "", slug: "한글", deadline: "2026-02-31", category: "", program: "", target: 0, intro: "가".repeat(1001) };
    const metas = validateDraft(bad).issues.filter((i) => i.code === "META");
    expect(metas.length).toBe(7);
    expect(validateDraft(bad, { skipMeta: true }).issues.filter((i) => i.code === "META")).toEqual([]);
    expect(codes({ ...base(), title: "가".repeat(101) })).toContain("error:META");
  });

  it("빈 질문·긴 질문·중복 id", () => {
    expect(codes(withQ({ id: "Q3", type: "text", text: " ", required: false }))).toContain("error:QUESTION_TEXT");
    expect(codes(withQ({ id: "Q3", type: "text", text: "가".repeat(201), required: false }))).toContain("error:QUESTION_TEXT");
    expect(codes(withQ({ id: "Q2", type: "text", text: "의견", required: false }))).toContain("error:DUPLICATE_ID");
  });

  it("사례 11: HTML·javascript: 문자열은 막지 않고 텍스트로 보관(표시할 때 이스케이프)", () => {
    const s = withQ({ id: "Q3", type: "single", text: "<img src=x onerror=alert(1)>", required: true, options: [{ label: "javascript:alert(1)" }, { label: "나" }] });
    expect(validateDraft(s).canConfirm).toBe(true);
  });
});
