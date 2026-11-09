import { notFound, redirect } from "next/navigation";
import { SurveyEditor } from "@/components/admin/SurveyEditor";
import { PageHeader } from "@/components/admin/ui";
import { loadPreviousSurveys } from "@/lib/admin/previous";
import { requirePage } from "@/lib/auth/staff";
import { getStore } from "@/lib/sheets/client";

export const dynamic = "force-dynamic";
export const metadata = { title: "설문 편집 · 만족도 설문" };

type Props = { params: Promise<{ id: string }> };

export default async function EditSurveyPage({ params }: Props) {
  const { id } = await params;
  await requirePage("admin", `/survey/${id}/edit`);
  const rec = await getStore().getById(id);
  if (!rec) notFound();
  // 게시된 설문은 문항을 바꿀 수 없음
  if (rec.status !== "draft") redirect(`/survey/${id}/results`);
  const previous = await loadPreviousSurveys(id);
  return (
    <>
      <PageHeader title="설문 편집" description="게시 전 초안임. 점검을 통과하면 게시할 수 있음." />
      <SurveyEditor id={rec.id} initial={rec.spec} previous={previous} />
    </>
  );
}
