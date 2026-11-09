import { describe, expect, it } from "vitest";
import { exportMd, importMd, nextQuestionId, SurveySpecSchema, toPublicSurvey } from "@/lib/survey-core";
import { evMd, parse, sample, tpl } from "./helpers";

// 프로토타입 시험 1절(md 해석·검증)과 3b절(분류·대표지표) 이식

describe("md 해석 (프로토타입 사례)", () => {
  it("샘플 md가 오류 없이 해석됨(12문항, 필수/유형/기타 처리)", () => {
    const r = parse(sample);
    expect(r.errors).toEqual([]);
    expect(r.spec.questions).toHaveLength(12);
    expect(r.spec.slug).toBe("healing2026");
    expect(r.spec.deadline).toBe("2026-12-10 23:59");
    expect(r.spec.target).toBe(40);
    const q2 = r.spec.questions[1];
    expect([q2.type, q2.max, q2.required]).toEqual(["multi", 2, true]);
    expect(q2.options?.[5]).toEqual({ label: "기타", other: true });
    expect(r.spec.questions[3].low).toBe("매우 불만족");
    expect(r.spec.questions[11].type).toBe("text");
    expect(r.spec.questions[11].required).toBe(false);
    expect(r.spec.intro).toContain("무기명");
    expect(r.spec.questions[0].section).toBe("참여 정보");
  });

  it("머리말 누락·형식 오류를 잡아냄", () => {
    expect(parse("## [단일*] 질문\n- a\n- b").ok).toBe(false);
    const bad = (m: string) => parse(sample.replace(/deadline: .*/, "deadline: " + m));
    expect(bad("2026-02-31").ok).toBe(false);
    expect(bad("내일").ok).toBe(false);
    expect(bad("2026-12-10 25:00").ok).toBe(false);
    expect(bad("2026-12-10").ok).toBe(true);
    expect(bad("2026-12-10").spec.deadline).toBe("2026-12-10 23:59");
    expect(parse(sample.replace(/slug: .*/, "slug: 한글")).ok).toBe(false);
    expect(parse(sample.replace(/target: .*/, "target: 많이")).ok).toBe(false);
  });

  it("문항 오류(보기 부족·중복·금지문자·잘못된 유형)를 잡아냄", () => {
    const head = "---\ntitle: t\nslug: abc\ndeadline: 2026-12-31\n---\n";
    expect(parse(head + "## [단일*] 질문\n- 하나").ok).toBe(false);
    expect(parse(head + "## [단일*] 질문\n- 가\n- 가").ok).toBe(false);
    expect(parse(head + "## [단일*] 질문\n- 가|나\n- 다").ok).toBe(false);
    expect(parse(head + "## [단일*] 질문\n- =SUM\n- 다").ok).toBe(false);
    expect(parse(head + "## [객관식*] 질문\n- 가\n- 나").ok).toBe(false);
    expect(parse(head).ok).toBe(false);
    const w = parse(head + "## [5점] 질문\n- 무시될 보기\n알 수 없는 줄");
    expect(w.ok).toBe(true);
    expect(w.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it("분류·사업명·연도·대표지표 해석과 검증", () => {
    const r = parse(sample);
    expect(r.spec.category).toBe("사업");
    expect(r.spec.program).toBe("힐링캠프");
    expect(r.spec.kpiQuestionId).toBe("Q4");
    const d = parse(evMd("abc", "송년회", "2025", "행사", "2026-12-31"));
    expect(d.ok).toBe(true);
    expect(d.spec.year).toBe(2025);
    const noKpi = parse(evMd("abc", "x", "", "행사", "2026-12-31").replace("지표: 대표만족\n", ""));
    expect(noKpi.ok).toBe(true);
    expect(noKpi.warnings.some((w) => w.includes("대표 지표"))).toBe(true);
    expect(noKpi.spec.kpiQuestionId).toBeNull();
    const onSingle = parse(evMd("abc", "x", "", "행사", "2026-12-31").replace("- 적극 추천", "지표: 대표만족\n- 적극 추천"));
    expect(onSingle.ok).toBe(false);
    const two = parse(
      evMd("abc", "x", "", "행사", "2026-12-31").replace(
        "## [5점*] 내용(주제·구성)에 만족하십니까?",
        "## [5점*] 내용(주제·구성)에 만족하십니까?\n지표: 대표만족",
      ),
    );
    expect(two.ok).toBe(false);
    expect(two.errors.some((e) => e.includes("1개만"))).toBe(true);
    expect(parse(evMd("abc", "x", "25", "행사", "2026-12-31")).ok).toBe(false);
    expect(parse(evMd("abc", "x", "", "가".repeat(21), "2026-12-31")).ok).toBe(false);
    expect(parse(tpl.replace(/category: .*\n/, "")).spec.category).toBe("기타");
  });
});

describe("md 해석 (추가)", () => {
  it("연도를 적지 않으면 마감일의 연도를 씀", () => {
    expect(parse(sample).spec.year).toBe(2026);
  });

  it("템플릿 샘플도 오류 없이 해석됨", () => {
    const r = parse(evMd("event-test", "행사", "", "행사", "2026-12-31"));
    expect(r.errors).toEqual([]);
    expect(r.spec.questions).toHaveLength(7);
    expect(r.spec.kpiQuestionId).toBe("Q1");
  });

  it("CRLF·BOM 이 섞여도 같은 결과", () => {
    const crlf = "﻿" + sample.replace(/\n/g, "\r\n");
    expect(importMd(crlf).spec).toEqual(importMd(sample).spec);
  });

  it("머리말을 닫지 않으면 오류, 경고 대상 줄들을 알려 줌", () => {
    expect(parse("---\ntitle: t\n").errors).toContain("머리말을 닫는 --- 줄이 없음");
    const r = parse(
      "---\ntitle: t\nslug: abc\ndeadline: 2026-12-31\n이상한 줄\n---\n- 문항 밖 보기\n## [단일:3] 질문\n- 가\n- 나\n> 뒤 안내\n지표: 기타지표\n## [복수:5] 질문2\n- 가\n- 나\n## [단일] 질문3\n- (직접입력)\n- 다",
    );
    expect(r.warnings.join("\n")).toMatch(/머리말에서 인식되지 않은 줄/);
    expect(r.warnings.join("\n")).toMatch(/문항 밖의 보기/);
    expect(r.warnings.join("\n")).toMatch(/\[복수\]에서만/);
    expect(r.warnings.join("\n")).toMatch(/안내문\(>\)은 무시됨/);
    expect(r.warnings.join("\n")).toMatch(/알 수 없는 지표 값/);
    expect(r.warnings.join("\n")).toMatch(/보기 수보다 큼/);
    expect(r.errors.join("\n")).toMatch(/빈 보기/);
  });

  it("길이·개수 제한", () => {
    const head = (extra = "") => `---\ntitle: t\nslug: abc\ndeadline: 2026-12-31\n${extra}---\n`;
    expect(parse(head() + "## [서술] " + "가".repeat(201)).errors.join()).toMatch(/200자/);
    expect(parse(head() + "## [서술] 질문\n").ok).toBe(true);
    expect(parse(head().replace("title: t", "title: " + "가".repeat(101)) + "## [서술] q").errors.join()).toMatch(/title은 100자/);
    expect(parse(head("program: " + "가".repeat(61) + "\n") + "## [서술] q").ok).toBe(false);
    expect(parse(head() + Array.from({ length: 41 }, (_, i) => `## [서술] q${i}`).join("\n")).errors.join()).toMatch(/최대 40개/);
    const manyOpts = Array.from({ length: 21 }, (_, i) => `- 보기${i}`).join("\n");
    expect(parse(head() + "## [단일] q\n" + manyOpts).errors.join()).toMatch(/20개 이내/);
    expect(parse(head() + "## [단일] q\n- " + "가".repeat(101) + "\n- 나").errors.join()).toMatch(/100자 이내/);
    expect(parse(head().replace("slug: abc\n", "")).errors.join()).toMatch(/slug가 없음/);
    expect(parse(head().replace("deadline: 2026-12-31\n", "")).errors.join()).toMatch(/deadline이 없음/);
    expect(parse(head().replace("title: t\n", "")).errors.join()).toMatch(/title이 없음/);
  });

  it("5점 문항의 라벨을 적지 않으면 기본 라벨", () => {
    const r = parse("---\ntitle: t\nslug: abc\ndeadline: 2026-12-31\n---\n## [5점] 질문");
    expect([r.spec.questions[0].low, r.spec.questions[0].high]).toEqual(["매우 낮음", "매우 높음"]);
  });
});

describe("md 내보내기", () => {
  it.each([
    ["힐링캠프", sample],
    ["행사 템플릿", evMd("event-test", "행사", "2026", "행사", "2026-12-31", 30)],
  ])("%s: 내보낸 md 를 다시 읽으면 같은 명세", (_, md) => {
    const spec = importMd(md).spec;
    const again = importMd(exportMd(spec));
    expect(again.errors).toEqual([]);
    expect(again.spec).toEqual(spec);
  });

  it("해석한 명세는 저장 형식 검사를 통과함", () => {
    expect(SurveySpecSchema.safeParse(importMd(sample).spec).success).toBe(true);
  });
});

describe("공개용 설문·문항 id", () => {
  it("응답자에게 보내는 데이터에 대상 인원·사업명 등 내부 정보가 없음", () => {
    const pub = toPublicSurvey(importMd(sample).spec);
    const raw = JSON.stringify(pub);
    expect(raw).not.toContain("target");
    expect(raw).not.toContain("program");
    expect(raw).not.toContain("kpiQuestionId");
    expect(pub.questions).toHaveLength(12);
  });

  it("다음 문항 id 는 남아 있는 가장 큰 번호 + 1", () => {
    expect(nextQuestionId([])).toBe("Q1");
    expect(nextQuestionId([{ id: "Q1" }, { id: "Q7" }, { id: "Q3" }])).toBe("Q8");
  });
});
