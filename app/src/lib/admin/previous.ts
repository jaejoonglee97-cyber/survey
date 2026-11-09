import "server-only";
import type { PreviousSurvey } from "@/components/admin/SurveyEditor";
import { getStore } from "../sheets/client";

/** 편집기에서 참고할 지난 설문(게시된 것만, 지금 편집 중인 설문 제외). 응답·서술 의견은 포함하지 않음 */
export async function loadPreviousSurveys(excludeId?: string): Promise<PreviousSurvey[]> {
  const list = await getStore().listSurveys();
  return list
    .filter((s) => s.status !== "draft" && s.id !== excludeId)
    .map((s) => ({
      id: s.id,
      title: s.spec.title,
      program: s.spec.program,
      year: s.spec.year,
      intro: s.spec.intro,
      questions: s.spec.questions,
      kpiQuestionId: s.spec.kpiQuestionId,
    }));
}
