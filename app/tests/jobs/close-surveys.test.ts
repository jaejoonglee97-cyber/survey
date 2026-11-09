import { beforeEach, describe, expect, it, vi } from "vitest";
import { qrDataUrl, responseUrl } from "@/lib/admin/qr";
import { buildResultMail, isCronAuthorized, runCloseJob } from "@/lib/jobs/close-surveys";
import { createMailer, LogMailer, recipients, ResendMailer } from "@/lib/mail/mailer";
import { MemoryGateway } from "@/lib/sheets/memory-gateway";
import { SurveyStore } from "@/lib/store/survey-store";
import type { RawAnswers } from "@/lib/survey-core";
import { mdWithDeadline, specOf } from "../survey-core/helpers";

const SECRET = "0123456789abcdef0123";

describe("크론 인증", () => {
  it("Bearer 비밀값이 정확히 맞을 때만 허용", () => {
    expect(isCronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isCronAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isCronAuthorized(SECRET, SECRET)).toBe(false);
    expect(isCronAuthorized(null, SECRET)).toBe(false);
    expect(isCronAuthorized("Bearer ", "")).toBe(false);
    expect(isCronAuthorized(undefined as unknown as null, undefined)).toBe(false);
    // 짧은 비밀값은 설정되어 있어도 거부(추측 방지)
    expect(isCronAuthorized("Bearer short", "short")).toBe(false);
  });
});

describe("메일", () => {
  it("받는 사람: 설정 + 만든 담당자, 중복·형식 오류 제거", () => {
    expect(recipients("a@x.org, B@x.org ,bad, ", "b@x.org")).toEqual(["a@x.org", "b@x.org"]);
    expect(recipients(undefined, "")).toEqual([]);
    expect(recipients("evil@x.org>, <x", "seed@example.org")).toEqual(["seed@example.org"]);
  });

  it("발송 방식 선택", () => {
    expect(createMailer({}).kind).toBe("log");
    expect(createMailer({ MAIL_PROVIDER: "resend", RESEND_API_KEY: "re_x", MAIL_FROM: "a <a@x.org>" }).kind).toBe("resend");
    expect(() => createMailer({ MAIL_PROVIDER: "resend" })).toThrow(/RESEND_API_KEY/);
    expect(() => createMailer({ MAIL_PROVIDER: "smtp" })).toThrow(/MAIL_PROVIDER/);
  });

  it("Resend: 텍스트 본문으로 보내고, 실패 시 상태 코드만 알림(키 노출 없음)", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200 });
    });
    const m = new ResendMailer("re_secret", "설문 <s@x.org>", ok as unknown as typeof fetch);
    await m.send({ to: ["a@x.org"], subject: "제목", text: "본문" });
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ from: "설문 <s@x.org>", to: ["a@x.org"], subject: "제목", text: "본문" });
    const bad = new ResendMailer("re_secret", "s@x.org", (async () => new Response("no", { status: 403 })) as unknown as typeof fetch);
    await expect(bad.send({ to: ["a@x.org"], subject: "s", text: "t" })).rejects.toThrow("메일 발송 실패(HTTP 403)");
    await bad.send({ to: ["a@x.org"], subject: "s", text: "t" }).catch((e: Error) => expect(e.message).not.toContain("re_secret"));
  });
});

// ───────── 마감 처리 (프로토타입 사례 이식) ─────────

