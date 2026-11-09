import "server-only";
import { getStore } from "../sheets/client";
import type { OverviewItem } from "./overview";

/** 모든 설문 + 응답 수(응답 탭 수 세기는 한 번의 요청) */
export async function loadOverview(): Promise<OverviewItem[]> {
  const store = getStore();
  const list = await store.listSurveys();
  const counts = await store.responseCounts(list);
  return list.map((s) => ({
    id: s.id,
    title: s.spec.title,
    slug: s.spec.slug,
    category: s.spec.category,
    program: s.spec.program,
    year: s.spec.year,
    deadline: s.spec.deadline,
    target: s.spec.target,
    state: s.state,
    responses: counts.get(s.id) ?? 0,
  }));
}
