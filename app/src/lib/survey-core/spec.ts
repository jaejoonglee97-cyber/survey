import { z } from "zod";

// 설문 명세: 시스템의 기준 데이터. surveys 탭의 questions_json 등에 저장됨.
// 원 설계: survey-platform-handoff/docs/02-architecture.md 4절, 프로토타입: reference/Survey.gs

export const QUESTION_TYPES = ["single", "multi", "scale5", "scale10", "text"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** 점수형 문항(5점·10점 척도) */
export const isScaleType = (t: QuestionType): t is "scale5" | "scale10" => t === "scale5" || t === "scale10";
/** 점수형 문항의 최고 점수(1점부터 시작) */
export const scaleMax = (t: QuestionType): number => (t === "scale10" ? 10 : 5);

export const LIMITS = {
  maxQuestions: 40,
  recommendedQuestions: 12,
  maxQuestionText: 200,
  maxOptions: 20,
  minOptions: 2,
  maxOptionLabel: 100,
  maxTextAnswer: 1000,
  maxOtherAnswer: 200,
  maxTitle: 100,
  maxCategory: 20,
  maxProgram: 60,
  maxIntro: 1000,
  maxTarget: 100000,
  dashboardMinN: 5,
  /** 설문 하나가 받을 수 있는 응답 수 상한(공개 링크 남용 방지) */
  maxResponsesPerSurvey: 5000,
} as const;

/** 복수 선택 응답을 셀 하나에 담을 때의 구분자 */
export const MULTI_SEP = " | ";

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

export interface QuestionOption {
  label: string;
  /** true 면 '기타(직접입력)' 보기: 응답은 "라벨: 내용" 형태 */
  other?: boolean;
}

export interface Question {
  /** 'Q1', 'Q2' … 생성 시 부여하고 순서를 바꿔도 유지함(응답 열·대표 문항이 id 에 묶임) */
  id: string;
  type: QuestionType;
  text: string;
  required: boolean;
  /** 영역 제목 */
  section?: string;
  /** 질문 아래 안내 */
  note?: string;
  /** single/multi 보기 */
  options?: QuestionOption[];
  /** multi: 최대 선택 개수(없거나 0이면 제한 없음) */
  max?: number;
  /** scale5·scale10: 양 끝 라벨 */
  low?: string;
  high?: string;
}

export interface SurveySpec {
  title: string;
  slug: string;
  category: string;
  /** 사업명. 해마다 같은 이름을 써야 연도별 추이가 이어짐 */
  program: string;
  year: number;
  /** 'YYYY-MM-DD HH:mm' (한국시간). 표기한 분이 끝날 때(:59.999)까지 접수 */
  deadline: string;
  target?: number;
  intro: string;
  questions: Question[];
  /** 대표 만족도 문항(scale5) id */
  kpiQuestionId: string | null;
}

// 저장된 JSON 을 다시 읽을 때의 형식 검사(내용 규칙은 validate.ts 가 담당)
export const QuestionSchema = z.object({
  id: z.string().regex(/^Q\d{1,3}$/),
  type: z.enum(QUESTION_TYPES),
  text: z.string().max(LIMITS.maxQuestionText),
  required: z.boolean(),
  section: z.string().max(100).optional(),
  note: z.string().max(300).optional(),
  options: z
    .array(z.object({ label: z.string().max(LIMITS.maxOptionLabel), other: z.boolean().optional() }))
    .max(LIMITS.maxOptions)
    .optional(),
  max: z.number().int().min(0).optional(),
  low: z.string().max(50).optional(),
  high: z.string().max(50).optional(),
});

export const SurveySpecSchema = z.object({
  title: z.string().max(LIMITS.maxTitle),
  slug: z.string().regex(SLUG_RE),
  category: z.string().max(LIMITS.maxCategory),
  program: z.string().max(LIMITS.maxProgram),
  year: z.number().int().min(2000).max(2099),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/),
  target: z.number().int().min(1).max(LIMITS.maxTarget).optional(),
  intro: z.string().max(LIMITS.maxIntro),
  questions: z.array(QuestionSchema).max(LIMITS.maxQuestions),
  kpiQuestionId: z.string().nullable(),
});

/** 시험용 설문인지(링크 주소가 test- 로 시작하거나 제목·사업명이 [시험] 으로 시작). 시험 데이터 정리 대상 */
export function isTestSurvey(spec: Pick<SurveySpec, "slug" | "title" | "program">): boolean {
  return spec.slug.startsWith("test-") || spec.title.trim().startsWith("[시험]") || spec.program.trim().startsWith("[시험]");
}

/** 응답자에게 보내는 공개용 설문(대상 인원·내부 값 제외) */
export interface PublicSurvey {
  title: string;
  intro: string;
  deadline: string;
  questions: Question[];
}

export function toPublicSurvey(spec: SurveySpec): PublicSurvey {
  return {
    title: spec.title,
    intro: spec.intro,
    deadline: spec.deadline,
    questions: spec.questions.map((q) => ({ ...q })),
  };
}

/** 다음 문항 id: 남아 있는 가장 큰 번호 + 1. 게시 전 초안에서만 쓰므로 번호가 다시 쓰여도 응답과 엇갈리지 않음 */
export function nextQuestionId(questions: Pick<Question, "id">[]): string {
  const max = questions.reduce((m, q) => {
    const n = Number(q.id.replace(/^Q/, ""));
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `Q${max + 1}`;
}
