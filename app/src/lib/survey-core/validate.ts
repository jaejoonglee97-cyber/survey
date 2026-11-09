import { normalizeDeadline } from "./deadline";
import { LIMITS, SLUG_RE, type Question, type SurveySpec } from "./spec";

// 설문 초안 점검. 담당자 편집기(지금)와 AI 설계(나중) 모두 이 규칙을 최종 방어선으로 씀.
// 규칙과 코드명: survey-platform-handoff/docs/03-builder-chat.md 5절.
// level: error = 확정 불가, warning = 확인 사항(확정 가능), autofix = applyAutoFixes 가 고쳐 줌

export type IssueLevel = "error" | "warning" | "autofix";
export type IssueCode =
  | "META"
  | "NO_QUESTIONS"
  | "NO_KPI"
  | "KPI_NOT_SCALE5"
  | "SCALE_LABELS"
  | "OPTIONS"
  | "QUESTION_TEXT"
  | "DUPLICATE_ID"
  | "PII_QUESTION"
  | "TOO_MANY"
  | "TOO_LONG"
  | "TEXT_MANY"
  | "NO_PII_NOTICE"
  | "DOUBLE_BARRELED"
  | "CROSS_SEGMENT"
  | "PREV_WORDING_CHANGED"
  | "AFFILIATION";

export interface Issue {
  code: IssueCode;
  level: IssueLevel;
  message: string;
  questionId?: string;
}

export interface ValidationReport {
  issues: Issue[];
  errorCount: number;
  warningCount: number;
  /** 예상 응답 시간(초) */
  estimatedSeconds: number;
  /** 오류가 없으면 확정 가능 */
  canConfirm: boolean;
}

export const PII_NOTICE = "서술 문항에는 이름·소속 등 개인을 알 수 있는 내용을 적지 말아 주십시오.";

const SECONDS: Record<Question["type"], number> = { single: 8, multi: 12, scale5: 6, text: 40 };
const PII_RE = /이름|성명|성함|연락처|전화|휴대폰|핸드폰|주민등록|주민번호|생년월일|이메일|e-?mail|주소|계좌/i;
const AFFILIATION_RE = /소속|직위|직책|기관명|근무처|근무지/;
const SEGMENT_RE = /유형|연령|나이|근무|직급|경력|성별|지역|기관|학력|직종/;
// 휴리스틱: ' 및 ', '그리고', 'A과/와 B에' (한 문항에서 두 가지를 묻는 패턴)
const DOUBLE_RE = /\s및\s|그리고|\S(과|와)\s+\S+에\s/;
const FORMULA_START = /^[=+\-@]/;

export interface ValidateOptions {
  /** 같은 사업의 이전 설문(문구 유지 확인용) */
  previous?: Pick<SurveySpec, "questions" | "kpiQuestionId">;
  /** 메타 정보(제목·slug·마감일) 검사를 건너뜀(문항만 편집 중일 때) */
  skipMeta?: boolean;
}

export function estimateSeconds(questions: Question[]): number {
  return questions.reduce((s, q) => s + SECONDS[q.type], 0);
}

