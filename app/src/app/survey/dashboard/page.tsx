import Link from "next/link";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { PageHeader, buttonCls } from "@/components/admin/ui";
import { requirePage } from "@/lib/auth/staff";
import { getDashboardData } from "@/lib/dashboard/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "만족도 대시보드 · 만족도 설문" };

type Props = { searchParams: Promise<{ refresh?: string }> };

// 담당자·열람자 모두 접근 가능. 대표 문항 집계만 전달함
export default async function DashboardPage({ searchParams }: Props) {
  await requirePage("dashboard", "/survey/dashboard");
  const { refresh } = await searchParams;
  const data = await getDashboardData(refresh === "1");
  return (
    <>
      <PageHeader
        title="만족도 대시보드"
        description="사업·행사별 대표 만족도(5점)를 같은 눈금에 올려 비교함."
        actions={
          <Link href="/survey/dashboard?refresh=1" className={`${buttonCls.ghost} print:hidden`} prefetch={false}>
            새로고침
          </Link>
        }
      />
      <Dashboard rows={data.rows} minN={data.minN} generatedAt={data.generatedAt} />
    </>
  );
}
