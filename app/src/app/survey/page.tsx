import Link from "next/link";
import { Card, PageHeader, StatCard, StateChip, buttonCls } from "@/components/admin/ui";
import { loadOverview } from "@/lib/admin/load";
import { dLabel, homeStats, responseRate } from "@/lib/admin/overview";
import { requirePage } from "@/lib/auth/staff";

export const dynamic = "force-dynamic";
export const metadata = { title: "설문 홈 · 만족도 설문" };

export default async function SurveyHome() {
  await requirePage("admin", "/survey");
  const items = await loadOverview();
  const s = homeStats(items, new Date());

  return (
    <>
      <PageHeader
        title="만족도 설문"
        description="사업·행사가 끝나면 설문을 만들고, 응답과 결과를 한곳에서 확인함."
        actions={
          <Link href="/survey" className={buttonCls.ghost}>
            새로고침
          </Link>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard tone="lav" label="진행 중 설문" value={String(s.openCount)} unit="건" />
        <StatCard tone="blue" label="이번 주 마감" value={String(s.closingThisWeek)} unit="건" note="오늘부터 7일 안" />
        <StatCard tone="mint" label={`${s.year}년 응답`} value={s.yearResponses.toLocaleString("ko-KR")} unit="명" />
      </div>

      <section className="relative mt-5 overflow-hidden rounded-[18px] bg-teal-deep p-6 text-white lg:p-8">
        <h2 className="text-[22px] font-bold">새 설문을 만들어 보세요.</h2>
        <p className="mt-2 max-w-xl text-[14px] text-white/90">
          기본 정보를 넣고 문항을 추가하거나, 지난 설문(md 파일)을 불러와 고칠 수 있음. 점검을 통과하면 담당자가 직접 게시함.
        </p>
        <Link href="/survey/new" className="mt-4 inline-flex h-11 items-center rounded-[10px] bg-lime-soft px-5 font-bold text-ink focus-visible:outline-3 focus-visible:outline-white">
          새 설문 만들기 →
        </Link>
        <span className="pointer-events-none absolute -right-10 -top-10 hidden size-56 rounded-full border-[28px] border-white/10 md:block" aria-hidden="true" />
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card
          title="마감 임박 설문"
          badge={s.closingSoon.length}
          action={
            <Link href="/survey/list" className="text-[13px] font-semibold underline-offset-2 hover:underline">
              전체 보기 ↗
            </Link>
          }
        >
          {s.closingSoon.length === 0 ? (
            <p className="text-[14px] text-muted-text">진행 중인 설문이 없음.</p>
          ) : (
            <ul className="divide-y divide-line">
              {s.closingSoon.map((i) => {
                const rate = responseRate(i.responses, i.target);
                return (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <Link href={`/survey/${i.id}/results`} className="min-w-0 font-semibold hover:underline">
                      {i.title}
                    </Link>
                    <span className="flex items-center gap-2 text-[13px] text-muted-text">
                      <span className="rounded-full bg-lime-soft px-2 py-0.5 font-bold text-ink">{dLabel(i.days)}</span>
                      응답 {i.responses}
                      {i.target ? `/${i.target} (${rate}%)` : "명"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card
          title="최근 마감 설문"
          action={
            <Link href="/survey/dashboard" className="text-[13px] font-semibold underline-offset-2 hover:underline">
              대시보드로 ↗
            </Link>
          }
        >
          {s.recentClosed.length === 0 ? (
            <p className="text-[14px] text-muted-text">마감된 설문이 없음.</p>
          ) : (
            <ul className="divide-y divide-line">
              {s.recentClosed.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <Link href={`/survey/${i.id}/results`} className="min-w-0 font-semibold hover:underline">
                    {i.title}
                  </Link>
                  <span className="flex items-center gap-2 text-[13px] text-muted-text">
                    <StateChip state={i.state} />
                    응답 {i.responses}명
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
