import { describe, expect, it } from "vitest";
import { buildView, deltaText, filterOptions, meanOf, posOf, rulerPct, sumDist, trendPath, trends } from "@/lib/dashboard/calc";
import { loadDashboardData, summaryIsFinal } from "@/lib/dashboard/data";
import { MemoryGateway } from "@/lib/sheets/memory-gateway";
import { defaultSeedSurveys, seedDummy } from "@/lib/store/seed";
import { SurveyStore } from "@/lib/store/survey-store";
import type { DashboardRow } from "@/lib/survey-core";
import { sample, tpl } from "../survey-core/helpers";

const row = (over: Partial<DashboardRow>): DashboardRow => ({
  slug: "x",
  title: "x",
  category: "교육",
  program: "p",
  year: 2026,
  deadline: "2026-10-01 18:00",
  state: "closed",
  target: 0,
  n: 10,
  hasKpi: true,
  valid: 10,
  shown: true,
  dist: [0, 0, 2, 4, 4],
  ...over,
});

describe("대시보드 계산", () => {
  it("평균·긍정 비율·눈금 위치", () => {
    expect(meanOf([0, 0, 2, 4, 4])).toBeCloseTo(4.2);
    expect(posOf([0, 0, 2, 4, 4])).toBe(80);
    expect([meanOf([0, 0, 0, 0, 0]), posOf([0, 0, 0, 0, 0])]).toEqual([null, null]);
    expect([rulerPct(1), rulerPct(3), rulerPct(5), rulerPct(0), rulerPct(9)]).toEqual([0, 50, 100, 0, 100]);
    expect(sumDist([{ dist: [1, 0, 0, 0, 1] }, { dist: null }, { dist: [0, 1, 0, 0, 0] }])).toEqual([1, 1, 0, 0, 1]);
  });

  it("요약은 숨긴 설문의 응답 수는 세되 평균에는 넣지 않음", () => {
    const v = buildView(
      [
        row({ slug: "a", dist: [0, 0, 0, 5, 5], n: 10 }),
        row({ slug: "b", shown: false, dist: null, valid: 3, n: 3 }),
        row({ slug: "c", category: "행사", dist: [0, 0, 5, 5, 0], n: 10 }),
      ],
      { year: "all", category: "all" },
    );
    expect(v.summary).toEqual({ surveys: 3, responses: 23, mean: 4, positive: 75 });
    expect(v.overall?.label).toBe("전체 기간 · 전체 분류");
    expect(v.categories).toEqual([
      { category: "교육", surveys: 1, responses: 10, mean: 4.5, positive: 100 },
      { category: "행사", surveys: 1, responses: 10, mean: 3.5, positive: 50 },
    ]);
  });

  it("연도·분류 필터, 분류를 고르면 분류별 눈금은 생략", () => {
    const rows = [row({ slug: "a", year: 2025 }), row({ slug: "b", year: 2026, category: "행사" })];
    expect(buildView(rows, { year: 2025, category: "all" }).inYear.map((r) => r.slug)).toEqual(["a"]);
    const v = buildView(rows, { year: "all", category: "행사" });
    expect(v.inYear.map((r) => r.slug)).toEqual(["b"]);
    expect(v.categories).toEqual([]);
    expect(v.overall?.label).toBe("전체 기간 · 행사");
    expect(buildView(rows, { year: 2024, category: "all" }).overall).toBeNull();
    expect(filterOptions(rows)).toEqual({ years: [2026, 2025], categories: ["교육", "행사"] });
  });

  it("연도별 추이: 같은 사업 2개 연도 이상, 같은 해는 합산, 숨긴 설문 제외", () => {
    const t = trends([
      row({ program: "힐링캠프", year: 2025, dist: [0, 0, 0, 10, 0] }),
      row({ program: "힐링캠프", year: 2026, dist: [0, 0, 0, 0, 5] }),
      row({ program: "힐링캠프", year: 2026, dist: [0, 0, 0, 5, 0] }),
      row({ program: "힐링캠프", year: 2024, shown: false, dist: null }),
      row({ program: "송년회", year: 2026 }),
    ]);
    expect(t).toHaveLength(1);
    expect(t[0].points).toEqual([
      { year: 2025, mean: 4, n: 10 },
      { year: 2026, mean: 4.5, n: 10 },
    ]);
    expect(t[0].deltaText).toBe("전년 대비 +0.5점");
    expect([deltaText(0.01), deltaText(-0.26)]).toEqual(["전년 대비 변동 없음", "전년 대비 −0.3점"]);
  });

  it("추이 좌표는 그림 안에 있음", () => {
    for (const pts of [[{ mean: 4 }, { mean: 4 }], [{ mean: 1 }, { mean: 5 }, { mean: 3 }], [{ mean: 3 }]]) {
      for (const p of trendPath(pts)) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(260);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(96);
      }
    }
  });
});

