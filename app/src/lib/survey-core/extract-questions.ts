import { importMd } from "./import-md";
import type { Question, QuestionOption, QuestionType } from "./spec";

// 문서에서 "문항만" 뽑아냄. 설문 제목·사업명·분류·마감일 같은 기본 정보는 담당자가 화면에서 정하므로 건드리지 않음.
// 읽을 수 있는 형식:
//  1) 표 형식: | 번호 | 영역 | 문항 | 유형 | 필수 | 보기·척도 | … |  (회의·보고용으로 정리한 문서)
//  2) 시스템 형식: ## [단일*] 질문 / - 보기 / low: / high: / 지표: 대표만족  (머리말 --- 은 없어도 됨)
// 한 문서에 설문이 여러 개 있으면(표가 여러 개) 각각을 후보로 돌려주고 담당자가 고름.

export interface QuestionSet {
  /** 표 바로 위의 제목(예: "Ⅰ. 2026 서울사회복지사 힐링캠프 만족도 설문 (12문항)") */
  label: string;
  questions: Question[];
  kpiQuestionId: string | null;
  /** 읽다가 건너뛴 줄 등 확인할 점 */
  notes: string[];
}

const clean = (s: string) =>
  s
    .replace(/\*\*|__|`/g, "")
    .replace(/<[^>]*>/g, "")
    .trim();

function splitRow(line: string): string[] {
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return t.split("|").map((c) => clean(c));
}

const isTableLine = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isDivider = (l: string) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l);

type Col = "no" | "section" | "text" | "type" | "required" | "options" | "note";

function headerColumns(cells: string[]): Partial<Record<Col, number>> | null {
  const map: Partial<Record<Col, number>> = {};
  cells.forEach((c, i) => {
    const h = c.replace(/\s/g, "");
    if (/^(번호|no\.?|#)$/i.test(h)) map.no = i;
    else if (/^(영역|구분|섹션)$/.test(h)) map.section = i;
    else if (/^(문항|질문|문항내용)$/.test(h)) map.text = i;
    else if (/^(유형|형식|응답유형)$/.test(h)) map.type = i;
    else if (/^(필수|필수여부)$/.test(h)) map.required = i;
    else if (/^(보기|보기·척도|보기\/척도|척도|선택지|보기및척도)$/.test(h)) map.options = i;
    else if (/^(비고|비교|메모)$/.test(h)) map.note = i;
  });
  return map.text !== undefined && map.type !== undefined ? map : null;
}

function parseType(raw: string): { type: QuestionType; max?: number } | null {
  const t = raw.replace(/\s/g, "");
  if (/5점|척도|리커트/.test(t)) return { type: "scale5" };
  if (/복수|다중|중복/.test(t)) {
    const m = raw.match(/최대\s*(\d+)/);
    return { type: "multi", ...(m ? { max: Number(m[1]) } : {}) };
  }
  if (/단일|객관식|선택/.test(t)) return { type: "single" };
  if (/서술|주관식|자유|텍스트/.test(t)) return { type: "text" };
  return null;
}

const REQUIRED_MARKS = new Set(["○", "◯", "O", "o", "●", "Y", "y", "예", "필수", "✓", "✔", "V", "v", "true", "TRUE"]);

function parseOptions(raw: string): QuestionOption[] {
  return raw
    .split(/\s+\/\s+|\s*;\s*|\s*\n\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((label) => {
      const other = /\(직접\s*입력\)\s*$/.test(label);
      const l = label.replace(/\(직접\s*입력\)\s*$/, "").trim();
      return other ? { label: l, other: true } : { label: l };
    });
}

function parseScale(raw: string): { low: string; high: string } | null {
  const m = raw.match(/1\s*(?:점)?\s*[:=]?\s*(.+?)\s*[~∼〜\-–—]\s*5\s*(?:점)?\s*[:=]?\s*(.+)$/);
  if (!m) return null;
  return { low: m[1].trim(), high: m[2].trim() };
}

/** 표 하나를 문항 목록으로 */
function tableToSet(label: string, header: string[], rows: string[][]): QuestionSet {
  const cols = headerColumns(header)!;
  const questions: Question[] = [];
  const notes: string[] = [];
  let kpi: string | null = null;
  for (const cells of rows) {
    const get = (c: Col) => (cols[c] !== undefined ? (cells[cols[c]!] ?? "") : "");
    const text = get("text");
    if (!text) continue;
    const kind = parseType(get("type"));
    if (!kind) {
      notes.push(`유형을 알 수 없어 건너뜀: "${text.slice(0, 30)}" (유형: ${get("type") || "없음"})`);
      continue;
    }
    const id = `Q${questions.length + 1}`;
    const q: Question = { id, type: kind.type, text, required: cols.required === undefined ? kind.type !== "text" : REQUIRED_MARKS.has(get("required").trim()) };
    const section = get("section");
    if (section) q.section = section;
    if (kind.type === "single" || kind.type === "multi") {
      q.options = parseOptions(get("options"));
      if (kind.type === "multi" && kind.max) q.max = kind.max;
      if (q.options.length < 2) notes.push(`${questions.length + 1}번: 보기가 2개 미만임. 편집기에서 보기를 채울 것`);
    }
    if (kind.type === "scale5") {
      const sc = parseScale(get("options"));
      q.low = sc?.low ?? "매우 불만족";
      q.high = sc?.high ?? "매우 만족";
      if (!sc) notes.push(`${questions.length + 1}번: 척도 양 끝 라벨을 찾지 못해 '매우 불만족~매우 만족'으로 넣음`);
    }
    // 대표 문항 표시: 어느 칸에든 '대표' 가 있으면
    if (q.type === "scale5" && !kpi && cells.some((c) => /대표\s*(만족도\s*)?문항|대표만족/.test(c))) kpi = id;
    questions.push(q);
  }
  // 표시가 없으면 '전반적으로 만족' 5점 문항을 대표로 추정
  if (!kpi) {
    const guess = questions.find((q) => q.type === "scale5" && /전반적으로\s*만족/.test(q.text));
    if (guess) {
      kpi = guess.id;
      notes.push(`대표 만족도 문항 표시가 없어 ${questions.indexOf(guess) + 1}번을 대표로 지정함`);
    }
  }
  return { label, questions, kpiQuestionId: kpi, notes };
}

export function extractQuestionSets(md: string): QuestionSet[] {
  const text = String(md ?? "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const sets: QuestionSet[] = [];
  let lastHeading = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (h && !/^\[/.test(h[1])) {
      lastHeading = clean(h[1]);
      continue;
    }
    if (!isTableLine(line) || !isDivider(lines[i + 1] ?? "")) continue;
    const header = splitRow(line);
    if (!headerColumns(header)) continue;
    const rows: string[][] = [];
    let j = i + 2;
    for (; j < lines.length && isTableLine(lines[j]); j++) rows.push(splitRow(lines[j]));
    const set = tableToSet(lastHeading || `표 ${sets.length + 1}`, header, rows);
    if (set.questions.length) sets.push(set);
    i = j - 1;
  }

  // 표가 없으면 시스템 형식(## [단일*] …)으로 읽어 봄. 머리말이 없어도 문항만 가져옴
  if (!sets.length && /^##\s*\[\s*(단일|복수|5점|서술)/m.test(text)) {
    const body = /^\s*---\s*$/m.test(text.split("\n").find((l) => l.trim() !== "") ?? "")
      ? text
      : `---\ntitle: x\nslug: xx\ndeadline: 2099-12-31\n---\n${text}`;
    const r = importMd(body);
    const qErrors = r.errors.filter((e) => !/title|slug|deadline|target|category|program|year|머리말/.test(e));
    if (r.spec.questions.length) {
      sets.push({
        label: "문서의 문항",
        questions: r.spec.questions,
        kpiQuestionId: r.spec.kpiQuestionId,
        notes: [...qErrors, ...r.warnings.filter((w) => !/머리말/.test(w))],
      });
    }
  }
  return sets;
}
