import { describe, expect, it } from "vitest";
import { looksLikeDummyTitle, normalizePrivateKey, readSheetsConfig } from "@/lib/sheets/config";
import { planFixedTabs, FIXED_TABS } from "@/lib/sheets/schema";

// 실제 키가 아닌 짧은 가짜 값
const FAKE_KEY = "-----BEGIN PRIVATE KEY-----\\nFAKE\\n-----END PRIVATE KEY-----\\n";
const base = {
  GOOGLE_SHEETS_ID: "1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789",
  GOOGLE_SERVICE_ACCOUNT_EMAIL: "survey-bot@sasw-survey.iam.gserviceaccount.com",
  GOOGLE_PRIVATE_KEY: FAKE_KEY,
};

describe("readSheetsConfig", () => {
  it("올바른 값을 읽고 키의 \\n 을 줄바꿈으로 바꿈", () => {
    const c = readSheetsConfig(base);
    expect(c.privateKey.split("\n")[1]).toBe("FAKE");
    expect(c.env).toBe("dummy");
  });

  it("SHEETS_ENV 기본값은 dummy, production 만 허용", () => {
    expect(readSheetsConfig({ ...base, SHEETS_ENV: "production" }).env).toBe("production");
    expect(() => readSheetsConfig({ ...base, SHEETS_ENV: "prod" })).toThrow();
  });

  it("빠진 값이 있으면 이름만 알려 주고 값은 노출하지 않음", () => {
    try {
      readSheetsConfig({ ...base, GOOGLE_SERVICE_ACCOUNT_EMAIL: "someone@gmail.com" });
      expect.unreachable();
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("GOOGLE_SERVICE_ACCOUNT_EMAIL");
      expect(msg).not.toContain("someone@gmail.com");
    }
  });

  it("키 형식이 아니면 거부", () => {
    expect(() => readSheetsConfig({ ...base, GOOGLE_PRIVATE_KEY: "abc" })).toThrow(/형식이 아님/);
  });
});

describe("normalizePrivateKey", () => {
  it("바깥 따옴표와 CRLF 를 정리", () => {
    expect(normalizePrivateKey(`"a\\nb"`)).toBe("a\nb");
    expect(normalizePrivateKey("a\r\nb")).toBe("a\nb");
  });
});

describe("looksLikeDummyTitle", () => {
  it("더미 표시를 알아봄", () => {
    expect(looksLikeDummyTitle("[더미] 만족도 설문 DB")).toBe(true);
    expect(looksLikeDummyTitle("Survey DB (dummy)")).toBe(true);
    expect(looksLikeDummyTitle("만족도 설문 DB")).toBe(false);
  });
});

describe("planFixedTabs", () => {
  it("빈 시트면 고정 탭 3개를 모두 만듦", () => {
    expect(planFixedTabs([]).map((p) => p.action)).toEqual(["create", "create", "create"]);
  });

  it("머리글이 같으면 그대로, 비어 있으면 씀, 다르면 손대지 않고 보고", () => {
    const plan = planFixedTabs([
      { title: "surveys", header: [...FIXED_TABS.surveys, "", ""] },
      { title: "staff", header: [] },
      { title: "summary", header: ["survey_id", "count"] },
    ]);
    expect(plan.map((p) => p.action)).toEqual(["ok", "write_header", "mismatch"]);
  });
});
