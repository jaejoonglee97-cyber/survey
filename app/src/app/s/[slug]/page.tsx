import type { Metadata } from "next";
import { SurveyForm } from "@/components/respond/SurveyForm";
import { StateView } from "@/components/respond/StateView";
import { getStore } from "@/lib/sheets/client";
import { toPublicSurvey } from "@/lib/survey-core";

// 공개 응답 화면. 서버에서 진행 중인 설문의 문항만 읽어 전달함(대상 인원·사업명·작성자 등은 보내지 않음).
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  try {
    return { ok: true as const, survey: await getStore().getBySlug(slug) };
  } catch {
    return { ok: false as const };
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const r = await load(slug);
  const title = r.ok && r.survey && r.survey.status !== "draft" ? r.survey.spec.title : "만족도 설문";
  return { title, robots: { index: false, follow: false } };
}

export default async function RespondPage({ params }: Props) {
  const { slug } = await params;
  const r = await load(slug);
  if (!r.ok) return <StateView title="설문을 불러오지 못했습니다" lines={["잠시 후 다시 접속해 주십시오."]} />;
  const s = r.survey;
  if (!s || s.status === "draft") {
    return <StateView title="설문을 찾을 수 없습니다" lines={["안내받은 링크를 다시 확인해 주십시오."]} />;
  }
  if (s.state !== "open") {
    return <StateView title="마감된 설문입니다" lines={[s.spec.title, `마감: ${s.spec.deadline}`, "참여해 주셔서 감사합니다."]} />;
  }
  return <SurveyForm slug={slug} survey={toPublicSurvey(s.spec)} />;
}