let gw: MemoryGateway;
let clock: Date;
let store: SurveyStore;
let mailer: LogMailer;
const at = (iso: string) => (clock = new Date(iso));
const ans = (over: RawAnswers = {}): RawAnswers => ({
  Q1: "참여자주도형(국내)",
  Q2: ["쉼을 통한 회복"],
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
const job = () => runCloseJob(store, mailer, { adminNotify: "admin@example.org", siteUrl: "https://survey.example.org" });

beforeEach(async () => {
  gw = new MemoryGateway();
  at("2026-11-09T12:00:00+09:00");
  store = new SurveyStore(gw, { now: () => clock, cacheMs: 0 });
  mailer = new LogMailer(true);
  await store.ensureTabs();
  await store.addStaff("admin@example.org", "admin");
  await store.addStaff("creator@example.org", "admin");
});

async function published(deadline: string, slug = "healing2026") {
  const c = await store.createDraft(specOf(mdWithDeadline(deadline, slug)), "creator@example.org");
  if (!c.ok) throw new Error(c.error);
  const p = await store.publish(c.value.id);
  if (!p.ok) throw new Error(p.error);
  return p.value.record;
}

describe("마감 처리 작업", () => {
  it("마감 시각 경계: 23:59:30 응답 가능·메일 없음, 00:00:30 응답 거부·메일 1회", async () => {
    const rec = await published("2026-11-20 23:59");
    await store.submitResponse("healing2026", ans());
    at("2026-11-20T23:59:30+09:00");
    expect((await store.submitResponse("healing2026", ans({ Q12: "=1+1", Q4: 4 }))).code).toBe("ok");
    expect(await job()).toEqual({ checked: 0, sent: 0, failed: 0, noRecipient: 0 });

    at("2026-11-21T00:00:30+09:00");
    expect((await store.submitResponse("healing2026", ans())).code).toBe("closed");
    expect(await job()).toEqual({ checked: 1, sent: 1, failed: 0, noRecipient: 0 });
    const m = mailer.outbox[0];
    expect(m.to).toEqual(["admin@example.org", "creator@example.org"]);
    expect(m.subject).toContain("2026 서울사회복지사 힐링캠프");
    expect(m.text).toContain("대상 40명 중 2명이 응답하여 응답률 5%임.");
    expect(m.text).toContain(`https://survey.example.org/survey/${rec.id}/results`);
    expect(m.text).not.toContain("좋았음"); // 서술 원문 없음
    expect(m.text).not.toContain("=1+1");
    expect((await store.getById(rec.id))?.closedNotifiedAt).toBe("2026-11-21 00:00:30");
  });

  it("중복 발송 없음, 연장 후 다시 마감되면 다시 발송", async () => {
    const rec = await published("2026-11-20 23:59");
    at("2026-11-21T01:00:00+09:00");
    await job();
    await job();
    expect(mailer.outbox).toHaveLength(1);
    await store.setDeadline(rec.id, "2026-11-30 12:00");
    expect((await store.submitResponse("healing2026", ans())).code).toBe("ok");
    await job();
    expect(mailer.outbox).toHaveLength(1); // 아직 진행 중
    at("2026-12-01T09:00:00+09:00");
    await job();
    expect(mailer.outbox).toHaveLength(2);
    expect(mailer.outbox[1].text).toContain("대상 40명 중 1명이 응답");
  });

  it("담당자가 직접 마감한 설문도 다음 실행에서 한 번 발송", async () => {
    const rec = await published("2026-12-20 23:59");
    await store.setStatus(rec.id, "closed");
    expect((await job()).sent).toBe(1);
    expect((await job()).checked).toBe(0);
  });

  it("발송 실패는 기록하지 않아 다음 실행에서 다시 시도, 다른 설문은 계속 처리", async () => {
    await published("2026-11-20 23:59", "a-survey");
    await published("2026-11-21 23:59", "b-survey");
    at("2026-11-25T09:00:00+09:00");
    let fail = true;
    const flaky = {
      kind: "flaky",
      async send(msg: { subject: string }) {
        if (fail && msg.subject.includes("힐링캠프") && mailer.outbox.length === 0) {
          fail = false;
          throw new Error("down");
        }
        mailer.outbox.push(msg as never);
      },
    };
    const r1 = await runCloseJob(store, flaky, { adminNotify: "admin@example.org" });
    expect(r1).toMatchObject({ checked: 2, sent: 1, failed: 1 });
    const r2 = await runCloseJob(store, flaky, { adminNotify: "admin@example.org" });
    expect(r2).toMatchObject({ checked: 1, sent: 1, failed: 0 });
    expect(await store.listClosedUnnotified()).toEqual([]);
  });

  it("지금 활성 담당자에게만 보냄: 권한이 회수된 작성자·열람자·직원 목록에 없는 주소 제외", async () => {
    await published("2026-11-20 23:59");
    await gw.updateRow("staff", 3, ["creator@example.org", "admin", "FALSE", ""]); // 작성자 권한 회수
    await store.addStaff("viewer@example.org", "viewer");
    at("2026-11-21T01:00:00+09:00");
    await runCloseJob(store, mailer, { adminNotify: "admin@example.org, viewer@example.org, outsider@example.org" });
    expect(mailer.outbox[0].to).toEqual(["admin@example.org"]);
  });

  it("받는 사람이 없으면 메일 없이 기록만(계속 재시도하지 않음)", async () => {
    const c = await store.createDraft(specOf(mdWithDeadline("2026-11-20 23:59")), "");
    if (!c.ok) throw new Error();
    await store.publish(c.value.id);
    at("2026-11-21T01:00:00+09:00");
    expect(await runCloseJob(store, mailer, {})).toMatchObject({ checked: 1, sent: 0, noRecipient: 1 });
    expect(await store.listClosedUnnotified()).toEqual([]);
  });

  it("마감 처리 때 대표 문항 집계 캐시를 확정함", async () => {
    const rec = await published("2026-11-20 23:59");
    await store.submitResponse("healing2026", ans({ Q4: 4 }));
    at("2026-11-21T01:00:00+09:00");
    await job();
    expect((await store.readSummaries()).get(rec.id)).toMatchObject({ n: 1, dist: [0, 0, 0, 1, 0], updatedAt: "2026-11-21 01:00:00" });
  });

  it("결과 메일 본문은 사이트 주소가 없어도 만들어짐", async () => {
    const rec = await published("2026-11-20 23:59");
    const m = buildResultMail(rec, ["1. 응답 현황"], ["a@x.org"], "");
    expect(m.text).toContain(`/survey/${rec.id}/results`);
  });
});

describe("QR", () => {
  it("응답 링크 QR 은 PNG data URL", async () => {
    const u = responseUrl("https://survey.example.org/", "healing2026");
    expect(u).toBe("https://survey.example.org/s/healing2026");
    const q = await qrDataUrl(u);
    expect(q.startsWith("data:image/png;base64,")).toBe(true);
    expect(q.length).toBeGreaterThan(500);
  });
});
