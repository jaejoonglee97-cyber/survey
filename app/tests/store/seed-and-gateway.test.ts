import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createBackend } from "@/lib/sheets/backend";
import { quoteTab } from "@/lib/sheets/gateway";
import { MemoryGateway } from "@/lib/sheets/memory-gateway";
import { isRetryable, withRetry } from "@/lib/sheets/retry";
import { defaultSeedSurveys, randomAnswers, resetData, seededRandom, seedDummy } from "@/lib/store/seed";
import { SurveyStore } from "@/lib/store/survey-store";
import { dashboardRows, normalizeAnswers } from "@/lib/survey-core";
import { sample, specOf, tpl } from "../survey-core/helpers";

const NOW = new Date("2026-11-09T12:00:00+09:00");
// 시스템 임시 폴더 대신 프로젝트 안의 .test-tmp 를 씀(.gitignore 대상)
const tmp = path.resolve(import.meta.dirname, "..", "..", ".test-tmp", "store-" + process.pid);
mkdirSync(tmp, { recursive: true });
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("더미 시드", () => {
  it("설문 5건(같은 사업 2025·2026 포함), 설문당 3~60건, 직원 2명", async () => {
    const gw = new MemoryGateway();
    const report = await seedDummy(gw, defaultSeedSurveys(sample, tpl), { now: NOW });
    expect(report.surveys).toEqual([
      { slug: "healing2025", status: "closed", responses: 32 },
      { slug: "healing2026", status: "open", responses: 18 },
      { slug: "ai-edu-2026", status: "closed", responses: 45 },
      { slug: "party2025", status: "closed", responses: 4 },
      { slug: "meeting2026", status: "draft", responses: 0 },
    ]);
    expect(report.staff).toBe(2);

    const store = new SurveyStore(gw, { now: () => NOW, cacheMs: 0 });
    const list = await store.listSurveys();
    const healing = list.filter((s) => s.spec.program === "힐링캠프").map((s) => s.spec.year).sort();
    expect(healing).toEqual([2025, 2026]);
    for (const s of list.filter((x) => x.status !== "draft")) {
      const n = await store.countResponses(s);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(60);
    }
    // 마감된 설문은 결과 메일 발송 기록이 있어 크론이 다시 보내지 않음
    expect(await store.listClosedUnnotified()).toEqual([]);
    expect(await store.getStaffRole("admin@example.org")).toBe("admin");
  });

  it("응답은 모두 검증 규칙을 통과하고 사람 이름·연락처처럼 보이는 값이 없음", async () => {
    const gw = new MemoryGateway();
    await seedDummy(gw, defaultSeedSurveys(sample, tpl), { now: NOW });
    const all = JSON.stringify(Object.fromEntries((await gw.listTabs()).map((t) => [t, gw.raw(t)])));
    expect(all).not.toMatch(/01[016789]-?\d{3,4}-?\d{4}/); // 휴대전화 형식
    expect(all).not.toMatch(/@(?!example\.org)[a-z0-9-]+\.[a-z]/i); // example.org 외 이메일
  });

  it("집계 캐시로 대시보드 행을 만들 수 있고 5건 미만은 숨김", async () => {
    const gw = new MemoryGateway();
    await seedDummy(gw, defaultSeedSurveys(sample, tpl), { now: NOW });
    const store = new SurveyStore(gw, { now: () => NOW, cacheMs: 0 });
    const sums = await store.readSummaries();
    const rows = dashboardRows(
      (await store.listSurveys())
        .filter((s) => s.status !== "draft")
        .map((s) => {
          const sm = sums.get(s.id)!;
          return { ...s.spec, state: s.state, n: sm.n, kpi: sm.dist ? { valid: sm.dist.reduce((a, b) => a + b, 0), dist: sm.dist } : null };
        }),
    );
    expect(rows.find((r) => r.slug === "party2025")).toMatchObject({ shown: false, dist: null, n: 4 });
    expect(rows.find((r) => r.slug === "healing2025")?.shown).toBe(true);
  });

  it("같은 seed 면 같은 데이터, 이미 데이터가 있으면 거부, reset 후 다시 가능", async () => {
    const a = new MemoryGateway();
    const b = new MemoryGateway();
    await seedDummy(a, defaultSeedSurveys(sample, tpl), { now: NOW });
    await seedDummy(b, defaultSeedSurveys(sample, tpl), { now: NOW });
    expect(a.raw("r_healing2026")).toEqual(b.raw("r_healing2026"));
    await expect(seedDummy(a, defaultSeedSurveys(sample, tpl), { now: NOW })).rejects.toThrow(/이미 데이터가 있음/);
    await resetData(a);
    expect((await a.listTabs()).sort()).toEqual(["staff", "summary", "surveys"]);
    expect(a.raw("surveys")).toHaveLength(1);
    await seedDummy(a, defaultSeedSurveys(sample, tpl), { now: NOW, staff: [{ email: "me@example.org", role: "admin" }] });
    expect(a.raw("staff")).toHaveLength(2);
  });

  it("임의 응답 생성기는 언제나 유효한 응답을 만듦", () => {
    const spec = specOf(sample);
    const rand = seededRandom(7);
    for (let i = 0; i < 300; i++) {
      const r = normalizeAnswers(spec, randomAnswers(spec.questions, rand, [1, 1, 1, 1, 1]));
      expect(r.ok).toBe(true);
    }
  });
});

