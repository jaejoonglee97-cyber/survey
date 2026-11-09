import { SurveyEditor } from "@/components/admin/SurveyEditor";
import { PageHeader } from "@/components/admin/ui";
import { starterSpec } from "@/lib/admin/editor-ops";
import { loadPreviousSurveys } from "@/lib/admin/previous";
import { requirePage } from "@/lib/auth/staff";

export const dynamic = "force-dynamic";
export const metadata = { title: "새 설문 · 만족도 설문" };

export default async function NewSurveyPage() {
  await requirePage("admin", "/survey/new");
  const previous = await loadPreviousSurveys();
  return (
    <>
      <PageHeader title="새 설문" description="기본 정보와 문항을 채우고 점검을 통과하면 게시할 수 있음. 기본 문항 5개로 시작함." />
      <SurveyEditor id={null} initial={starterSpec(new Date())} previous={previous} />
    </>
  );
}
