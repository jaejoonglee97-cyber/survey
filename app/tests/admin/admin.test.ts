import { beforeEach, describe, expect, it } from "vitest";
import * as cmd from "@/lib/admin/commands";
import { buildCsv, csvFileName } from "@/lib/admin/csv";
import * as ops from "@/lib/admin/editor-ops";
import { daysLeft, dLabel, homeStats, responseRate, sortForList, type OverviewItem } from "@/lib/admin/overview";
import { canAccess, devLoginEnabled, isAllowedEmail, safeCallbackPath } from "@/lib/auth/policy";
import { MemoryGateway } from "@/lib/sheets/memory-gateway";
import { SurveyStore } from "@/lib/store/survey-store";
import { exportMd, importMd, validateDraft, type SurveySpec } from "@/lib/survey-core";
import { mdWithDeadline, specOf } from "../survey-core/helpers";

const NOW = new Date("2026-11-09T12:00:00+09:00");
const admin = { email: "admin@example.org", role: "admin" as const };
const viewer = { email: "viewer@example.org", role: "viewer" as const };

describe("접근 규칙", () => {
  it("담당자만 관리, 열람자는 대시보드만, 비로그인은 모두 거부", () => {
    expect([canAccess("admin", "admin"), canAccess("admin", "dashboard")]).toEqual([true, true]);
    expect([canAccess("viewer", "admin"), canAccess("viewer", "dashboard")]).toEqual([false, true]);
    expect([canAccess(null, "admin"), canAccess(undefined, "dashboard")]).toEqual([false, false]);
  });

  it("허용 도메인: 대소문자 무시, 여러 개, 비어 있으면 아무도 허용 안 함", () => {
    expect(isAllowedEmail("Kim@SASW.or.kr", "sasw.or.kr")).toBe(true);
    expect(isAllowedEmail("kim@sasw.or.kr", " @sasw.or.kr , example.org")).toBe(true);
    expect(isAllowedEmail("kim@gmail.com", "sasw.or.kr")).toBe(false);
    expect(isAllowedEmail("kim@evil-sasw.or.kr", "sasw.or.kr")).toBe(false);
    expect(isAllowedEmail("kim@sasw.or.kr.evil.com", "sasw.or.kr")).toBe(false);
    expect(isAllowedEmail("kim@sasw.or.kr", "")).toBe(false);
    expect(isAllowedEmail("kim@sasw.or.kr", undefined)).toBe(false);
    expect(isAllowedEmail("not-email", "sasw.or.kr")).toBe(false);
    expect(isAllowedEmail(null, "sasw.or.kr")).toBe(false);
  });

  it("개발용 로그인은 로컬 더미 모드의 개발 서버에서만", () => {
    expect(devLoginEnabled({ DATA_BACKEND: "local", NODE_ENV: "development" })).toBe(true);
    expect(devLoginEnabled({ DATA_BACKEND: "local", NODE_ENV: "production" })).toBe(false);
    expect(devLoginEnabled({ DATA_BACKEND: "local", VERCEL: "1" })).toBe(false);
    expect(devLoginEnabled({ DATA_BACKEND: "google" })).toBe(false);
    expect(devLoginEnabled({})).toBe(false);
  });

  it("로그인 뒤 이동 주소는 /survey 아래만(외부 주소 차단)", () => {
    expect(safeCallbackPath("/survey/list", "admin")).toBe("/survey/list");
    expect(safeCallbackPath("https://evil.example/survey", "admin")).toBe("/survey");
    expect(safeCallbackPath("//evil.example/survey", "admin")).toBe("/survey");
    expect(safeCallbackPath("/survey\\..\\x", "admin")).toBe("/survey");
    expect(safeCallbackPath(null, "viewer")).toBe("/survey/dashboard");
    expect(safeCallbackPath("/s/healing2026", null)).toBe("/survey");
  });
});

// ───────── 담당자 동작: 권한·입력 검증 ─────────

let gw: MemoryGateway;
let store: SurveyStore;
const spec = () => specOf(mdWithDeadline("2026-12-01 18:00"));

beforeEach(async () => {
  gw = new MemoryGateway();
  store = new SurveyStore(gw, { now: () => NOW, cacheMs: 0 });
  await store.ensureTabs();
});

