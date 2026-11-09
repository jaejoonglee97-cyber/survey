import { describe, expect, it } from "vitest";
import {
  aggregate,
  buildReportLines,
  dashboardRows,
  distStats,
  effectiveState,
  kpiOf,
  koreaYear,
  normalizeAnswers,
  normalizeDeadline,
  parseDeadline,
  type DashboardInput,
  type RawAnswers,
  type ScaleAgg,
  type ChoiceAgg,
  type TextAgg,
  type SurveySpec,
} from "@/lib/survey-core";
import { evMd, mdWithDeadline, specOf } from "./helpers";

function rowsOf(spec: SurveySpec, list: RawAnswers[]): string[][] {
  return list.map((a) => {
    const r = normalizeAnswers(spec, a);
    if (!r.ok) throw new Error(r.error);
    return r.row;
  });
}

// 프로토타입 시험 3절의 '응답 제출 → 집계·보고서' 사례를 순수 함수로 재현
const spec = specOf(mdWithDeadline("2026-11-12 18:00"));
const ans = (over: RawAnswers = {}): RawAnswers => ({
  Q1: "참여자주도형(국내)",
  Q2: ["쉼을 통한 회복", "동료 네트워크 확대"],
  Q3: ["쉼을 통한 회복"],
  Q4: 5,
  Q5: 3,
  Q6: 4,
  Q7: 4,
  Q8: 5,
  Q9: "공가 처리",
  Q10: "하고 있다",
  Q11: "있음",
  Q12: "좋았음",
  ...over,
});
const rows = rowsOf(spec, [
  ans(),
  ans({ Q1: "참여자주도형(해외)", Q4: 4, Q5: 2, Q9: "기타: 기관 자체 지원", Q10: "하고 있지 않다", Q11: "잘 모르겠음", Q12: "=1+1" }),
  ans({ Q1: "협회지정형(산티아고)", Q2: ["기타: 걷기 좋아서"], Q4: 3, Q12: undefined }),
]);

describe("집계·보고서 문안 (프로토타입 사례)", () => {
  const agg = aggregate(spec, rows);
  const q = <T>(id: string) => agg.questions.find((x) => x.id === id) as T;
  const report = buildReportLines(spec, agg).join("\n");

  it("수식 주입이 차단된 값으로 저장됨", () => {
    expect(rows[1][11]).toBe("'=1+1");
  });

  it("평균, 긍정비율, 기타·수식 복원", () => {
    expect(agg.n).toBe(3);
    const q4 = q<ScaleAgg>("Q4");
    expect([q4.mean, q4.pos, q4.posPct]).toEqual([4, 2, 66.7]);
    expect(q4.dist).toEqual([0, 0, 1, 1, 1]);
    expect(q<ChoiceAgg>("Q1").options.find((o) => o.label === "협회지정형(산티아고)")?.count).toBe(1);
    expect(q<ChoiceAgg>("Q2").options.find((o) => o.label === "쉼을 통한 회복")?.count).toBe(2);
    expect(q<ChoiceAgg>("Q2").options.find((o) => o.label === "기타")?.count).toBe(1);
    expect(q<ChoiceAgg>("Q2").otherTexts).toEqual(["걷기 좋아서"]);
    expect(q<ChoiceAgg>("Q9").otherTexts).toEqual(["기관 자체 지원"]);
    expect([...q<TextAgg>("Q12").texts].sort()).toEqual(["=1+1", "좋았음"].sort());
    expect(q<TextAgg>("Q12").answered).toBe(2);
  });

  it("보고서 문장", () => {
    expect(report).toContain("대상 40명 중 3명이 응답하여 응답률 7.5%임.");
    expect(report).toContain("평균 4점(5점 만점), 긍정 응답(4~5점) 비율 66.7%(2/3명)");
    expect(report).toMatch(/나타났음\.|나타났음\(복수응답\)\./);
    const sentences = report.split("\n").filter((l) => l.startsWith("-") && !/^- (설문명|설문 기한):/.test(l));
    expect(sentences.every((l) => /(임|음)(\(복수응답\))?\.$/.test(l))).toBe(true);
  });

  it("보고서에는 서술 의견 원문이 들어가지 않음", () => {
    expect(report).not.toContain("좋았음");
    expect(report).toContain("총 2건의 의견이 접수되었음.");
  });

  it("보고서 전체 문안(고정)", () => {
    expect(buildReportLines(spec, agg)).toMatchSnapshot();
  });
});

describe("보고서 문안 (추가)", () => {
  it("응답이 없으면 짧게 끝냄, 대상 인원이 없으면 총 응답 수", () => {
    const empty = aggregate(spec, []);
    expect(buildReportLines(spec, empty)).toEqual([
      "1. 응답 현황",
      "- 설문명: 2026 서울사회복지사 힐링캠프 만족도 설문",
      "- 설문 기한: 2026-11-12 18:00까지",
      "- 대상 40명 중 0명이 응답하여 응답률 0%임.",
      "- 접수된 응답이 없었음.",
    ]);
    const lines = buildReportLines({ ...spec, target: undefined }, aggregate(spec, rows.slice(0, 1)));
    expect(lines[3]).toBe("- 총 1명이 응답하였음.");
  });

  it("응답이 없는 문항, 보기 하나만 선택된 문항", () => {
    const only = rowsOf(spec, [ans({ Q12: undefined })]);
    const agg = aggregate(spec, only);
    const lines = buildReportLines(spec, agg);
    expect(lines).toContain("- ‘힐링캠프 이후 후속모임을 하고 있습니까?’ 문항은 ‘하고 있다’ 1명(100%)이 선택하였음.");
    const blank = aggregate(spec, [Array(12).fill("")]);
    const l2 = buildReportLines(spec, blank);
    expect(l2).toContain("- ‘힐링캠프에 대해 전반적으로 만족하십니까?’ 문항은 응답이 없었음.");
    expect(l2).toContain("- ‘참여하신 힐링캠프 유형은 무엇입니까?’ 문항은 응답이 없었음.");
  });
});

