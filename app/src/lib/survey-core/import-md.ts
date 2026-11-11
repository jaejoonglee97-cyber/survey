import { normalizeDeadline } from "./deadline";
import { LIMITS, SLUG_RE, type Question, type QuestionType, type SurveySpec } from "./spec";

// md 문항 파일 ↔ 설문 명세. md 는 가져오기·내보내기 형식일 뿐 기준 데이터가 아님.
// 형식과 오류 문구는 프로토타입(reference/Survey.gs parseSurveyMd_)과 같음.

const TYPE_TAGS: Record<string, QuestionType> = { 단일: "single", 복수: "multi", "5점": "scale5", "10점": "scale10", 서술: "text" };
const TAG_OF: Record<QuestionType, string> = { single: "단일", multi: "복수", scale5: "5점", scale10: "10점", text: "서술" };

export interface ImportResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  spec: SurveySpec;
}

export function importMd(md: string): ImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const text = String(md ?? "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const meta: Record<string, string> = {};
  let i = 0;

  // 머리말(front matter)
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i < lines.length && lines[i].trim() === "---") {
    i++;
    let closed = false;
    for (; i < lines.length; i++) {
      const ln = lines[i];
      if (ln.trim() === "---") {
        closed = true;
        i++;
        break;
      }
      const km = ln.match(/^\s*([A-Za-z_]+)\s*:\s*(.*)$/);
      if (km) meta[km[1].toLowerCase()] = km[2].trim();
      else if (ln.trim() !== "") warnings.push("머리말에서 인식되지 않은 줄: " + ln.trim());
    }
    if (!closed) errors.push("머리말을 닫는 --- 줄이 없음");
  } else {
    errors.push("파일 첫머리에 --- 로 둘러싼 머리말(title, slug, deadline)이 필요함");
  }

  const spec: SurveySpec = {
    title: meta.title || "",
    slug: meta.slug || "",
    category: "",
    program: "",
    year: 0,
    deadline: "",
    intro: "",
    questions: [],
    kpiQuestionId: null,
  };

  if (!spec.title) errors.push("머리말에 title이 없음");
  else if (spec.title.length > LIMITS.maxTitle) errors.push("title은 100자 이내여야 함");

  if (!spec.slug) errors.push("머리말에 slug가 없음 (영문 소문자·숫자·하이픈 2~40자, 예: healing2026)");
  else if (!SLUG_RE.test(spec.slug)) errors.push("slug는 영문 소문자·숫자·하이픈 2~40자여야 함: " + spec.slug);

  if (!meta.deadline) errors.push("머리말에 deadline이 없음 (예: 2026-12-10 23:59)");
  else {
    const nd = normalizeDeadline(meta.deadline);
    if (!nd) errors.push("deadline 형식 오류 (YYYY-MM-DD 또는 YYYY-MM-DD HH:mm): " + meta.deadline);
    else spec.deadline = nd;
  }

  if (meta.target !== undefined && meta.target !== "") {
    const t = parseInt(meta.target, 10);
    if (!/^\d+$/.test(meta.target) || t < 1 || t > LIMITS.maxTarget) errors.push("target은 1 이상의 정수여야 함: " + meta.target);
    else spec.target = t;
  }

  // 대시보드 분류 정보
  spec.category = String(meta.category || "기타").trim();
  spec.program = String(meta.program || spec.title).trim();
  const yearStr = String(meta.year || "").trim();
  if (spec.category.length > LIMITS.maxCategory) errors.push("category는 20자 이내여야 함");
  if (spec.program.length > LIMITS.maxProgram) errors.push("program은 60자 이내여야 함");
  if (yearStr && !/^20\d{2}$/.test(yearStr)) errors.push("year는 4자리 연도여야 함 (예: 2026)");
  // 연도를 적지 않으면 마감일의 연도를 씀
  spec.year = /^20\d{2}$/.test(yearStr) ? Number(yearStr) : spec.deadline ? Number(spec.deadline.slice(0, 4)) : 0;

  // 본문
  type Draft = Question & { options: NonNullable<Question["options"]>; kpi: boolean };
  const drafts: Draft[] = [];
  let cur: Draft | null = null;
  let section = "";
  const introLines: string[] = [];
  let seenQuestion = false;

  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    const no = i + 1;
    if (line === "") continue;

    if (/^##/.test(line)) {
      const qm = line.match(/^##\s*\[\s*(단일|복수|10점|5점|서술)\s*(\*)?\s*(?::\s*(\d+))?\s*\]\s*(.+)$/);
      if (!qm) {
        errors.push(no + '행: 문항 형식 오류 → "## [단일*] 질문" 형태여야 함 (유형: 단일, 복수, 5점, 서술)');
        cur = null;
        continue;
      }
      cur = {
        id: "Q" + (drafts.length + 1),
        type: TYPE_TAGS[qm[1]],
        required: !!qm[2],
        max: qm[3] ? parseInt(qm[3], 10) : 0,
        text: qm[4].trim(),
        section,
        options: [],
        low: "",
        high: "",
        note: "",
        kpi: false,
      };
      if (qm[3] && cur.type !== "multi") warnings.push(no + "행: 선택 개수 제한(:숫자)은 [복수]에서만 적용됨");
      if (cur.text.length > LIMITS.maxQuestionText) errors.push(no + "행: 질문은 200자 이내여야 함");
      drafts.push(cur);
      seenQuestion = true;
      continue;
    }
    if (/^#\s/.test(line)) {
      section = line.replace(/^#\s+/, "").trim();
      cur = null;
      continue;
    }
    if (/^>/.test(line)) {
      if (!seenQuestion) introLines.push(line.replace(/^>\s?/, ""));
      else warnings.push(no + "행: 문항 뒤의 안내문(>)은 무시됨");
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (!cur) {
        warnings.push(no + "행: 문항 밖의 보기는 무시됨");
        continue;
      }
      if (cur.type !== "single" && cur.type !== "multi") {
        warnings.push(no + "행: " + cur.id + "은(는) 보기가 필요 없는 유형이라 무시됨");
        continue;
      }
      let label = line.replace(/^[-*]\s+/, "").trim();
      const other = /\(직접입력\)\s*$/.test(label);
      if (other) label = label.replace(/\(직접입력\)\s*$/, "").trim();
      if (!label) {
        errors.push(no + "행: 빈 보기");
        continue;
      }
      cur.options.push(other ? { label, other: true } : { label });
      continue;
    }
    const kv = line.match(/^(low|high|설명|지표)\s*:\s*(.+)$/i);
    if (kv && cur) {
      const k = kv[1].toLowerCase();
      const v = kv[2].trim();
      if (k === "low") cur.low = v;
      else if (k === "high") cur.high = v;
      else if (k === "지표") {
        if (v === "대표만족") cur.kpi = true;
        else warnings.push(no + "행: 알 수 없는 지표 값이라 무시됨(사용 가능: 대표만족) → " + v);
      } else cur.note = v;
      continue;
    }
    warnings.push(no + "행: 인식되지 않은 줄이라 무시됨 → " + line.slice(0, 40));
  }
  spec.intro = introLines.join("\n").trim();

  // 문항 검증
  if (drafts.length === 0) errors.push("문항이 1개도 없음");
  if (drafts.length > LIMITS.maxQuestions) errors.push("문항은 최대 " + LIMITS.maxQuestions + "개까지 가능함");
  for (const q of drafts) {
    if (q.type === "single" || q.type === "multi") {
      if (q.options.length < LIMITS.minOptions) errors.push(q.id + ": 선택형 문항은 보기가 2개 이상 필요함 → " + q.text);
      if (q.options.length > LIMITS.maxOptions) errors.push(q.id + ": 보기는 20개 이내여야 함");
      const seen = new Set<string>();
      for (const o of q.options) {
        if (seen.has(o.label)) errors.push(q.id + ": 보기가 중복됨 → " + o.label);
        seen.add(o.label);
        if (o.label.includes("|")) errors.push(q.id + ": 보기에 | 문자를 쓸 수 없음 → " + o.label);
        if (/^[=+\-@]/.test(o.label)) errors.push(q.id + ": 보기는 = + - @ 로 시작할 수 없음 → " + o.label);
        if (o.label.length > LIMITS.maxOptionLabel) errors.push(q.id + ": 보기는 100자 이내여야 함");
      }
      if (q.type === "multi" && q.max && q.max > q.options.length) warnings.push(q.id + ": 선택 개수 제한이 보기 수보다 큼");
    }
    if (q.type === "scale5" || q.type === "scale10") {
      if (!q.low) q.low = "매우 낮음";
      if (!q.high) q.high = "매우 높음";
    }
  }

  const kpis = drafts.filter((q) => q.kpi);
  for (const q of kpis) if (q.type !== "scale5") errors.push(q.id + ": 대표 지표는 [5점] 문항에만 지정할 수 있음");
  if (kpis.length > 1) errors.push("대표 지표(지표: 대표만족)는 설문당 1개만 지정할 수 있음");
  if (kpis.length === 0 && drafts.length) {
    warnings.push(
      '대표 지표 문항이 없어 만족도 대시보드 비교에서 제외됨 (전반 만족도 [5점] 문항 아래에 "지표: 대표만족" 추가 권장)',
    );
  }
  spec.kpiQuestionId = kpis.length === 1 && kpis[0].type === "scale5" ? kpis[0].id : null;
  spec.questions = drafts.map(cleanQuestion);

  return { ok: errors.length === 0, errors, warnings, spec };
}

