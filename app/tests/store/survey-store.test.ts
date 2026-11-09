import { beforeEach, describe, expect, it } from "vitest";
import { MemoryGateway } from "@/lib/sheets/memory-gateway";
import { FIXED_TABS } from "@/lib/sheets/schema";
import { formatKst, responseHeader, SurveyStore } from "@/lib/store/survey-store";
import { PII_NOTICE, type RawAnswers, type SurveySpec } from "@/lib/survey-core";
import { mdWithDeadline, specOf } from "../survey-core/helpers";

// 프로토타입 시험 3절(서버 전체 흐름)을 저장소 기준으로 이식

let gw: MemoryGateway;
let clock: Date;
let store: SurveyStore;
let ids = 0;
const at = (iso: string) => (clock = new Date(iso));

const healing = (): SurveySpec => specOf(mdWithDeadline("2026-11-12 18:00"));
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

async function published(spec = healing()) {
  const c = await store.createDraft(spec, "admin@example.org");
  if (!c.ok) throw new Error(c.error);
  const p = await store.publish(c.value.id);
  if (!p.ok) throw new Error(p.error);
  return p.value.record;
}

beforeEach(async () => {
  gw = new MemoryGateway();
  at("2026-11-09T12:00:00+09:00");
  ids = 0;
  store = new SurveyStore(gw, { now: () => clock, cacheMs: 0, newId: () => `s_test${++ids}` });
  await store.ensureTabs();
});

describe("탭 준비", () => {
  it("고정 탭 3개를 머리글과 함께 만들고, 다시 실행해도 그대로", async () => {
    expect((await gw.listTabs()).sort()).toEqual(["staff", "summary", "surveys"]);
    expect(gw.raw("surveys")[0]).toEqual([...FIXED_TABS.surveys]);
    expect((await store.ensureTabs()).every((p) => p.action === "ok")).toBe(true);
  });

  it("다른 머리글은 덮어쓰지 않음", async () => {
    await gw.updateRow("staff", 1, ["email", "권한"]);
    const plan = await store.ensureTabs();
    expect(plan.find((p) => p.tab === "staff")?.action).toBe("mismatch");
    expect(gw.raw("staff")[0]).toEqual(["email", "권한"]);
  });
});

