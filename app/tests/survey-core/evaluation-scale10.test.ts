import { describe, expect, it } from "vitest";
import {
  aggregate,
  batchim,
  buildEvaluationLines,
  buildReportLines,
  euro,
  eunneun,
  exportMd,
  extractQuestionSets,
  iga,
  importMd,
  normalizeAnswers,
  toneOf,
  validateDraft,
  type Question,
  type SurveySpec,
} from "@/lib/survey-core";

const q10: Question = { id: "Q2", type: "scale10", text: "추천 의향은 어느 정도입니까?", required: true, low: "전혀 없음", high: "매우 많음" };
const kpi: Question = { id: "Q1", type: "scale5", text: "캠퍼스에 대해 전반적으로 만족하십니까?", required: true, low: "매우 불만족", high: "매우 만족" };
const spec = (questions: Question[] = [kpi, q10]): SurveySpec => ({
  title: "네트워킹 캠퍼스 만족도",
  slug: "campus-2026",
  category: "교육",
  program: "네트워킹 캠퍼스",
  year: 2026,
  deadline: "2026-12-31 23:59",
  target: 28,
  intro: "",
  questions,
  kpiQuestionId: "Q1",
});
const rows = (s: SurveySpec, list: Record<string, unknown>[]) =>
  list.map((a) => {
    const r = normalizeAnswers(s, a);
    if (!r.ok) throw new Error(r.error);
    return r.row;
  });

describe("10점 척도", () => {
  it("응답 검증: 1~10 정수만", () => {
    const s = spec();
    expect(normalizeAnswers(s, { Q1: 5, Q2: 10 }).ok).toBe(true);
    expect(normalizeAnswers(s, { Q1: 5, Q2: 0 })).toMatchObject({ ok: false, error: "Q2: 1~10 사이 값이어야 함" });
    expect(normalizeAnswers(s, { Q1: 5, Q2: 11 }).ok).toBe(false);
    expect(normalizeAnswers(s, { Q1: 5, Q2: 7.5 }).ok).toBe(false);
    expect(normalizeAnswers(s, { Q1: 6, Q2: 7 }).ok).toBe(false); // 5점은 여전히 1~5
  });

  it("집계: 분포 10칸, 평균, 9~10점 비율", () => {
    const s = spec();
    const agg = aggregate(s, rows(s, [{ Q1: 5, Q2: 10 }, { Q1: 4, Q2: 9 }, { Q1: 5, Q2: 6 }, { Q1: 3, Q2: 7 }]));
    const a = agg.questions[1];
    expect(a).toMatchObject({ type: "scale10", valid: 4, mean: 8, top: 2, topPct: 50 });
    expect(a.type === "scale10" && a.dist).toEqual([0, 0, 0, 0, 0, 1, 1, 0, 1, 1]);
    const k = agg.questions[0];
    expect(k).toMatchObject({ top: 2, topPct: 50, pos: 3, posPct: 75 });
    expect(buildReportLines(s, agg).join("\n")).toContain("‘추천 의향은 어느 정도입니까?’ 문항은 평균 8점(10점 만점), 9~10점 응답 비율 50%(2/4명)로 나타났음.");
  });

  it("점검: 라벨 필수, 대표 문항은 될 수 없음, 예상 시간 8초", () => {
    expect(validateDraft(spec()).errorCount).toBe(0);
    expect(validateDraft(spec([kpi, { ...q10, low: "" }])).issues.find((i) => i.code === "SCALE_LABELS")?.message).toContain("10점");
    expect(validateDraft({ ...spec(), kpiQuestionId: "Q2" }).issues.some((i) => i.code === "KPI_NOT_SCALE5")).toBe(true);
    expect(validateDraft(spec()).estimatedSeconds).toBe(14);
  });

  it("md 내보내기·불러오기, 표 형식 문서에서도 10점 인식", () => {
    const s = spec();
    const back = importMd(exportMd(s));
    expect(back.errors).toEqual([]);
    expect(back.spec.questions[1]).toEqual(q10);
    const [set] = extractQuestionSets("| 문항 | 유형 | 필수 | 보기·척도 |\n|---|---|---|---|\n| 추천 의향 | 10점 척도 | ○ | 1 전혀 없음 ~ 10 매우 많음 |");
    expect(set.questions[0]).toMatchObject({ type: "scale10", low: "전혀 없음", high: "매우 많음" });
  });
});

describe("조사 고르기", () => {
  it("받침에 따라 으로/로, 이/가, 은/는", () => {
    expect([euro("매우 만족"), euro("매우 충분"), euro("매우 도움 됨"), euro("보통"), euro("서울"), euro("매우 높음")]).toEqual(["으로", "으로", "으로", "으로", "로", "으로"]);
    expect([euro("추천"), euro("아니요"), euro("공가 처리")]).toEqual(["으로", "로", "로"]);
    expect([iga("쉼을 통한 회복"), iga("동료 네트워크"), iga("협회지정형(산티아고)")]).toEqual(["이", "가", "가"]);
    expect([eunneun("힐링캠프"), eunneun("네트워킹 캠퍼스"), eunneun("송년회")]).toEqual(["는", "는", "는"]);
    expect([eunneun("간담회 2026"), batchim("10"), batchim("ABC")]).toEqual(["은", "other", "none"]);
  });
});

