import { beforeEach, describe, expect, it } from "vitest";
import * as cmd from "@/lib/admin/commands";
import { responseTimeline } from "@/lib/admin/timeline";
import { MemoryGateway } from "@/lib/sheets/memory-gateway";
import { SurveyStore } from "@/lib/store/survey-store";
import { isTestSurvey, type RawAnswers, type SurveySpec } from "@/lib/survey-core";
import { mdWithDeadline, specOf } from "../survey-core/helpers";

const NOW = new Date("2026-11-11T10:00:00+09:00");
const admin = { email: "admin@example.org", role: "admin" as const };
const viewer = { email: "viewer@example.org", role: "viewer" as const };
let gw: MemoryGateway;
let store: SurveyStore;

const ans: RawAnswers = {
  Q1: "참여자주도형(국내)",
  Q2: ["쉼을 통한 회복"],
  Q3: ["동료 네트워크"],
  Q4: 5,
  Q5: 4,
  Q6: 4,
  Q7: 4,
  Q8: 4,
  Q9: "연차 사용",
  Q10: "하고 있다",
  Q11: "있음",
};

async function published(spec: SurveySpec) {
  const c = await store.createDraft(spec, "admin@example.org");
  if (!c.ok) throw new Error(c.error);
  const p = await store.publish(c.value.id);
  if (!p.ok) throw new Error(p.error);
  return p.value.record;
}

beforeEach(async () => {
  gw = new MemoryGateway();
  store = new SurveyStore(gw, { now: () => NOW, cacheMs: 0 });
  await store.ensureTabs();
  await store.addStaff("admin@example.org", "admin");
});

describe("시험 데이터 정리", () => {
  it("시험 설문 판별: 링크 주소 test-, 제목·사업명 [시험]", () => {
    const s = specOf(mdWithDeadline("2026-12-01"));
    expect(isTestSurvey(s)).toBe(false);
    expect(isTestSurvey({ ...s, slug: "test-x" })).toBe(true);
    expect(isTestSurvey({ ...s, title: " [시험] 송년회" })).toBe(true);
    expect(isTestSurvey({ ...s, program: "[시험] 힐링캠프" })).toBe(true);
  });

  it("응답이 있는 시험 설문도 응답 탭·집계까지 지우고, 실제 설문은 건드리지 않음", async () => {
    const real = await published(specOf(mdWithDeadline("2026-12-01", "real-2026")));
    const test = await published({ ...specOf(mdWithDeadline("2026-12-01", "test-2026")), title: "[시험] 힐링" });
    await store.submitResponse("real-2026", ans);
    await store.submitResponse("test-2026", ans);
    await store.submitResponse("test-2026", ans);
    await store.refreshSummary(test);

    const r = await cmd.purgeTestSurveys(store, admin, [test.id, real.id]);
    expect(r).toEqual({ ok: true, value: { surveys: 1, responses: 2, skipped: 1 } });
    expect(await gw.listTabs()).not.toContain("r_test-2026");
    expect(await gw.listTabs()).toContain("r_real-2026");
    expect((await store.listSurveys()).map((s) => s.id)).toEqual([real.id]);
    expect((await store.readSummaries()).has(test.id)).toBe(false);
    expect(await store.countResponses(real)).toBe(1);
  });

  it("권한·입력 검사", async () => {
    expect(await cmd.purgeTestSurveys(store, viewer, ["s_abcd"])).toEqual({ ok: false, error: "권한이 없음" });
    expect(await cmd.purgeTestSurveys(store, null, ["s_abcd"])).toEqual({ ok: false, error: "권한이 없음" });
    expect((await cmd.purgeTestSurveys(store, admin, [])).ok).toBe(false);
    expect((await cmd.purgeTestSurveys(store, admin, "s_abcd")).ok).toBe(false);
    expect((await cmd.purgeTestSurveys(store, admin, ["../x"])).ok).toBe(false);
  });
});

describe("복제", () => {
  it("문항·사업명·분류를 유지한 새 초안, 링크 주소는 겹치지 않게, 마감일은 14일 뒤", async () => {
    const src = await published(specOf(mdWithDeadline("2026-12-01", "healing2026")));
    const a = await cmd.duplicateSurvey(store, admin, src.id, NOW);
    const b = await cmd.duplicateSurvey(store, admin, src.id, NOW);
    if (!a.ok || !b.ok) throw new Error("복제 실패");
    const ra = (await store.getById(a.value.id))!;
    const rb = (await store.getById(b.value.id))!;
    expect([ra.status, ra.spec.slug, ra.spec.title, ra.spec.deadline, ra.spec.year]).toEqual([
      "draft",
      "healing2026-copy",
      "2026 서울사회복지사 힐링캠프 만족도 설문 (복사본)",
      "2026-11-25 23:59",
      2026,
    ]);
    expect(rb.spec.slug).toBe("healing2026-copy2");
    expect(ra.spec.questions).toEqual(src.spec.questions);
    expect([ra.spec.program, ra.spec.category, ra.spec.kpiQuestionId]).toEqual([src.spec.program, src.spec.category, src.spec.kpiQuestionId]);
    expect(ra.createdBy).toBe("admin@example.org");
    // 복사본을 다시 복제해도 '(복사본)' 이 겹치지 않음
    const c = await cmd.duplicateSurvey(store, admin, a.value.id, NOW);
    if (!c.ok) throw new Error();
    expect((await store.getById(c.value.id))!.spec.title).toBe("2026 서울사회복지사 힐링캠프 만족도 설문 (복사본)");
    expect((await store.getById(c.value.id))!.spec.slug).toBe("healing2026-copy3");
  });

  it("권한·없는 설문", async () => {
    expect(await cmd.duplicateSurvey(store, viewer, "s_abcd")).toEqual({ ok: false, error: "권한이 없음" });
    expect((await cmd.duplicateSurvey(store, admin, "s_none1")).ok).toBe(false);
  });
});