describe("담당자 동작", () => {
  it("열람자·비로그인은 모든 관리 동작이 거부되고 데이터가 바뀌지 않음", async () => {
    const created = await cmd.saveDraft(store, admin, null, spec());
    if (!created.ok) throw new Error(created.error);
    const id = created.value.id;
    const before = JSON.stringify(gw.raw("surveys"));
    for (const actor of [viewer, null]) {
      expect(await cmd.saveDraft(store, actor, null, spec())).toEqual({ ok: false, error: "권한이 없음" });
      expect(await cmd.saveDraft(store, actor, id, spec())).toEqual({ ok: false, error: "권한이 없음" });
      expect(await cmd.publishSurvey(store, actor, id)).toEqual({ ok: false, error: "권한이 없음" });
      expect(await cmd.changeDeadline(store, actor, id, "2026-12-30")).toEqual({ ok: false, error: "권한이 없음" });
      expect(await cmd.changeStatus(store, actor, id, "closed")).toEqual({ ok: false, error: "권한이 없음" });
      expect(await cmd.removeSurvey(store, actor, id)).toEqual({ ok: false, error: "권한이 없음" });
    }
    expect(JSON.stringify(gw.raw("surveys"))).toBe(before);
  });

  it("담당자: 초안 저장 → 수정 → 게시 → 마감일 변경 → 지금 마감", async () => {
    const c = await cmd.saveDraft(store, admin, null, spec());
    if (!c.ok) throw new Error(c.error);
    const id = c.value.id;
    expect((await store.getById(id))?.createdBy).toBe("admin@example.org");
    expect((await cmd.saveDraft(store, admin, id, { ...spec(), title: "고친 제목" })).ok).toBe(true);
    expect(await cmd.publishSurvey(store, admin, id)).toEqual({ ok: true, value: { slug: "healing2026" } });
    expect((await store.readSummaries()).get(id)?.n).toBe(0);
    expect((await cmd.changeDeadline(store, admin, id, "2026-12-20 18:00")).ok).toBe(true);
    expect((await cmd.changeStatus(store, admin, id, "closed")).ok).toBe(true);
    expect((await store.getById(id))?.state).toBe("closed");
    expect((await cmd.changeStatus(store, admin, id, "open")).ok).toBe(true);
    expect((await cmd.removeSurvey(store, admin, id)).ok).toBe(true);
  });

  it("잘못된 입력은 거부: 형식이 틀린 설문, 이상한 id, 잘못된 상태 값", async () => {
    expect(await cmd.saveDraft(store, admin, null, { title: 1 })).toEqual({ ok: false, error: "설문 내용 형식이 올바르지 않음" });
    expect(await cmd.saveDraft(store, admin, null, { ...spec(), questions: [{ id: "x", type: "evil" }] })).toMatchObject({ ok: false });
    expect(await cmd.saveDraft(store, admin, "../surveys", spec())).toMatchObject({ ok: false });
    expect(await cmd.publishSurvey(store, admin, "DROP")).toMatchObject({ ok: false });
    expect(await cmd.changeStatus(store, admin, "s_abcd", "deleted")).toMatchObject({ ok: false, error: "요청이 올바르지 않음" });
    expect(await cmd.changeDeadline(store, admin, "s_abcd", 123)).toMatchObject({ ok: false });
    expect(await cmd.removeSurvey(store, admin, "nope")).toMatchObject({ ok: false });
    expect(await cmd.changeStatus(store, admin, "s_abcd", "closed")).toMatchObject({ ok: false, error: "설문을 찾을 수 없음" });
  });

  it("초안 수정도 기본 정보 검사를 거침(이상한 slug·마감일 저장 불가)", async () => {
    const c = await cmd.saveDraft(store, admin, null, spec());
    if (!c.ok) throw new Error(c.error);
    expect((await cmd.saveDraft(store, admin, c.value.id, { ...spec(), slug: "bad slug\"" })).ok).toBe(false);
    expect((await cmd.saveDraft(store, admin, c.value.id, { ...spec(), deadline: "내일" })).ok).toBe(false);
    expect((await cmd.saveDraft(store, admin, c.value.id, { ...spec(), deadline: "2026-02-31 10:00" })).ok).toBe(false);
    expect((await cmd.saveDraft(store, admin, c.value.id, { ...spec(), title: "" })).ok).toBe(false);
  });

  it("점검 오류가 있으면 저장은 되지만 게시는 거부(개인정보 문항)", async () => {
    const bad: SurveySpec = { ...spec(), questions: [...spec().questions, { id: "Q13", type: "text", text: "성함을 적어 주십시오", required: false }] };
    const c = await cmd.saveDraft(store, admin, null, bad);
    if (!c.ok) throw new Error(c.error);
    const p = await cmd.publishSurvey(store, admin, c.value.id);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.error).toContain("개인을 알 수 있는 정보");
  });
});

// ───────── 편집기 동작 ─────────

