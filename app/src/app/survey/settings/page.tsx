import { StaffManager } from "@/components/admin/StaffManager";
import { TestDataCleaner } from "@/components/admin/TestDataCleaner";
import { Card, PageHeader } from "@/components/admin/ui";
import { loadOverview } from "@/lib/admin/load";
import { requirePage } from "@/lib/auth/staff";
import { getStore } from "@/lib/sheets/client";
import { isTestSurvey } from "@/lib/survey-core";

export const dynamic = "force-dynamic";
export const metadata = { title: "설정 · 만족도 설문" };

export default async function SettingsPage() {
  const me = await requirePage("admin", "/survey/settings");
  const [staff, overview] = await Promise.all([getStore().listStaff(), loadOverview()]);
  const tests = overview.filter((s) => isTestSurvey(s)).map((s) => ({ id: s.id, title: s.title, slug: s.slug, responses: s.responses }));

  return (
    <>
      <PageHeader title="설정" description="직원 권한과 시험 데이터를 관리함." />
      <div className="space-y-5">
        <Card title="직원 관리" badge={staff.length}>
          <StaffManager staff={staff} me={me.email} />
        </Card>
        <Card title="시험 데이터 정리" badge={tests.length}>
          <p className="mb-3 text-[13px] text-muted-text">
            시험용 설문(링크 주소 test-…, 제목·사업명 [시험]…)은 응답이 있어도 여기서 한꺼번에 지울 수 있음. 실제 운영 전에 정리할 것.
          </p>
          <TestDataCleaner rows={tests} />
        </Card>
      </div>
    </>
  );
}
