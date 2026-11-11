import { nextQuestionId, type Question, type QuestionOption, type SurveySpec } from "../survey-core";
import { KPI_HIGH, KPI_LOW, kpiText } from "./editor-ops";

// 문항 은행·시작 템플릿·보기 세트. 모두 설계 기준(한 문항 한 가지, 개인정보 미수집, 합쇼체)을 지킨 문구임.

export type BankQuestion = Omit<Question, "id"> & { kpi?: boolean };

export interface BankGroup {
  name: string;
  items: BankQuestion[];
}

const sat = (text: string, low = KPI_LOW, high = KPI_HIGH): BankQuestion => ({ type: "scale5", text, required: true, low, high });
const opts = (...labels: string[]): QuestionOption[] =>
  labels.map((l) => (l.endsWith("(직접입력)") ? { label: l.replace("(직접입력)", ""), other: true } : { label: l }));

/** 대표 만족도 문항. 사업·행사명이 바뀌면 문구도 따라 바뀜 */
export const KPI_ITEM: BankQuestion = { ...sat(kpiText("")), kpi: true };

export const QUESTION_BANK: BankGroup[] = [
  { name: "전반 평가", items: [KPI_ITEM] },
  {
    name: "내용·운영",
    items: [
      sat("내용(주제·구성)에 만족하십니까?"),
      sat("행사 진행 방식에 만족하십니까?"),
      sat("일정과 시간 배분은 적절했습니까?", "전혀 적절하지 않음", "매우 적절함"),
      sat("교육 내용이 업무에 도움이 되었습니까?", "전혀 도움 안 됨", "매우 도움 됨"),
      sat("프로그램 난이도는 적절했습니까?", "전혀 적절하지 않음", "매우 적절함"),
    ],
  },
  {
    name: "강사·진행",
    items: [sat("강사의 전문성에 만족하십니까?"), sat("강사의 전달력에 만족하십니까?"), sat("진행자의 안내에 만족하십니까?")],
  },
  {
    name: "장소·안내",
    items: [
      sat("행사 장소(시설)에 만족하십니까?"),
      sat("사전 안내(공지·준비 자료)는 충분했습니까?", "전혀 충분하지 않음", "매우 충분함"),
      sat("협회의 안내와 지원 과정에 만족하십니까?"),
      {
        type: "single",
        text: "이 행사를 어떻게 알게 되셨습니까?",
        required: false,
        options: opts("협회 누리집", "문자·이메일 안내", "소속 기관 공문", "동료 추천", "기타(직접입력)"),
      },
    ],
  },
  {
    name: "성과·후속",
    items: [
      {
        type: "multi",
        text: "가장 좋았던 점은 무엇입니까?",
        required: false,
        max: 2,
        options: opts("내용", "강사·진행자", "동료와의 교류", "장소·시설", "일정·시간", "기타(직접입력)"),
      },
      {
        type: "multi",
        text: "참여를 통해 가장 크게 얻은 것은 무엇입니까?",
        required: false,
        max: 2,
        options: opts("업무 지식", "실무 기술", "동료 네트워크", "쉼과 회복", "동기 부여", "기타(직접입력)"),
      },
      { type: "single", text: "다른 동료에게 추천하시겠습니까?", required: true, options: opts("적극 추천", "추천", "보통", "추천하지 않음") },
      { type: "single", text: "다음에도 참여할 의향이 있습니까?", required: true, options: opts("있음", "없음", "잘 모르겠음") },
      {
        type: "multi",
        text: "앞으로 다루었으면 하는 주제를 골라 주십시오.",
        required: false,
        options: opts("정책·제도", "실무 역량", "소진 예방·회복", "기관 운영", "디지털 활용", "기타(직접입력)"),
      },
    ],
  },
  {
    name: "점수(10점 척도)",
    items: [
      { type: "scale10", text: "이 프로그램을 동료에게 추천할 의향은 어느 정도입니까?", required: true, low: "전혀 추천하지 않음", high: "적극 추천함" },
      { type: "scale10", text: "이번 참여에서 스스로의 도전에 몇 점을 주시겠습니까?", required: true, low: "매우 낮음", high: "매우 높음" },
    ],
  },
  {
    name: "참여자 구분(겹쳐 묻지 않기)",
    items: [
      {
        type: "single",
        text: "소속 기관 유형은 무엇입니까?",
        required: false,
        options: opts("이용시설", "생활시설", "공공기관", "기타(직접입력)"),
      },
      { type: "single", text: "사회복지 현장 경력은 어느 정도입니까?", required: false, options: opts("3년 미만", "3년 이상 10년 미만", "10년 이상") },
    ],
  },
  {
    name: "서술 의견",
    items: [
      { type: "text", text: "개선 의견을 자유롭게 적어 주십시오.", required: false },
      { type: "text", text: "좋았던 점이나 하고 싶은 말씀을 자유롭게 적어 주십시오.", required: false },
    ],
  },
];