describe("편집기", () => {
  const start = () => ops.starterSpec(NOW);

  it("새 설문 기본안: 대표 문항 지정, 마감 14일 뒤, 기본 정보만 채우면 게시 가능", () => {
    const s = start();
    expect(s.kpiQuestionId).toBe("Q1");
    expect(s.deadline).toBe("2026-11-23 23:59");
    const filled = ops.syncKpiText({ ...s, title: "2026 송년회 만족도 설문", slug: "party2026", program: "송년회" }, "", "송년회");
    expect(filled.questions[0].text).toBe("송년회에 대해 전반적으로 만족하십니까?");
    expect(validateDraft(ops.tidy(filled)).errorCount).toBe(0);
    // 빈 기본 정보는 오류
    expect(validateDraft(ops.tidy(s)).errorCount).toBeGreaterThan(0);
  });

  it("사업명을 바꿔도 담당자가 고친 대표 문구는 건드리지 않음", () => {
    let s = ops.syncKpiText({ ...start(), program: "송년회" }, "", "송년회");
    s = ops.updateQuestion(s, "Q1", { text: "직접 고친 문구" });
    expect(ops.syncKpiText(s, "송년회", "신년회").questions[0].text).toBe("직접 고친 문구");
  });

  it("추가·이동·삭제: id 는 유지, 대표 문항 삭제 시 지정 해제", () => {
    let s = ops.addQuestion(start(), "multi");
    expect(s.questions.at(-1)).toMatchObject({ id: "Q6", type: "multi", max: 0 });
    s = ops.moveQuestion(s, "Q6", -1);
    expect(s.questions.map((q) => q.id)).toEqual(["Q1", "Q2", "Q3", "Q4", "Q6", "Q5"]);
    expect(ops.moveQuestion(s, "Q1", -1)).toBe(s);
    expect(ops.moveQuestion(s, "Q5", 1)).toBe(s);
    s = ops.removeQuestion(s, "Q6");
    s = ops.addQuestion(s, "text");
    expect(s.questions.at(-1)?.id).toBe("Q6");
    s = ops.removeQuestion(s, "Q1");
    expect(s.kpiQuestionId).toBeNull();
    s = ops.setKpi(s, "Q2");
    expect(s.kpiQuestionId).toBe("Q2");
    expect(ops.setKpi(s, "Q4")).toBe(s); // 선택형은 대표 문항이 될 수 없음
  });

  it("유형 변경: 선택형끼리는 보기 유지, 대표 문항이 5점이 아니게 되면 지정 해제", () => {
    let s = ops.changeType(start(), "Q4", "multi");
    expect(s.questions[3].options?.length).toBe(4);
    s = ops.changeType(s, "Q1", "single");
    expect(s.kpiQuestionId).toBeNull();
    expect(s.questions[0].options).toEqual([{ label: "" }, { label: "" }]);
    s = ops.changeType(s, "Q2", "text");
    expect(s.questions[1].required).toBe(false);
    expect(ops.changeType(s, "Q2", "text")).toEqual(s);
  });

  it("보기 편집과 정리(tidy): 공백 제거, 빈 선택 필드 제거, 연도는 마감일에서", () => {
    let s = ops.setOptions(start(), "Q4", [{ label: " 예 " }, { label: "기타", other: true }]);
    s = { ...s, title: "  t ", slug: " ABC ", deadline: "2027-01-05T10:00", target: 0 };
    const t = ops.tidy(s);
    expect(t.questions[3].options).toEqual([{ label: "예" }, { label: "기타", other: true }]);
    expect([t.title, t.slug, t.deadline, t.year, t.target]).toEqual(["t", "abc", "2027-01-05 10:00", 2027, undefined]);
    expect(ops.tidy({ ...s, deadline: "엉터리" }).deadline).toBe("엉터리");
  });

  it("지난 문항 불러오기: 문항·대표 문항·안내문을 그대로 가져와 이전 설문과 비교 경고가 없음", () => {
    const prev = specOf(mdWithDeadline("2025-12-10", "healing2025"));
    const s = ops.copyQuestionsFrom({ ...start(), title: "2026 힐링캠프", slug: "healing2026x", program: "힐링캠프" }, prev);
    expect(s.questions).toEqual(prev.questions);
    expect(s.kpiQuestionId).toBe("Q4");
    const r = validateDraft(ops.tidy(s), { previous: prev });
    expect(r.issues.filter((i) => i.code === "PREV_WORDING_CHANGED")).toEqual([]);
    expect(ops.copyQuestionsFrom(start(), { ...prev, intro: "" }).intro).toBe(start().intro);
  });

  it("편집기에서 만든 설문을 md 로 내보내고 다시 불러오면 같은 설문", () => {
    const s = ops.tidy(ops.syncKpiText({ ...start(), title: "송년회 설문", slug: "party2026", program: "송년회" }, "", "송년회"));
    expect(importMd(exportMd(s)).spec).toEqual(s);
  });
});

