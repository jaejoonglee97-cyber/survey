// 데이터 스프레드시트의 탭 구성. PLAN.md 3절 기준.
// 응답 탭(r_<slug>)은 설문 게시 시점에 문항에 맞춰 만들므로 여기에 없음.

export const FIXED_TABS = {
  surveys: [
    "id",
    "slug",
    "title",
    "category",
    "program",
    "year",
    "deadline",
    "target",
    "intro",
    "questions_json",
    "kpi_question_id",
    "status",
    "created_by",
    "created_at",
    "published_at",
    "closed_at",
    "closed_notified_at",
  ],
  staff: ["email", "role", "active", "added_at"],
  summary: [
    "survey_id",
    "n",
    "d1",
    "d2",
    "d3",
    "d4",
    "d5",
    "mean",
    "positive_rate",
    "updated_at",
  ],
} as const satisfies Record<string, readonly string[]>;

export type FixedTabName = keyof typeof FIXED_TABS;

export const RESPONSE_TAB_PREFIX = "r_";

export interface ExistingTab {
  title: string;
  header: string[];
}

export type TabPlan =
  | { tab: FixedTabName; action: "ok" }
  | { tab: FixedTabName; action: "create" }
  | { tab: FixedTabName; action: "write_header" }
  | { tab: FixedTabName; action: "mismatch"; expected: readonly string[]; actual: string[] };

/**
 * 현재 시트 상태를 보고 무엇을 해야 하는지 계산함(순수 함수).
 * 이미 있는 머리글이 다르면 덮어쓰지 않고 'mismatch'로 보고만 함.
 */
export function planFixedTabs(existing: ExistingTab[]): TabPlan[] {
  return (Object.keys(FIXED_TABS) as FixedTabName[]).map((tab) => {
    const expected = FIXED_TABS[tab];
    const found = existing.find((t) => t.title === tab);
    if (!found) return { tab, action: "create" };
    const actual = found.header.map((h) => h.trim());
    while (actual.length > 0 && actual[actual.length - 1] === "") actual.pop();
    if (actual.length === 0) return { tab, action: "write_header" };
    const same = expected.length === actual.length && expected.every((h, i) => h === actual[i]);
    return same ? { tab, action: "ok" } : { tab, action: "mismatch", expected, actual };
  });
}