export function validateDraft(spec: SurveySpec, opts: ValidateOptions = {}): ValidationReport {
  const issues: Issue[] = [];
  const add = (code: IssueCode, level: IssueLevel, message: string, questionId?: string) =>
    issues.push(questionId ? { code, level, message, questionId } : { code, level, message });
  const qs = spec.questions;

  // 기본 정보
  if (!opts.skipMeta) {
    if (!spec.title.trim()) add("META", "error", "설문 제목이 없음");
    else if (spec.title.length > LIMITS.maxTitle) add("META", "error", "설문 제목은 100자 이내여야 함");
    if (!SLUG_RE.test(spec.slug)) add("META", "error", "링크 주소(slug)는 영문 소문자·숫자·하이픈 2~40자여야 함");
    if (!normalizeDeadline(spec.deadline)) add("META", "error", "마감일 형식이 올바르지 않음(YYYY-MM-DD HH:mm)");
    if (!spec.category.trim() || spec.category.length > LIMITS.maxCategory) add("META", "error", "분류는 1~20자여야 함");
    if (!spec.program.trim() || spec.program.length > LIMITS.maxProgram) add("META", "error", "사업명은 1~60자여야 함");
    if (spec.target !== undefined && !(Number.isInteger(spec.target) && spec.target >= 1 && spec.target <= LIMITS.maxTarget)) {
      add("META", "error", "대상 인원은 1 이상의 정수여야 함");
    }
    if (spec.intro.length > LIMITS.maxIntro) add("META", "error", "안내문은 1000자 이내여야 함");
  }

  // 문항 수
  if (qs.length === 0) add("NO_QUESTIONS", "error", "문항이 1개도 없음");
  if (qs.length > LIMITS.maxQuestions) add("TOO_MANY", "error", `문항은 최대 ${LIMITS.maxQuestions}개까지 가능함`);
  else if (qs.length > LIMITS.recommendedQuestions) {
    add("TOO_MANY", "warning", `문항이 ${qs.length}개임. 응답 부담을 줄이려면 ${LIMITS.recommendedQuestions}개 이내를 권장함`);
  }

  const ids = new Set<string>();
  for (const q of qs) {
    if (ids.has(q.id)) add("DUPLICATE_ID", "error", `문항 id 가 중복됨: ${q.id}`, q.id);
    ids.add(q.id);

    if (!q.text.trim()) add("QUESTION_TEXT", "error", "질문 문구가 비어 있음", q.id);
    else if (q.text.length > LIMITS.maxQuestionText) add("QUESTION_TEXT", "error", "질문은 200자 이내여야 함", q.id);

    if (PII_RE.test(q.text)) {
      add("PII_QUESTION", "error", "개인을 알 수 있는 정보(이름·연락처·주소 등)를 묻는 문항은 만들 수 없음(무기명 원칙)", q.id);
    }

    if (q.type === "single" || q.type === "multi") {
      const opts2 = q.options ?? [];
      if (opts2.length < LIMITS.minOptions || opts2.length > LIMITS.maxOptions) {
        add("OPTIONS", "error", "선택형 문항의 보기는 2~20개여야 함", q.id);
      }
      const seen = new Set<string>();
      for (const o of opts2) {
        const label = o.label.trim();
        if (!label) add("OPTIONS", "error", "빈 보기가 있음", q.id);
        else if (seen.has(label)) add("OPTIONS", "error", `보기가 중복됨: ${label}`, q.id);
        seen.add(label);
        if (label.includes("|")) add("OPTIONS", "error", `보기에 | 문자를 쓸 수 없음: ${label}`, q.id);
        if (FORMULA_START.test(label)) add("OPTIONS", "error", `보기는 = + - @ 로 시작할 수 없음: ${label}`, q.id);
        if (label.length > LIMITS.maxOptionLabel) add("OPTIONS", "error", "보기는 100자 이내여야 함", q.id);
      }
      if (q.type === "multi" && q.max && q.max > opts2.length) {
        add("OPTIONS", "warning", "선택 개수 제한이 보기 수보다 큼", q.id);
      }
    }

    if (q.type === "scale5" && (!q.low?.trim() || !q.high?.trim())) {
      add("SCALE_LABELS", "error", "5점 문항에는 양 끝 라벨(낮음·높음)이 필요함", q.id);
    }

    if (DOUBLE_RE.test(q.text)) add("DOUBLE_BARRELED", "warning", "한 문항에서 두 가지를 묻는 것으로 보임. 나누는 것을 검토할 것", q.id);
    if (AFFILIATION_RE.test(q.text) && q.type === "text") {
      add("AFFILIATION", "warning", "소속·직위를 직접 적게 하면 개인이 드러날 수 있음. 기관 유형 같은 보기형을 권장함", q.id);
    }
  }

  // 대표 만족도 문항
  if (!spec.kpiQuestionId) add("NO_KPI", "error", "대표 만족도 문항(5점)이 지정되지 않음");
  else {
    const kq = qs.find((q) => q.id === spec.kpiQuestionId);
    if (!kq) add("NO_KPI", "error", "대표 만족도 문항으로 지정한 문항이 없음");
    else if (kq.type !== "scale5") add("KPI_NOT_SCALE5", "error", "대표 만족도 문항은 5점 척도여야 함", kq.id);
  }

  // 분량
  const sec = estimateSeconds(qs);
  if (sec > 300) add("TOO_LONG", "warning", `예상 응답 시간이 약 ${Math.ceil(sec / 60)}분임. 5분 이내를 권장함`);
  const textCount = qs.filter((q) => q.type === "text").length;
  if (textCount >= 3) add("TEXT_MANY", "warning", `서술 문항이 ${textCount}개임. 1~2개를 권장함`);
  if (textCount > 0 && !spec.intro.includes(PII_NOTICE)) {
    add("NO_PII_NOTICE", "autofix", "서술 문항이 있어 안내문에 개인정보 기재 금지 문구를 추가함");
  }

  // 소규모 집단 식별 방지
  const segments = qs.filter((q) => q.type === "single" && SEGMENT_RE.test(q.text));
  if (segments.length >= 3) {
    add("CROSS_SEGMENT", "warning", "응답자를 나누는 분류 문항이 3개 이상임. 겹쳐 물으면 개인이 드러날 수 있음");
  }

  // 이전 설문과 비교
  if (opts.previous) {
    const prev = opts.previous;
    const prevKpi = prev.questions.find((q) => q.id === prev.kpiQuestionId);
    const curKpi = qs.find((q) => q.id === spec.kpiQuestionId);
    if (prevKpi && curKpi && (prevKpi.text !== curKpi.text || prevKpi.low !== curKpi.low || prevKpi.high !== curKpi.high)) {
      add("PREV_WORDING_CHANGED", "warning", "대표 만족도 문항의 문구·라벨이 이전 설문과 달라 비교가 어려울 수 있음", curKpi.id);
    }
    for (const pq of prev.questions) {
      const cq = qs.find((q) => q.text === pq.text && q.type === pq.type);
      if (!cq || cq.id === curKpi?.id) continue;
      const a = (pq.options ?? []).map((o) => o.label + (o.other ? "*" : "")).join("\n");
      const b = (cq.options ?? []).map((o) => o.label + (o.other ? "*" : "")).join("\n");
      if (a !== b || pq.low !== cq.low || pq.high !== cq.high) {
        add("PREV_WORDING_CHANGED", "warning", "이전 설문과 같은 문항인데 보기·라벨이 바뀜", cq.id);
      }
    }
  }

  const errorCount = issues.filter((i) => i.level === "error").length;
  return {
    issues,
    errorCount,
    warningCount: issues.filter((i) => i.level === "warning").length,
    estimatedSeconds: sec,
    canConfirm: errorCount === 0,
  };
}

/** 자동 보정: 서술 문항이 있으면 안내문 끝에 개인정보 기재 금지 문구를 넣음. 원본은 바꾸지 않음. */
export function applyAutoFixes(spec: SurveySpec): SurveySpec {
  const hasText = spec.questions.some((q) => q.type === "text");
  if (!hasText || spec.intro.includes(PII_NOTICE)) return spec;
  const intro = spec.intro.trim() ? spec.intro.trim() + "\n" + PII_NOTICE : PII_NOTICE;
  return { ...spec, intro };
}