/** 문항 은행의 문항을 맨 뒤에 추가. 대표 문항이 없을 때 대표 문항을 넣으면 대표로 지정 */
export function addFromBank(spec: SurveySpec, item: BankQuestion): SurveySpec {
  const id = nextQuestionId(spec.questions);
  const { kpi, ...rest } = item;
  const q: Question = { ...structuredClone(rest), id } as Question;
  if (kpi) q.text = kpiText(spec.program);
  const next = { ...spec, questions: [...spec.questions, q] };
  if (kpi && !spec.kpiQuestionId) next.kpiQuestionId = id;
  return next;
}

/** 이미 같은 문구의 문항이 있는지(은행에서 '추가됨' 표시용) */
export function hasQuestion(spec: SurveySpec, item: BankQuestion): boolean {
  if (item.kpi) return !!spec.kpiQuestionId;
  return spec.questions.some((q) => q.text.trim() === item.text.trim());
}

// ───────── 보기 세트 ─────────

export const OPTION_PRESETS: { name: string; options: QuestionOption[] }[] = [
  { name: "예 / 아니요", options: opts("예", "아니요") },
  { name: "있음 / 없음 / 잘 모르겠음", options: opts("있음", "없음", "잘 모르겠음") },
  { name: "추천 4단계", options: opts("적극 추천", "추천", "보통", "추천하지 않음") },
  { name: "참여 횟수", options: opts("처음", "2~3회", "4회 이상") },
];

/** 여러 줄 글 → 보기. 한 줄에 하나, 끝에 (직접입력) 을 붙이면 직접입력 보기 */
export function parseOptionLines(text: string): QuestionOption[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .map((l) => (/\(직접\s*입력\)\s*$/.test(l) ? { label: l.replace(/\(직접\s*입력\)\s*$/, "").trim(), other: true } : { label: l }));
}

export function optionsToLines(options: QuestionOption[] | undefined): string {
  return (options ?? []).map((o) => (o.other ? `${o.label}(직접입력)` : o.label)).join("\n");
}

// ───────── 시작 템플릿 ─────────

export interface StartTemplate {
  key: string;
  name: string;
  description: string;
  category: string;
  items: BankQuestion[];
}

const find = (text: string) => {
  for (const g of QUESTION_BANK) for (const i of g.items) if (i.text === text) return i;
  throw new Error("문항 은행에 없음: " + text);
};

export const START_TEMPLATES: StartTemplate[] = [
  {
    key: "event",
    name: "행사·교육 공통",
    description: "대표 만족도, 내용, 진행, 사전 안내, 추천, 좋았던 점, 개선 의견 (7문항, 약 1~2분)",
    category: "행사",
    items: [
      KPI_ITEM,
      find("내용(주제·구성)에 만족하십니까?"),
      find("행사 진행 방식에 만족하십니까?"),
      find("사전 안내(공지·준비 자료)는 충분했습니까?"),
      find("다른 동료에게 추천하시겠습니까?"),
      find("가장 좋았던 점은 무엇입니까?"),
      find("개선 의견을 자유롭게 적어 주십시오."),
    ],
  },
  {
    key: "education",
    name: "교육",
    description: "대표 만족도, 내용, 강사 전문성·전달력, 업무 도움, 다음 주제, 개선 의견 (7문항)",
    category: "교육",
    items: [
      KPI_ITEM,
      find("내용(주제·구성)에 만족하십니까?"),
      find("강사의 전문성에 만족하십니까?"),
      find("강사의 전달력에 만족하십니까?"),
      find("교육 내용이 업무에 도움이 되었습니까?"),
      find("앞으로 다루었으면 하는 주제를 골라 주십시오."),
      find("개선 의견을 자유롭게 적어 주십시오."),
    ],
  },
  {
    key: "program",
    name: "사업(참여형)",
    description: "대표 만족도, 얻은 것, 일정, 협회 지원, 재참여 의향, 개선 의견 (6문항). 힐링캠프 같은 참여형 사업용",
    category: "사업",
    items: [
      KPI_ITEM,
      find("참여를 통해 가장 크게 얻은 것은 무엇입니까?"),
      find("일정과 시간 배분은 적절했습니까?"),
      find("협회의 안내와 지원 과정에 만족하십니까?"),
      find("다음에도 참여할 의향이 있습니까?"),
      find("개선 의견을 자유롭게 적어 주십시오."),
    ],
  },
  { key: "blank", name: "빈 설문", description: "대표 만족도 문항 1개만 두고 직접 채움", category: "기타", items: [KPI_ITEM] },
];

/** 템플릿 문항으로 설문 문항을 채움(기본 정보는 그대로, 분류는 비어 있거나 기본값일 때만 템플릿 분류로) */
export function applyTemplate(spec: SurveySpec, t: StartTemplate): SurveySpec {
  let s: SurveySpec = { ...spec, questions: [], kpiQuestionId: null, category: t.category };
  for (const item of t.items) s = addFromBank(s, item);
  return s;
}