describe("마감 시각", () => {
  it("표기한 분이 끝날 때까지 접수(23:59:30 가능, 00:00:30 마감)", () => {
    expect(effectiveState("open", "2026-11-20 23:59", new Date("2026-11-20T23:59:30+09:00"))).toBe("open");
    expect(effectiveState("open", "2026-11-20 23:59", new Date("2026-11-21T00:00:30+09:00"))).toBe("closed");
    expect(effectiveState("open", "2026-11-20", new Date("2026-11-20T23:59:59.999+09:00"))).toBe("open");
  });

  it("수동 마감·초안·잘못된 마감일", () => {
    expect(effectiveState("closed", "2099-01-01 00:00")).toBe("closed");
    expect(effectiveState("draft", "2000-01-01 00:00")).toBe("draft");
    expect(effectiveState("open", "엉터리")).toBe("closed");
  });

  it("마감일 해석: 한국시간, 존재하지 않는 날짜 거부", () => {
    expect(parseDeadline("2026-12-10 18:00")?.toISOString()).toBe("2026-12-10T09:00:59.999Z");
    expect(parseDeadline("2026-02-29")).toBeNull();
    expect(parseDeadline("2028-02-29")).not.toBeNull();
    expect(parseDeadline(null)).toBeNull();
    expect(normalizeDeadline("2026-01-05T9:05")).toBe("2026-01-05 09:05");
    expect(normalizeDeadline("2026-01-05 24:00")).toBeNull();
  });

  it("한국시간 기준 연도", () => {
    expect(koreaYear(new Date("2026-12-31T15:30:00Z"))).toBe(2027);
    expect(koreaYear(new Date("2026-12-31T14:30:00Z"))).toBe(2026);
  });
});

describe("대시보드 행 (프로토타입 3b 사례)", () => {
  const evAns = (s: number): RawAnswers => ({ Q1: s, Q2: s, Q3: s, Q4: s, Q5: "추천", Q6: ["내용"], Q7: "비밀의견" });
  function item(slug: string, program: string, year: string, cat: string, deadline: string, scores: number[], stripKpi = false): DashboardInput {
    let md = evMd(slug, program, year, cat, deadline, 30);
    if (stripKpi) md = md.replace("지표: 대표만족\n", "");
    const s = specOf(md);
    const agg = aggregate(s, rowsOf(s, scores.map(evAns)));
    const k = kpiOf(s, agg);
    return {
      slug: s.slug,
      title: s.title,
      category: s.category,
      program: s.program,
      year: s.year,
      deadline: s.deadline,
      state: effectiveState("open", s.deadline, new Date("2026-11-09T12:00:00+09:00")),
      target: s.target,
      n: agg.n,
      kpi: k ? { valid: k.valid, dist: k.dist } : null,
    };
  }
  const res = dashboardRows([
    item("edu2025", "AI 교육", "2025", "교육", "2026-12-30", [5, 4, 4, 3, 5, 4]),
    item("edu2026", "AI 교육", "2026", "교육", "2026-12-29", [5, 5, 4, 5, 4]),
    item("party2026", "송년회", "2026", "행사", "2026-12-28", [5, 5, 5]),
    item("nokpi2026", "간담회", "", "교육", "2026-12-27", [3, 4, 5, 4, 4, 4], true),
  ]);
  const by = (s: string) => res.find((r) => r.slug === s)!;

  it("최근 마감 순, 5건 미만 비공개, 대표 지표 없는 설문 구분", () => {
    expect(res.map((r) => r.slug)).toEqual(["edu2025", "edu2026", "party2026", "nokpi2026"]);
    const e = by("edu2025");
    expect([e.shown, e.dist, e.year, e.category, e.program]).toEqual([true, [0, 0, 1, 3, 2], 2025, "교육", "AI 교육"]);
    expect([by("edu2026").shown, by("edu2026").dist]).toEqual([true, [0, 0, 0, 2, 3]]);
    const p = by("party2026");
    expect([p.shown, p.dist, p.valid, p.n]).toEqual([false, null, 3, 3]);
    const nk = by("nokpi2026");
    expect([nk.hasKpi, nk.shown, nk.year]).toEqual([false, false, 2026]);
    expect(by("edu2026").target).toBe(30);
    expect(by("edu2026").state).toBe("open");
  });

  it("서술 의견·문항 원문은 대시보드 행에 없음", () => {
    const raw = JSON.stringify(res);
    expect(raw).not.toContain("비밀의견");
    expect(raw).not.toContain("내용(주제");
  });

  it("분포 통계", () => {
    expect(distStats([0, 0, 1, 3, 2])).toEqual({ n: 6, mean: 4.2, posPct: 83.3 });
    expect(distStats([0, 0, 0, 0, 0])).toEqual({ n: 0, mean: 0, posPct: 0 });
  });

  it("대표 문항이 없거나 척도가 아니면 kpiOf 는 null", () => {
    const s = specOf(evMd("abc", "x", "", "행사", "2026-12-31"));
    const agg = aggregate(s, []);
    expect(kpiOf({ kpiQuestionId: null }, agg)).toBeNull();
    expect(kpiOf({ kpiQuestionId: "Q5" }, agg)).toBeNull();
  });
});