describe("직원 관리", () => {
  it("추가·역할 변경·사용 중지·다시 사용", async () => {
    expect(await cmd.addStaffMember(store, admin, " Kim@SASW.or.kr ", "viewer", "sasw.or.kr")).toEqual({ ok: true, value: {} });
    expect((await store.listStaff()).find((m) => m.email === "kim@sasw.or.kr")).toMatchObject({ role: "viewer", active: true });
    expect((await cmd.changeStaffMember(store, admin, "kim@sasw.or.kr", { role: "admin" })).ok).toBe(true);
    expect(await store.getStaffRole("kim@sasw.or.kr")).toBe("admin");
    expect((await cmd.changeStaffMember(store, admin, "kim@sasw.or.kr", { active: false })).ok).toBe(true);
    expect(await store.getStaffRole("kim@sasw.or.kr")).toBeNull();
    const addedAt = (await store.listStaff()).find((m) => m.email === "kim@sasw.or.kr")!.addedAt;
    expect((await cmd.changeStaffMember(store, admin, "kim@sasw.or.kr", { active: true })).ok).toBe(true);
    expect((await store.listStaff()).find((m) => m.email === "kim@sasw.or.kr")).toMatchObject({ role: "admin", active: true, addedAt });
  });

  it("허용 도메인 밖이면 추가는 하되 로그인할 수 없다고 알려 줌", async () => {
    const r = await cmd.addStaffMember(store, admin, "someone@gmail.com", "viewer", "sasw.or.kr");
    expect(r.ok && r.value.warning).toContain("허용 도메인(sasw.or.kr) 밖");
  });

  it("자기 자신을 낮추거나 끌 수 없고, 마지막 활성 담당자는 남겨야 함", async () => {
    expect(await cmd.changeStaffMember(store, admin, "admin@example.org", { role: "viewer" })).toEqual({ ok: false, error: "자기 자신의 담당자 권한은 낮추거나 끌 수 없음" });
    expect(await cmd.changeStaffMember(store, admin, "admin@example.org", { active: false })).toMatchObject({ ok: false });
    // 다른 담당자가 마지막 담당자를 끄려는 경우
    const other = { email: "other@example.org", role: "admin" as const };
    expect(await cmd.changeStaffMember(store, other, "admin@example.org", { active: false })).toEqual({ ok: false, error: "활성 담당자가 최소 한 명은 있어야 함" });
    await store.addStaff("other@example.org", "admin");
    expect((await cmd.changeStaffMember(store, other, "admin@example.org", { active: false })).ok).toBe(true);
  });

  it("권한·입력 검사", async () => {
    expect(await cmd.addStaffMember(store, viewer, "a@b.org", "admin")).toEqual({ ok: false, error: "권한이 없음" });
    expect(await cmd.changeStaffMember(store, null, "admin@example.org", { active: false })).toEqual({ ok: false, error: "권한이 없음" });
    expect((await cmd.addStaffMember(store, admin, "not-email", "admin")).ok).toBe(false);
    expect((await cmd.addStaffMember(store, admin, "a@b.org", "owner")).ok).toBe(false);
    expect((await cmd.changeStaffMember(store, admin, "admin@example.org", { role: "owner" })).ok).toBe(false);
    expect((await cmd.changeStaffMember(store, admin, "admin@example.org", { active: "no" })).ok).toBe(false);
    expect((await cmd.changeStaffMember(store, admin, "admin@example.org", {})).ok).toBe(false);
    expect((await cmd.changeStaffMember(store, admin, "nobody@example.org", { active: false })).ok).toBe(false);
  });
});

describe("응답 현황", () => {
  it("이틀 안이면 시간대별(빈 시간 채움), 가장 많은 때 표시", () => {
    const t = responseTimeline(["2026-11-10 14:00", "2026-11-10 14:00", "2026-11-10 16:00", "2026-11-11 09:00"]);
    expect(t.unit).toBe("hour");
    expect(t.total).toBe(4);
    expect(t.bars[0]).toEqual({ key: "2026-11-10 14", label: "11.10 14시", count: 2 });
    expect(t.bars.length).toBe(20); // 10일 14시 ~ 11일 9시
    expect(t.bars.at(-1)).toMatchObject({ label: "11.11 9시", count: 1 });
    expect(t.peak?.count).toBe(2);
  });

  it("하루 안이면 날짜 없이 시만", () => {
    const t = responseTimeline(["2026-11-10 09:00", "2026-11-10 11:00"]);
    expect(t.bars.map((b) => b.label)).toEqual(["9시", "10시", "11시"]);
  });

  it("길면 날짜별(빈 날 채움), 31일을 넘으면 최근 31일만, 옛 형식 시각도 읽음", () => {
    const t = responseTimeline(["2026-11-01 10:00", "2026-11-05 10:22:33", "2026-11-05 11:00"]);
    expect(t.unit).toBe("day");
    expect(t.bars.map((b) => [b.label, b.count])).toEqual([
      ["11.1", 1],
      ["11.2", 0],
      ["11.3", 0],
      ["11.4", 0],
      ["11.5", 2],
    ]);
    const long = responseTimeline(["2026-01-01 10:00", "2026-03-01 10:00"]);
    expect(long.bars).toHaveLength(31);
    expect(long.bars.at(-1)?.key).toBe("2026-03-01");
  });

  it("응답이 없거나 형식이 틀리면 빈 현황", () => {
    expect(responseTimeline([])).toEqual({ unit: "day", bars: [], total: 0, peak: null });
    expect(responseTimeline(["엉터리"]).total).toBe(0);
  });
});