// ───────── 홈·목록 계산, CSV ─────────

const item = (over: Partial<OverviewItem>): OverviewItem => ({
  id: "s_x",
  title: "t",
  slug: "t",
  category: "행사",
  program: "p",
  year: 2026,
  deadline: "2026-11-12 23:59",
  state: "open",
  responses: 0,
  ...over,
});

describe("설문 홈·목록 계산", () => {
  it("D-day 는 한국 날짜 기준", () => {
    expect(daysLeft("2026-11-09 23:59", NOW)).toBe(0);
    expect(daysLeft("2026-11-10 00:30", new Date("2026-11-09T23:50:00+09:00"))).toBe(1);
    expect(daysLeft("2026-11-08", NOW)).toBe(-1);
    expect(daysLeft("엉터리", NOW)).toBeNull();
    expect([dLabel(0), dLabel(3), dLabel(-2), dLabel(null)]).toEqual(["D-day", "D-3", "D+2", ""]);
  });

  it("진행 중·이번 주 마감·올해 응답", () => {
    const s = homeStats(
      [
        item({ id: "a", deadline: "2026-11-12 23:59", responses: 10 }),
        item({ id: "b", deadline: "2026-12-30 23:59", responses: 5 }),
        item({ id: "c", state: "closed", deadline: "2026-10-01 18:00", responses: 40 }),
        item({ id: "d", state: "closed", year: 2025, deadline: "2025-12-10 23:59", responses: 30 }),
        item({ id: "e", state: "draft", responses: 0 }),
      ],
      NOW,
    );
    expect([s.openCount, s.closingThisWeek, s.yearResponses, s.year]).toEqual([2, 1, 55, 2026]);
    expect(s.closingSoon.map((i) => [i.id, i.days])).toEqual([
      ["a", 3],
      ["b", 51],
    ]);
    expect(s.recentClosed.map((i) => i.id)).toEqual(["c", "d"]);
  });

  it("목록 정렬: 진행 중(마감 가까운 순) → 초안 → 마감(최근 순), 응답률", () => {
    const sorted = sortForList([
      item({ id: "closed-old", state: "closed", deadline: "2025-01-01 00:00" }),
      item({ id: "open-late", deadline: "2026-12-30 00:00" }),
      item({ id: "draft", state: "draft" }),
      item({ id: "closed-new", state: "closed", deadline: "2026-10-01 00:00" }),
      item({ id: "open-soon", deadline: "2026-11-10 00:00" }),
    ]);
    expect(sorted.map((i) => i.id)).toEqual(["open-soon", "open-late", "draft", "closed-new", "closed-old"]);
    expect([responseRate(3, 40), responseRate(3, undefined)]).toEqual([7.5, null]);
  });

  it("CSV: BOM, 머리글, 쉼표·따옴표·줄바꿈 처리, 수식 주입 차단 유지", () => {
    const s = { questions: [{ id: "Q1", type: "text" as const, text: "의견, \"자유\"", required: false }] };
    const csv = buildCsv(s, [["'=1+1"], ["a,b"], ["줄\n바꿈"], ["+82"]], ["2026-11-09 12:00:00", "t2", "t3", "t4"]);
    expect(csv.startsWith("﻿제출 시각,\"Q1 의견, \"\"자유\"\"\"\r\n")).toBe(true);
    expect(csv).toContain("2026-11-09 12:00:00,'=1+1\r\n");
    expect(csv).toContain('t2,"a,b"\r\n');
    expect(csv).toContain('t3,"줄\n바꿈"\r\n');
    expect(csv).toContain("t4,'+82\r\n");
    expect(csvFileName("healing2026", NOW)).toBe("healing2026-responses-20261109.csv");
  });
});

describe("응답 수 한 번에 세기", () => {
  it("초안·응답 탭 없음은 0", async () => {
    const c = await cmd.saveDraft(store, admin, null, spec());
    if (!c.ok) throw new Error();
    await cmd.publishSurvey(store, admin, c.value.id);
    await store.submitResponse("healing2026", {
      Q1: "참여자주도형(국내)",
      Q2: ["쉼을 통한 회복"],
      Q3: ["동료 네트워크"],
      Q4: 5,
      Q5: 3,
      Q6: 4,
      Q7: 4,
      Q8: 5,
      Q9: "연차 사용",
      Q10: "하고 있다",
      Q11: "있음",
    });
    const d = await cmd.saveDraft(store, admin, null, specOf(mdWithDeadline("2026-12-01", "draft-x")));
    if (!d.ok) throw new Error();
    const counts = await store.responseCounts(await store.listSurveys());
    expect(counts.get(c.value.id)).toBe(1);
    expect(counts.get(d.value.id)).toBe(0);
  });
});