describe("메모리 게이트웨이(로컬 개발용)", () => {
  it("파일에 저장해 다시 열어도 유지되고, 행 끝 빈 칸을 잘라 돌려줌", async () => {
    const file = path.join(tmp, "a", "sheets.json");
    const g1 = new MemoryGateway(file);
    await g1.addTab("t", ["a", "b"]);
    await g1.append("t", [["1", ""], ["2", "3"]]);
    const g2 = new MemoryGateway(file);
    expect(await g2.readAll("t")).toEqual([["a", "b"], ["1"], ["2", "3"]]);
    await g2.deleteRow("t", 2);
    await g2.clearBelowHeader("t");
    expect(await g2.readAll("t")).toEqual([["a", "b"]]);
    await expect(g2.addTab("t", [])).rejects.toThrow();
    await expect(g2.updateRow("t", 9, [])).rejects.toThrow();
    await expect(g2.deleteRow("t", 9)).rejects.toThrow();
    await expect(g2.readAll("none")).rejects.toThrow();
    await g2.deleteTab("t");
    expect(await new MemoryGateway(file).listTabs()).toEqual([]);
  });
});

describe("같은 파일을 쓰는 게이트웨이 두 개(개발 서버의 화면·서버 동작)", () => {
  it("서로의 변경을 보고, 오래된 내용으로 덮어쓰지 않음", async () => {
    const file = path.join(tmp, "b", "sheets.json");
    const a = new MemoryGateway(file);
    const b = new MemoryGateway(file);
    await a.addTab("t", ["h"]);
    await b.append("t", [["1"]]);
    await a.append("t", [["2"]]);
    expect(await b.readAll("t")).toEqual([["h"], ["1"], ["2"]]);
    await b.updateRow("t", 2, ["1-수정"]);
    expect((await a.readAll("t"))[1]).toEqual(["1-수정"]);
  });
});

describe("저장 방식 선택", () => {
  it("local 은 .local-data 파일, 배포 환경(VERCEL)에서는 거부", () => {
    const b = createBackend({ DATA_BACKEND: "local" }, tmp);
    expect(b.kind).toBe("local");
    expect(b.kind === "local" && b.filePath).toBe(path.join(tmp, ".local-data", "sheets.json"));
    expect(() => createBackend({ DATA_BACKEND: "local", VERCEL: "1" })).toThrow(/로컬 개발 전용/);
    expect(() => createBackend({ DATA_BACKEND: "mysql" })).toThrow(/DATA_BACKEND/);
  });

  it("google 은 설정이 없으면 이름만 알려 주는 오류", () => {
    expect(() => createBackend({})).toThrow(/시트 연결 설정 오류/);
    const b = createBackend({
      GOOGLE_SHEETS_ID: "1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789",
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "bot@p.iam.gserviceaccount.com",
      GOOGLE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nFAKE\\n-----END PRIVATE KEY-----\\n",
    });
    expect([b.kind, b.env]).toEqual(["google", "dummy"]);
  });

  it("Preview 배포에서는 운영 시트 연결을 거부", () => {
    const g = {
      GOOGLE_SHEETS_ID: "1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789",
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "bot@p.iam.gserviceaccount.com",
      GOOGLE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n",
      SHEETS_ENV: "production",
    };
    expect(() => createBackend({ ...g, VERCEL_ENV: "preview" })).toThrow(/Production 배포에서만/);
    expect(createBackend({ ...g, VERCEL_ENV: "production" }).env).toBe("production");
    expect(createBackend({ ...g, SHEETS_ENV: "dummy", VERCEL_ENV: "preview" }).env).toBe("dummy");
  });
});

describe("재시도", () => {
  it("429·5xx 는 다시 시도하고, 그 밖의 오류는 바로 실패", async () => {
    const sleep = vi.fn(async () => {});
    let n = 0;
    const r = await withRetry(
      async () => {
        if (++n < 3) throw { code: 429 };
        return "ok";
      },
      { sleep, random: () => 1 },
    );
    expect([r, n]).toEqual(["ok", 3]);
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([500, 1000]);

    let m = 0;
    await expect(
      withRetry(
        async () => {
          m++;
          throw { code: 403 };
        },
        { sleep },
      ),
    ).rejects.toEqual({ code: 403 });
    expect(m).toBe(1);

    let k = 0;
    await expect(
      withRetry(
        async () => {
          k++;
          throw { response: { status: 503 } };
        },
        { sleep, attempts: 3 },
      ),
    ).rejects.toBeTruthy();
    expect(k).toBe(3);
  });

  it("오류 판별", () => {
    expect(isRetryable({ code: 429 })).toBe(true);
    expect(isRetryable({ status: 500 })).toBe(true);
    expect(isRetryable({ code: 404 })).toBe(false);
    expect(isRetryable(new Error("x"))).toBe(false);
    expect(quoteTab("r_it's")).toBe("'r_it''s'");
  });
});
