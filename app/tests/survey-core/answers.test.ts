import { describe, expect, it } from "vitest";
import { cleanText, normalizeAnswers, safeCell, unsafeCell, type RawAnswers } from "@/lib/survey-core";
import { sample, specOf } from "./helpers";

// 프로토타입 시험 2절(응답 검증) 이식 + 추가 사례

const spec = specOf(sample);
const good: RawAnswers = {
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
const b = (a: unknown) => normalizeAnswers(spec, a);
const row = (a: unknown) => {
  const r = b(a);
  if (!r.ok) throw new Error(r.error);
  return r.row;
};

describe("응답 검증 (프로토타입 사례)", () => {
  it("필수, 보기 외 값, 선택 개수, 직접입력, 척도 범위", () => {
    expect(b(good).ok).toBe(true);
    expect(row(good)).toHaveLength(12);
    expect(b({ ...good, Q1: undefined }).ok).toBe(false);
    expect(b({ ...good, Q1: "없는 보기" }).ok).toBe(false);
    expect(b({ ...good, Q2: ["쉼을 통한 회복", "여행을 좋아해서", "동료 네트워크 확대"] }).ok).toBe(false);
    expect(b({ ...good, Q2: "쉼을 통한 회복" }).ok).toBe(false);
    expect(b({ ...good, Q9: "기타" }).ok).toBe(false);
    expect(row({ ...good, Q9: "기타: 외부 지원금 | 사용" })[8]).toBe("기타: 외부 지원금 / 사용");
    expect(b({ ...good, Q4: 6 }).ok).toBe(false);
    expect(b({ ...good, Q4: 3.5 }).ok).toBe(false);
    expect(b({ ...good, Q4: "abc" }).ok).toBe(false);
    expect(row({ ...good, Q12: '=HYPERLINK("http://x")' })[11].startsWith("'=")).toBe(true);
    expect(b(null).ok).toBe(false);
    expect(row({ ...good, Q12: "ㄱ".repeat(5000) })[11]).toHaveLength(1000);
  });
});

describe("응답 검증 (추가)", () => {
  it("오류에 문항 id 를 함께 돌려줌", () => {
    const r = b({ ...good, Q4: 9 });
    expect(r).toEqual({ ok: false, error: "Q4: 1~5 사이 값이어야 함", questionId: "Q4" });
    expect(b({ ...good, Q1: undefined })).toMatchObject({ error: "Q1번 문항은 필수 응답임" });
  });

  it("배열·문자열이 아닌 형식은 거부", () => {
    expect(b([1, 2]).ok).toBe(false);
    expect(b("text").ok).toBe(false);
    expect(b({ ...good, Q1: ["참여자주도형(국내)"] })).toMatchObject({ error: "Q1: 하나만 선택할 수 있음" });
    expect(b({ ...good, Q4: [5] }).ok).toBe(false);
    expect(b({ ...good, Q12: { x: 1 } }).ok).toBe(false);
  });

  it("척도는 숫자 문자열도 받음, 복수 선택 중복은 한 번만", () => {
    const r = row({ ...good, Q4: "4", Q2: ["쉼을 통한 회복", "쉼을 통한 회복"] });
    expect(r[3]).toBe("4");
    expect(r[1]).toBe("쉼을 통한 회복");
  });

  it("직접입력 길이 제한(200자)·제어 문자 제거", () => {
    const r = row({ ...good, Q9: "기타: " + "가".repeat(300) });
    expect(r[8]).toBe("기타: " + "가".repeat(200));
    expect(row({ ...good, Q12: "좋\u0000았\u0007음 " })[11]).toBe("좋았음");
    expect(b({ ...good, Q9: "기타:    " }).ok).toBe(false);
  });

  it("선택 서술 문항이 공백뿐이면 빈 칸", () => {
    expect(row({ ...good, Q12: "   " })[11]).toBe("");
  });

  it("HTML 문자열은 그대로 텍스트로 저장(표시할 때 이스케이프)", () => {
    expect(row({ ...good, Q12: "<script>alert(1)</script>" })[11]).toBe("<script>alert(1)</script>");
  });

  it("__proto__ 같은 키로 문항 값을 꾸밀 수 없음", () => {
    const evil = JSON.parse('{"__proto__": {"Q1": "참여자주도형(국내)"}}');
    expect(b(evil).ok).toBe(false);
  });

  it("필수 서술 문항은 공백만 있으면 거부", () => {
    const s2 = { questions: [{ id: "Q1", type: "text" as const, text: "의견", required: true }] };
    expect(normalizeAnswers(s2, { Q1: "  " }).ok).toBe(false);
  });
});

describe("셀 도우미", () => {
  it("safeCell/unsafeCell 왕복", () => {
    for (const s of ["=1+1", "+82", "-3", "@x", "보통"]) expect(unsafeCell(safeCell(s))).toBe(s);
    expect(safeCell(null)).toBe("");
    expect(unsafeCell("'보통")).toBe("'보통");
    expect(cleanText(undefined, 10)).toBe("");
  });
});