const NOW = new Date("2026-11-09T12:00:00+09:00");

describe("대시보드 데이터(서버)", () => {
  async function seeded() {
    const gw = new MemoryGateway();
    await seedDummy(gw, defaultSeedSurveys(sample, tpl), { now: NOW });
    return { gw, store: new SurveyStore(gw, { now: () => NOW, cacheMs: 0 }) };
  }

  it("5건 미만 설문은 분포가 응답 데이터에 아예 없음, 서술 의견·문항 원문도 없음", async () => {
    const { store } = await seeded();
    const data = await loadDashboardData(store, "2026-11-09 12:00:00");
    const party = data.rows.find((r) => r.slug === "party2025")!;
    expect(party).toMatchObject({ shown: false, dist: null, valid: 4, n: 4 });
    const raw = JSON.stringify(data);
    expect(raw).not.toContain("더미)"); // 서술 의견(더미 표시) 없음
    expect(raw).not.toContain("전반적으로 만족하십니까"); // 문항 원문 없음
    expect(data.rows.map((r) => r.slug)).not.toContain("meeting2026"); // 초안 제외
    expect(data.minN).toBe(5);
  });

  it("진행 중인 설문은 새 응답이 바로 반영되고 시트에 쓰지 않음", async () => {
    const { gw, store } = await seeded();
    const before = JSON.stringify(gw.raw("summary"));
    const ans = {
      Q1: "참여자주도형(국내)",
      Q2: ["쉼을 통한 회복"],
      Q3: ["동료 네트워크"],
      Q4: 1,
      Q5: 3,
      Q6: 4,
      Q7: 4,
      Q8: 5,
      Q9: "연차 사용",
      Q10: "하고 있다",
      Q11: "있음",
    };
    expect((await store.submitResponse("healing2026", ans)).code).toBe("ok");
    const data = await loadDashboardData(store, "t");
    expect(data.rows.find((r) => r.slug === "healing2026")?.n).toBe(19);
    expect(JSON.stringify(gw.raw("summary"))).toBe(before);
  });

  it("마감 전에 계산한 캐시는 마감 뒤 한 번 다시 계산해 기록하고, 그 뒤로는 재사용", async () => {
    const { gw, store } = await seeded();
    const rec = (await store.listSurveys()).find((s) => s.spec.slug === "healing2026")!;
    const sum0 = (await store.readSummaries()).get(rec.id)!;
    expect(summaryIsFinal(rec, sum0)).toBe(false); // 진행 중
    // 마감일이 지난 뒤
    const later = new Date("2026-12-11T09:00:00+09:00");
    const store2 = new SurveyStore(gw, { now: () => later, cacheMs: 0 });
    const closed = (await store2.getById(rec.id))!;
    expect(closed.state).toBe("closed");
    expect(summaryIsFinal(closed, sum0)).toBe(false);
    await loadDashboardData(store2, "t");
    const sum1 = (await store2.readSummaries()).get(rec.id)!;
    expect(summaryIsFinal(closed, sum1)).toBe(true);
    let reads = 0;
    const orig = gw.readAll.bind(gw);
    gw.readAll = async (t: string) => {
      if (t.startsWith("r_")) reads++;
      return orig(t);
    };
    await loadDashboardData(store2, "t");
    expect(reads).toBe(0); // 마감된 설문은 모두 캐시 사용
  });

  it("담당자가 직접 마감한 경우 마감 시각 이후 캐시면 최종", () => {
    const rec = { state: "closed" as const, closedAt: "2026-11-01 10:00:00", spec: { deadline: "2026-12-10 23:59" } } as Parameters<typeof summaryIsFinal>[0];
    const s = (updatedAt: string) => ({ surveyId: "x", n: 1, dist: null, mean: null, positiveRate: null, updatedAt });
    expect(summaryIsFinal(rec, s("2026-11-01 10:00:01"))).toBe(true);
    expect(summaryIsFinal(rec, s("2026-11-01 09:59:59"))).toBe(false);
    expect(summaryIsFinal(rec, undefined)).toBe(false);
  });
});