describe("설문 생성·게시", () => {
  it("초안 생성 → 게시하면 응답 탭이 문항 열과 함께 만들어짐", async () => {
    const c = await store.createDraft(healing(), "admin@example.org");
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.value.status).toBe("draft");
    expect(await gw.listTabs()).not.toContain("r_healing2026");
    const p = await store.publish(c.value.id);
    expect(p.ok).toBe(true);
    const hdr = gw.raw("r_healing2026")[0];
    expect(hdr).toHaveLength(13);
    expect(hdr[0]).toBe("submitted_at");
    expect(hdr[1]).toBe("Q1 참여하신 힐링캠프 유형은 무엇입니까?");
    const rec = await store.getById(c.value.id);
    expect([rec?.status, rec?.state, rec?.publishedAt]).toEqual(["open", "open", "2026-11-09 12:00:00"]);
  });

  it("slug 중복·지난 마감일·점검 오류는 거부", async () => {
    await published();
    expect((await store.createDraft(healing(), "a")).ok).toBe(false);
    const past = await store.createDraft(specOf(mdWithDeadline("2026-11-01", "past-test")), "a");
    expect(past.ok).toBe(true);
    if (past.ok) expect(await store.publish(past.value.id)).toMatchObject({ ok: false, error: "마감일이 이미 지났음" });
    const noKpi = await store.createDraft({ ...specOf(mdWithDeadline("2026-12-01", "nokpi")), kpiQuestionId: null }, "a");
    if (noKpi.ok) {
      const r = await store.publish(noKpi.value.id);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("대표 만족도");
    }
    expect((await store.createDraft({ ...healing(), slug: "Bad Slug" }, "a")).ok).toBe(false);
  });

  it("게시할 때 서술 문항 안내 문구를 자동으로 넣음", async () => {
    const spec = { ...healing(), intro: "감사합니다." };
    const rec = await published(spec);
    expect(rec.spec.intro).toBe("감사합니다.\n" + PII_NOTICE);
  });

  it("초안만 고칠 수 있고, 게시 후에는 거부", async () => {
    const c = await store.createDraft(healing(), "a");
    if (!c.ok) throw new Error();
    const u = await store.updateDraft(c.value.id, { ...healing(), title: "바뀐 제목" });
    expect(u.ok && u.value.spec.title).toBe("바뀐 제목");
    await store.publish(c.value.id);
    expect(await store.updateDraft(c.value.id, healing())).toMatchObject({ ok: false, error: "게시된 설문의 문항은 바꿀 수 없음" });
    expect(await store.publish(c.value.id)).toMatchObject({ ok: false });
    expect(await store.updateDraft("s_none", healing())).toMatchObject({ ok: false });
  });

  it("초안 수정 시 다른 설문의 slug 로 바꿀 수 없음", async () => {
    await published();
    const c = await store.createDraft(specOf(mdWithDeadline("2026-12-01", "other")), "a");
    if (!c.ok) throw new Error();
    expect((await store.updateDraft(c.value.id, healing())).ok).toBe(false);
  });

  it("응답 탭이 남아 있는데 데이터가 있으면 게시를 거부(덮어쓰기 방지)", async () => {
    await gw.addTab("r_healing2026", ["submitted_at", "x"]);
    await gw.append("r_healing2026", [["2026", "y"]]);
    const c = await store.createDraft(healing(), "a");
    if (!c.ok) throw new Error();
    expect((await store.publish(c.value.id)).ok).toBe(false);
    expect(gw.raw("r_healing2026")).toHaveLength(2);
  });

  it("시트의 제목·안내문에 수식 주입 문자가 와도 셀에는 ' 가 붙고 읽을 때 복원", async () => {
    const rec = await published({ ...healing(), title: "=위험한 제목", program: "+사업" });
    const row = gw.raw("surveys")[1];
    expect(row[FIXED_TABS.surveys.indexOf("title")]).toBe("'=위험한 제목");
    expect(row[FIXED_TABS.surveys.indexOf("program")]).toBe("'+사업");
    expect((await store.getById(rec.id))?.spec.title).toBe("=위험한 제목");
  });
});