/** 빈 선택 필드를 지워 저장용 문항으로 만듦 */
function cleanQuestion(q: Question & { kpi?: boolean }): Question {
  const out: Question = { id: q.id, type: q.type, text: q.text, required: q.required };
  if (q.section) out.section = q.section;
  if (q.note) out.note = q.note;
  if (q.type === "single" || q.type === "multi") out.options = q.options ?? [];
  if (q.type === "multi" && q.max) out.max = q.max;
  if (q.type === "scale5" || q.type === "scale10") {
    out.low = q.low;
    out.high = q.high;
  }
  return out;
}

/** 설문 명세 → md (다시 importMd 로 읽으면 같은 명세가 됨) */
export function exportMd(spec: SurveySpec): string {
  const L: string[] = ["---", `title: ${spec.title}`, `slug: ${spec.slug}`, `category: ${spec.category}`, `program: ${spec.program}`];
  if (spec.year) L.push(`year: ${spec.year}`);
  L.push(`deadline: ${spec.deadline}`);
  if (spec.target) L.push(`target: ${spec.target}`);
  L.push("---", "");
  if (spec.intro) {
    for (const ln of spec.intro.split("\n")) L.push(`> ${ln}`);
    L.push("");
  }
  let section = "";
  for (const q of spec.questions) {
    if (q.section && q.section !== section) {
      section = q.section;
      L.push(`# ${section}`, "");
    }
    const mod = (q.required ? "*" : "") + (q.type === "multi" && q.max ? `:${q.max}` : "");
    L.push(`## [${TAG_OF[q.type]}${mod}] ${q.text}`);
    if (q.note) L.push(`설명: ${q.note}`);
    if (q.type === "scale5" || q.type === "scale10") {
      L.push(`low: ${q.low ?? ""}`, `high: ${q.high ?? ""}`);
      if (spec.kpiQuestionId === q.id) L.push("지표: 대표만족");
    }
    for (const o of q.options ?? []) L.push(`- ${o.label}${o.other ? "(직접입력)" : ""}`);
    L.push("");
  }
  return L.join("\n");
}
