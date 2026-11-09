import { beforeEach, describe, expect, it } from "vitest";
import {
  answeredCount,
  collectAnswers,
  initialFormState,
  isOptionDisabled,
  problemMessage,
  toggleOption,
  type FormState,
} from "@/lib/respond/form-state";
import { handleSubmit, MAX_BODY_BYTES } from "@/lib/respond/submit-handler";
import { MemoryGateway } from "@/lib/sheets/memory-gateway";
import { SurveyStore } from "@/lib/store/survey-store";
import { normalizeAnswers } from "@/lib/survey-core";
import { mdWithDeadline, specOf } from "../survey-core/helpers";

const spec = specOf(mdWithDeadline("2026-11-20 18:00"));
const Q = (id: string) => spec.questions.find((q) => q.id === id)!;

describe("응답 폼 규칙", () => {
  it("복수 선택은 최대 개수를 넘기지 않고, 넘칠 보기는 비활성", () => {
    const q2 = Q("Q2"); // 최대 2개
    let s = initialFormState(spec.questions).Q2;
    s = toggleOption(q2, s, 0);
    s = toggleOption(q2, s, 2);
    expect(isOptionDisabled(q2, s, 1)).toBe(true);
    expect(isOptionDisabled(q2, s, 0)).toBe(false);
    expect(toggleOption(q2, s, 1)).toBe(s);
    s = toggleOption(q2, s, 0);
    expect(s.selected).toEqual([2]);
    expect(isOptionDisabled(q2, s, 1)).toBe(false);
    expect(isOptionDisabled(Q("Q1"), s, 1)).toBe(false);
  });

  it("단일 선택은 하나로 바뀜", () => {
    let s = initialFormState(spec.questions).Q1;
    s = toggleOption(Q("Q1"), s, 0);
    s = toggleOption(Q("Q1"), s, 2);
    expect(s.selected).toEqual([2]);
  });

  function filled(): FormState {
    const st = initialFormState(spec.questions);
    for (const q of spec.questions) {
      if (q.type === "scale5") st[q.id] = { ...st[q.id], scale: 4 };
      if (q.type === "single" || q.type === "multi") st[q.id] = { ...st[q.id], selected: [0] };
    }
    return st;
  }

  it("모든 필수 문항을 채우면 서버 검증도 통과하는 응답이 됨", () => {
    const st = filled();
    const { answers, problems } = collectAnswers(spec.questions, st);
    expect(problems).toEqual([]);
    expect(normalizeAnswers(spec, answers).ok).toBe(true);
    expect(answers.Q2).toEqual(["쉼을 통한 회복"]);
    expect(answers.Q12).toBeUndefined();
    expect(answeredCount(spec.questions, st)).toBe(11);
  });

  it("필수 누락·직접입력 내용 없음을 찾아 첫 문제부터 알려 줌", () => {
    const st = filled();
    st.Q1 = { ...st.Q1, selected: [] };
    st.Q9 = { ...st.Q9, selected: [3] }; // 기타(직접입력)
    const { problems } = collectAnswers(spec.questions, st);
    expect(problems).toEqual([
      { questionId: "Q1", kind: "required" },
      { questionId: "Q9", kind: "other" },
    ]);
    expect(problemMessage(problems)).toBe("필수 문항에 응답해 주십시오.");
    expect(problemMessage(problems.slice(1))).toContain("직접 입력");
    expect(problemMessage([])).toBe("");
    st.Q9 = { ...st.Q9, other: { 3: "  기관 자체 지원 " } };
    expect(collectAnswers(spec.questions, st).answers.Q9).toBe("기타: 기관 자체 지원");
  });

  it("서술은 공백만 있으면 응답하지 않은 것으로 봄", () => {
    const st = filled();
    st.Q12 = { ...st.Q12, text: "   " };
    expect(collectAnswers(spec.questions, st).answers.Q12).toBeUndefined();
    st.Q12 = { ...st.Q12, text: " 좋았음 " };
    expect(collectAnswers(spec.questions, st).answers.Q12).toBe("좋았음");
  });
});

// ───────── 제출 API ─────────

let gw: MemoryGateway;
let clock: Date;
let store: SurveyStore;

beforeEach(async () => {
  gw = new MemoryGateway();
  clock = new Date("2026-11-09T12:00:00+09:00");
  store = new SurveyStore(gw, { now: () => clock, cacheMs: 0 });
  await store.ensureTabs();
  const c = await store.createDraft(spec, "admin@example.org");
  if (!c.ok) throw new Error(c.error);
  const p = await store.publish(c.value.id);
  if (!p.ok) throw new Error(p.error);
});