describe("결과보고서 「만족도 평가」 문안", () => {
  const sections: Question[] = [
    { ...kpi },
    { id: "Q2", type: "scale5", text: "강사진의 설명은 도움이 되었습니까?", required: true, low: "전혀 아님", high: "매우 도움 됨", section: "강사진" },
    { id: "Q3", type: "scale5", text: "이론과 실습의 균형은 적절했습니까?", required: true, low: "전혀 아님", high: "매우 적절함", section: "프로그램 구성" },
    { id: "Q4", type: "scale10", text: "캠퍼스 추천 의향", required: true, low: "낮음", high: "높음" },
    { id: "Q5", type: "multi", text: "좋았던 점", required: false, options: [{ label: "실습" }, { label: "네트워킹" }], section: "프로그램 구성" },
    { id: "Q6", type: "scale5", text: "장소에 만족하십니까?", required: true, low: "매우 불만족", high: "매우 만족", section: "운영 환경" },
    { id: "Q7", type: "text", text: "의견", required: false },
  ];
  const s = spec(sections);
  const data = rows(s, [
    { Q1: 5, Q2: 5, Q3: 5, Q4: 9, Q5: ["실습"], Q6: 3, Q7: "생각보다 할 만했다" },
    { Q1: 5, Q2: 4, Q3: 4, Q4: 8, Q5: ["실습", "네트워킹"], Q6: 3, Q7: "직접 만들며 자신감이 생겼다" },
    { Q1: 4, Q2: 5, Q3: 5, Q4: 7, Q5: ["네트워킹"], Q6: 2 },
    { Q1: 5, Q2: 5, Q3: 4, Q4: 8, Q6: 4 },
  ]);
  const agg = aggregate(s, data);

  it("협회 보고서 문체로 총평·대표 만족도·10점·영역별·의견·개선점·종합 순서", () => {
    const lines = buildEvaluationLines(s, agg, { headingNo: "4", quotes: ["생각보다 할 만했다", "직접 만들며 자신감이 생겼다"] });
    expect(lines).toEqual([
      "4. 만족도 평가",
      "- 참여자 만족도 조사(응답 4명, 응답률 14.3%)를 분석한 결과, 전체 프로그램에 대한 반응은 전반적으로 매우 긍정적인 것으로 나타남.",
      "- 우선 전체 만족도에서 75%가 ‘매우 만족’으로 응답하였고, 긍정 응답(4~5점)은 100%, 평균은 4.8점(5점 만점)으로 나타남. [해석 보완: 예) 이는 운영 방향과 구성에 대한 신뢰도가 높았음을 의미함]",
      "- 또한 ‘캠퍼스 추천 의향’ 평균 8.0점(10점 만점)으로 나타남. [해석 보완]",
      "- 강사진에 대한 평가: ‘강사진의 설명은 도움이 되었습니까?’ 문항은 75%가 ‘매우 도움 됨’으로 응답하였으며 평균 4.8점(5점 만점)으로 나타남. [해석 보완]",
      "- 프로그램 구성에 대한 평가: ‘이론과 실습의 균형은 적절했습니까?’ 문항은 50%가 ‘매우 적절함’으로 응답하였으며 평균 4.5점(5점 만점)으로 나타남. ‘좋았던 점’ 문항은 ‘실습’이 66.7%로 가장 많이 선택되었음(복수응답). [해석 보완]",
      "- 운영 환경에 대한 평가: ‘장소에 만족하십니까?’ 문항은 0%가 ‘매우 만족’으로 응답하였으며 평균 3.0점(5점 만점)으로 나타남. [해석 보완]",
      "- 서술 의견은 총 2건이 접수되었으며, “생각보다 할 만했다”, “직접 만들며 자신감이 생겼다” 등의 의견이 있었음.",
      "- 다만 ‘장소에 만족하십니까?’ 문항은 평균 3.0점으로 상대적으로 낮아 개선 방안 검토가 필요함.",
      "- 종합적으로 볼 때, 이번 네트워킹 캠퍼스는 강사진, 프로그램 구성 등에서 고른 만족도를 확보한 것으로 분석됨. [해석 보완]",
    ]);
  });

  it("모든 문장이 명사형으로 끝남(자리 표시 제외)", () => {
    const lines = buildEvaluationLines(s, agg, { hints: false });
    for (const l of lines.slice(1)) expect(l).toMatch(/(음|임|함|됨|남)(\(복수응답\))?\.$/);
    expect(lines.join("")).not.toContain("[해석");
  });

  it("인용을 고르지 않으면 건수만, 서술 원문은 들어가지 않음", () => {
    const text = buildEvaluationLines(s, agg).join("\n");
    expect(text).toContain("서술 의견은 총 2건이 접수되었음.");
    expect(text).not.toContain("할 만했다");
  });

  it("응답이 없으면 짧게, 대표 문항이 없으면 5점 문항 평균으로 총평", () => {
    expect(buildEvaluationLines(s, aggregate(s, []))).toEqual(["4. 만족도 평가", "- 접수된 응답이 없어 만족도를 평가하지 못함."]);
    const noKpi = buildEvaluationLines({ ...s, kpiQuestionId: null }, agg, { headingNo: "5" });
    expect(noKpi[0]).toBe("5. 만족도 평가");
    expect(noKpi[1]).toContain("전반적으로");
    expect(noKpi.join("\n")).not.toContain("우선 전체 만족도");
  });

  it("총평 수준", () => {
    expect([toneOf(4.6, 10), toneOf(4.1, 61), toneOf(4.1, 30), toneOf(3.6, 0), toneOf(3.1, 0), toneOf(2.5, 0)]).toEqual([
      "매우 긍정적인",
      "매우 긍정적인",
      "긍정적인",
      "대체로 긍정적인",
      "보통 수준인",
      "다소 아쉬운",
    ]);
  });
});