describe("응답 제출", () => {
  it("정상 저장, 잘못된 값 거부(시트에 저장되지 않음), 수식 주입 차단", async () => {
    await published();
    expect(await store.submitResponse("healing2026", ans())).toEqual({ code: "ok" });
    expect(
      (await store.submitResponse("healing2026", ans({ Q1: "참여자주도형(해외)", Q4: 4, Q5: 2, Q9: "기타: 기관 자체 지원", Q12: "=1+1" }))).code,
    ).toBe("ok");
    expect((await store.submitResponse("healing2026", ans({ Q1: "협회지정형(산티아고)", Q2: ["기타: 걷기 좋아서"], Q4: 3, Q12: undefined }))).code).toBe("ok");
    const before = gw.raw("r_healing2026").length;
    expect(await store.submitResponse("healing2026", ans({ Q4: 9 }))).toMatchObject({ code: "invalid", questionId: "Q4" });
    expect((await store.submitResponse("healing2026", ans({ Q1: undefined }))).code).toBe("invalid");
    expect((await store.submitResponse("nope-slug", ans())).code).toBe("notfound");
    expect((await store.submitResponse("../etc", ans())).code).toBe("notfound");
    expect(gw.raw("r_healing2026").length).toBe(before);
    expect(before).toBe(4);
    expect(gw.raw("r_healing2026")[2][12]).toBe("'=1+1");
    expect(gw.raw("r_healing2026")[1][0]).toBe("2026-11-09 12:00"); // 시 단위로만 기록
  });

  it("게시 전(초안) 설문에는 응답할 수 없음", async () => {
    await store.createDraft(healing(), "a");
    expect((await store.submitResponse("healing2026", ans())).code).toBe("notfound");
  });

  it("응답을 읽어 집계: 프로토타입과 같은 결과", async () => {
    const rec = await published();
    await store.submitResponse("healing2026", ans());
    await store.submitResponse("healing2026", ans({ Q4: 4, Q12: "=1+1" }));
    await store.submitResponse("healing2026", ans({ Q2: ["기타: 걷기 좋아서"], Q4: 3, Q12: undefined }));
    const agg = await store.aggregateSurvey((await store.getById(rec.id))!);
    const q4 = agg.questions.find((q) => q.id === "Q4");
    expect(agg.n).toBe(3);
    expect(q4).toMatchObject({ mean: 4, pos: 2, posPct: 66.7, dist: [0, 0, 1, 1, 1] });
    const q12 = agg.questions.find((q) => q.id === "Q12");
    expect(q12?.type === "text" && [...q12.texts].sort()).toEqual(["=1+1", "좋았음"].sort());
    expect(await store.countResponses(rec)).toBe(3);
  });

  it("응답 탭의 열을 시트에서 옮기면 읽기를 멈추고 알려 줌", async () => {
    const rec = await published();
    const hdr = [...gw.raw("r_healing2026")[0]];
    [hdr[1], hdr[2]] = [hdr[2], hdr[1]];
    await gw.updateRow("r_healing2026", 1, hdr);
    await expect(store.readResponses(rec)).rejects.toThrow(/머리글이 문항과 맞지 않음/);
  });

  it("빈 줄은 건너뛰고 짧은 행은 빈 칸으로 채움", async () => {
    const rec = await published();
    await gw.append("r_healing2026", [[""], ["2026-11-09 13:00:00", "참여자주도형(국내)"]]);
    const r = await store.readResponses(rec);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toHaveLength(12);
    expect(r.submittedAt).toEqual(["2026-11-09 13:00:00"]);
  });

  it("초안의 응답은 비어 있음", async () => {
    const c = await store.createDraft(healing(), "a");
    if (!c.ok) throw new Error();
    expect(await store.readResponses(c.value)).toEqual({ rows: [], submittedAt: [] });
  });
});