const good = {
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
};
const post = (body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
  new Request("http://localhost/api/s/healing2026/submit", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const send = async (slug: string, req: Request) => {
  const res = await handleSubmit(store, slug, req);
  return { status: res.status, body: await res.json(), cache: res.headers.get("cache-control") };
};

describe("제출 API", () => {
  it("정상 제출은 200, 시트에 한 행 추가, 캐시 금지", async () => {
    const r = await send("healing2026", post({ answers: good }));
    expect(r).toEqual({ status: 200, body: { ok: true }, cache: "no-store" });
    expect(gw.raw("r_healing2026")).toHaveLength(2);
  });

  it("마감 후 제출은 409 closed", async () => {
    clock = new Date("2026-11-20T18:01:00+09:00");
    const r = await send("healing2026", post({ answers: good }));
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ ok: false, closed: true });
    expect(gw.raw("r_healing2026")).toHaveLength(1);
  });

  it("필수 누락·보기 외 값은 422, 문항 번호로 안내(내부 오류 문구는 보내지 않음)", async () => {
    const missing = await send("healing2026", post({ answers: { ...good, Q1: undefined } }));
    expect(missing).toMatchObject({ status: 422, body: { ok: false, message: "1번 문항의 응답을 확인해 주십시오.", questionId: "Q1" } });
    const wrong = await send("healing2026", post({ answers: { ...good, Q10: "<b>없는 보기</b>" } }));
    expect(wrong.status).toBe(422);
    expect(wrong.body.message).toBe("10번 문항의 응답을 확인해 주십시오.");
    expect(gw.raw("r_healing2026")).toHaveLength(1);
  });

  it("없는 설문·이상한 slug 는 404", async () => {
    expect((await send("nope-slug", post({ answers: good }))).status).toBe(404);
    expect((await send("../surveys", post({ answers: good }))).status).toBe(404);
  });

  it("JSON 이 아닌 요청(다른 사이트의 폼 전송 등)은 415", async () => {
    const r = await send("healing2026", post("answers=1", { "content-type": "application/x-www-form-urlencoded" }));
    expect(r.status).toBe(415);
    expect((await send("healing2026", post("x", { "content-type": "text/plain" }))).status).toBe(415);
  });

  it("깨진 JSON·answers 없음·배열은 400", async () => {
    expect((await send("healing2026", post("{깨짐"))).status).toBe(400);
    expect((await send("healing2026", post({ nope: 1 }))).status).toBe(400);
    expect((await send("healing2026", post({ answers: [1] }))).status).toBe(400);
    expect((await send("healing2026", post("null"))).status).toBe(400);
  });

  it("20KB 를 넘는 본문은 413(선언 길이·실제 길이 모두)", async () => {
    const big = { answers: { ...good, Q12: "가".repeat(MAX_BODY_BYTES) } };
    expect((await send("healing2026", post(big))).status).toBe(413);
    const lying = post(big, { "content-type": "application/json", "content-length": "100" });
    expect((await send("healing2026", lying)).status).toBe(413);
    expect(gw.raw("r_healing2026")).toHaveLength(1);
  });

  it("HTML 주입 문자열은 그대로 텍스트로 저장(화면에서 텍스트로만 표시)", async () => {
    const r = await send("healing2026", post({ answers: { ...good, Q12: "<img src=x onerror=alert(1)>" } }));
    expect(r.status).toBe(200);
    expect(gw.raw("r_healing2026")[1][12]).toBe("<img src=x onerror=alert(1)>");
  });

  it("저장소 오류는 503 과 일반 안내만(내부 내용 노출 없음)", async () => {
    gw.append = async () => {
      throw new Error("Sheets API: spreadsheet 1AbC... quota");
    };
    const r = await send("healing2026", post({ answers: good }));
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.body)).not.toMatch(/Sheets|quota|1AbC/);
  });

  it("설문당 응답 수 상한을 넘으면 409, 시트에 추가되지 않음", async () => {
    const capped = new SurveyStore(gw, { now: () => clock, cacheMs: 0, maxResponses: 2 });
    for (let i = 0; i < 2; i++) expect((await handleSubmit(capped, "healing2026", post({ answers: good }))).status).toBe(200);
    const r = await handleSubmit(capped, "healing2026", post({ answers: good }));
    expect(r.status).toBe(409);
    expect((await r.json()).message).toContain("응답 수를 모두 채워");
    expect(gw.raw("r_healing2026")).toHaveLength(3);
  });

  it("요청이 몰리면 429(시트에 쓰지 않음), 다른 설문은 영향 없음", async () => {
    const { SlidingWindowLimiter } = await import("@/lib/respond/rate-limit");
    let t = 0;
    const limiters = { perSurvey: new SlidingWindowLimiter(2, 60_000, () => t), global: new SlidingWindowLimiter(100, 60_000, () => t) };
    expect((await handleSubmit(store, "healing2026", post({ answers: good }), limiters)).status).toBe(200);
    expect((await handleSubmit(store, "healing2026", post({ answers: good }), limiters)).status).toBe(200);
    const r = await handleSubmit(store, "healing2026", post({ answers: good }), limiters);
    expect(r.status).toBe(429);
    expect((await r.json()).message).toContain("잠시 후 다시 제출");
    expect(gw.raw("r_healing2026")).toHaveLength(3);
    expect((await handleSubmit(store, "other-slug", post({ answers: good }), limiters)).status).toBe(404); // 다른 설문은 제한에 안 걸림
    t = 61_000; // 1분 뒤에는 다시 허용
    expect((await handleSubmit(store, "healing2026", post({ answers: good }), limiters)).status).toBe(200);
  });

  it("대상 인원이 있으면 응답 상한은 그 3배(최소 50)", async () => {
    const { responseCap } = await import("@/lib/store/survey-store");
    expect([responseCap(40, 5000), responseCap(10, 5000), responseCap(undefined, 5000), responseCap(4000, 5000)]).toEqual([120, 50, 5000, 5000]);
  });

  it("본문 없는 요청은 400", async () => {
    const req = new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" } });
    expect((await send("healing2026", req)).status).toBe(400);
  });
});