describe("마감·연장·재개방 (프로토타입 사례)", () => {
  it("마감일 연장·수동 마감·재개방 규칙", async () => {
    const rec = await published();
    expect((await store.setDeadline(rec.id, "내일")).ok).toBe(false);
    const ext = await store.setDeadline(rec.id, "2026-11-20");
    expect(ext.ok && [ext.value.spec.deadline, ext.value.state]).toEqual(["2026-11-20 23:59", "open"]);
    expect((await store.setStatus(rec.id, "closed")).ok).toBe(true);
    expect(await store.getOpenBySlug("healing2026")).toBeNull();
    expect((await store.submitResponse("healing2026", ans())).code).toBe("closed");
    expect((await store.setStatus(rec.id, "open")).ok).toBe(true);
    expect((await store.getOpenBySlug("healing2026"))?.state).toBe("open");
  });

  it("마감 시각 경과: 응답 차단, 결과 메일 대상 1회, 연장 후 재마감 시 다시 대상", async () => {
    const rec = await published();
    await store.setDeadline(rec.id, "2026-11-20");
    await store.submitResponse("healing2026", ans());
    at("2026-11-20T23:59:30+09:00");
    expect((await store.getBySlug("healing2026"))?.state).toBe("open");
    expect((await store.submitResponse("healing2026", ans())).code).toBe("ok");
    at("2026-11-21T00:00:30+09:00");
    expect((await store.getBySlug("healing2026"))?.state).toBe("closed");
    expect((await store.submitResponse("healing2026", ans())).code).toBe("closed");
    expect(await store.setStatus(rec.id, "open")).toMatchObject({ ok: false, error: "마감일이 지난 설문은 먼저 마감일을 연장해야 함" });

    expect((await store.listClosedUnnotified()).map((s) => s.id)).toEqual([rec.id]);
    await store.markClosedNotified(rec.id);
    expect(await store.listClosedUnnotified()).toEqual([]);

    await store.setDeadline(rec.id, "2026-11-30 12:00");
    expect((await store.getBySlug("healing2026"))?.state).toBe("open");
    expect((await store.getById(rec.id))?.closedNotifiedAt).toBe("");
    expect((await store.submitResponse("healing2026", ans())).code).toBe("ok");
    at("2026-12-01T09:00:00+09:00");
    expect((await store.listClosedUnnotified()).map((s) => s.id)).toEqual([rec.id]);
    expect(await store.countResponses(rec)).toBe(3);
  });

  it("담당자가 직접 마감한 설문은 마감일을 연장해도 닫힌 채로 둠", async () => {
    const rec = await published();
    await store.setStatus(rec.id, "closed");
    const r = await store.setDeadline(rec.id, "2026-12-30");
    expect(r.ok && r.value.state).toBe("closed");
    expect((await store.getById(rec.id))?.closedAt).toBe("2026-11-09 12:00:00");
  });

  it("초안은 마감 상태를 바꿀 수 없음, 없는 설문 처리", async () => {
    const c = await store.createDraft(healing(), "a");
    if (!c.ok) throw new Error();
    expect((await store.setStatus(c.value.id, "closed")).ok).toBe(false);
    expect((await store.setStatus("s_none", "closed")).ok).toBe(false);
    expect((await store.setDeadline("s_none", "2026-12-01")).ok).toBe(false);
    expect((await store.markClosedNotified("s_none")).ok).toBe(false);
  });
});

describe("삭제", () => {
  it("응답이 있는 설문은 거부, 응답이 없는 설문은 응답 탭까지 삭제", async () => {
    const rec = await published();
    await store.submitResponse("healing2026", ans());
    expect(await store.deleteSurvey(rec.id)).toMatchObject({ ok: false, error: "응답이 있는 설문은 삭제할 수 없음" });
    const empty = await published(specOf(mdWithDeadline("2026-12-31", "empty-test")));
    expect(await gw.listTabs()).toContain("r_empty-test");
    await store.refreshSummary(empty);
    expect((await store.deleteSurvey(empty.id)).ok).toBe(true);
    expect(await gw.listTabs()).not.toContain("r_empty-test");
    expect((await store.listSurveys()).map((s) => s.spec.slug)).toEqual(["healing2026"]);
    expect((await store.readSummaries()).has(empty.id)).toBe(false);
    expect((await store.deleteSurvey("s_none")).ok).toBe(false);
  });

  it("초안 삭제", async () => {
    const c = await store.createDraft(healing(), "a");
    if (!c.ok) throw new Error();
    expect((await store.deleteSurvey(c.value.id)).ok).toBe(true);
    expect(await store.listSurveys()).toEqual([]);
  });
});

describe("설문 목록 읽기", () => {
  it("시트에서 손상된 행은 건너뜀", async () => {
    await published();
    const bad = [...gw.raw("surveys")[1]];
    bad[0] = "s_bad";
    bad[FIXED_TABS.surveys.indexOf("questions_json")] = "{깨진 JSON";
    await gw.append("surveys", [bad]);
    const bad2 = [...gw.raw("surveys")[1]];
    bad2[FIXED_TABS.surveys.indexOf("status")] = "unknown";
    await gw.append("surveys", [bad2]);
    expect((await store.listSurveys()).map((s) => s.id)).toEqual(["s_test1"]);
  });

  it("공개 경로는 짧게 캐시함(목록을 매번 읽지 않음)", async () => {
    const cached = new SurveyStore(gw, { now: () => clock, cacheMs: 10_000, newId: () => "s_c" });
    let reads = 0;
    const orig = gw.readAll.bind(gw);
    gw.readAll = async (t: string) => {
      if (t === "surveys") reads++;
      return orig(t);
    };
    await cached.getBySlug("healing2026");
    await cached.getBySlug("healing2026");
    expect(reads).toBe(1);
    at("2026-11-09T12:00:11+09:00");
    await cached.getBySlug("healing2026");
    expect(reads).toBe(2);
    expect(await cached.getBySlug("BAD")).toBeNull();
  });

  it("최근 마감 순으로 정렬", async () => {
    await published(specOf(mdWithDeadline("2026-12-01", "a-early")));
    await published(specOf(mdWithDeadline("2026-12-20", "b-late")));
    expect((await store.listSurveys()).map((s) => s.spec.slug)).toEqual(["b-late", "a-early"]);
  });
});

describe("직원", () => {
  it("역할 조회: 대소문자 무시, 비활성·없는 사람·잘못된 역할은 null", async () => {
    await store.addStaff("Admin@Example.org", "admin");
    await store.addStaff("viewer@example.org", "viewer");
    await gw.append("staff", [["off@example.org", "admin", "FALSE"], ["weird@example.org", "owner", "TRUE"]]);
    expect(await store.getStaffRole("admin@example.ORG")).toBe("admin");
    expect(await store.getStaffRole("viewer@example.org")).toBe("viewer");
    expect(await store.getStaffRole("off@example.org")).toBeNull();
    expect(await store.getStaffRole("weird@example.org")).toBeNull();
    expect(await store.getStaffRole("nobody@example.org")).toBeNull();
    expect(await store.getStaffRole(" ")).toBeNull();
  });

  it("같은 사람을 다시 추가하면 역할만 바뀜, 이메일 형식 검사", async () => {
    await store.addStaff("a@example.org", "viewer");
    await store.addStaff("a@example.org", "admin");
    expect(gw.raw("staff")).toHaveLength(2);
    expect(await store.getStaffRole("a@example.org")).toBe("admin");
    expect((await store.addStaff("not-an-email", "admin")).ok).toBe(false);
  });
});

describe("대표 문항 집계 캐시", () => {
  it("응답 수·분포·평균을 기록하고 다시 계산하면 같은 행을 갱신", async () => {
    const rec = await published();
    await store.submitResponse("healing2026", ans({ Q4: 5 }));
    await store.submitResponse("healing2026", ans({ Q4: 3 }));
    const s1 = await store.refreshSummary(rec);
    expect(s1).toMatchObject({ n: 2, dist: [0, 0, 1, 0, 1], mean: 4, positiveRate: 50 });
    await store.submitResponse("healing2026", ans({ Q4: 4 }));
    await store.refreshSummary(rec);
    expect(gw.raw("summary")).toHaveLength(2);
    const read = (await store.readSummaries()).get(rec.id);
    expect(read).toMatchObject({ n: 3, dist: [0, 0, 1, 1, 1], mean: 4, positiveRate: 66.7, updatedAt: "2026-11-09 12:00:00" });
  });

  it("대표 문항이 없거나 응답이 없으면 분포 없음", async () => {
    const rec = await published();
    const s = await store.refreshSummary({ ...rec, spec: { ...rec.spec, kpiQuestionId: null } });
    expect(s).toMatchObject({ n: 0, dist: null, mean: null, positiveRate: null });
    expect((await store.readSummaries()).get(rec.id)?.dist).toBeNull();
  });
});

describe("도우미", () => {
  it("한국시간 표기, 응답 탭 머리글", () => {
    expect(formatKst(new Date("2026-12-31T15:30:05Z"))).toBe("2027-01-01 00:30:05");
    const h = responseHeader({ ...healing(), questions: [{ id: "Q1", type: "text", text: "=수식?" + "가".repeat(200), required: false }] });
    expect(h[1].startsWith("'Q1")).toBe(false);
    expect(h[1].length).toBe(120);
  });
});
