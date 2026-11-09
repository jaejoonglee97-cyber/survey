import { headers } from "next/headers";
import Link from "next/link";
import { CopyButton } from "@/components/admin/CopyButton";
import { RowActions } from "@/components/admin/RowActions";
import { Card, PageHeader, StateChip, buttonCls } from "@/components/admin/ui";
import { loadOverview } from "@/lib/admin/load";
import { responseRate, sortForList } from "@/lib/admin/overview";
import { requirePage } from "@/lib/auth/staff";

export const dynamic = "force-dynamic";
export const metadata = { title: "설문 목록 · 만족도 설문" };

type Props = { searchParams: Promise<{ published?: string }> };

export default async function SurveyList({ searchParams }: Props) {
  await requirePage("admin", "/survey/list");
  const { published } = await searchParams;
  const items = sortForList(await loadOverview());
  const h = await headers();
  const site = process.env.NEXT_PUBLIC_SITE_URL || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;

  return (
    <>
      <PageHeader
        title="설문 목록"
        description="제목을 누르면 결과를 볼 수 있음. 초안은 편집 화면으로 이동함."
        actions={
          <Link href="/survey/new" className={buttonCls.primary}>
            새 설문
          </Link>
        }
      />
      {published && items.some((i) => i.slug === published) && (
        <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[18px] bg-lime-soft px-5 py-4">
          <p className="text-[15px]">
            게시함. 응답 링크: <span className="font-mono font-semibold">{site}/s/{published}</span>
          </p>
          <CopyButton text={`${site}/s/${published}`} label="링크 복사" />
        </div>
      )}
      <Card title="전체 설문" badge={items.length}>
        {items.length === 0 ? (
          <p className="text-[14px] text-muted-text">아직 설문이 없음.</p>
        ) : (
          <div className="relative -mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[760px] text-left text-[14px]">
              <thead className="border-b border-line text-[12px] text-muted-text">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-semibold">제목</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">분류 · 사업명</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">마감</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">응답/대상</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">상태</th>
                  <th scope="col" className="py-2 font-semibold">
                    <span className="sr-only">작업</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((i) => {
                  const rate = responseRate(i.responses, i.target);
                  return (
                    <tr key={i.id} className="align-middle">
                      <td className="py-3 pr-3">
                        <Link href={i.state === "draft" ? `/survey/${i.id}/edit` : `/survey/${i.id}/results`} className="font-semibold hover:underline">
                          {i.title}
                        </Link>
                        <div className="text-[12px] text-muted-text">/s/{i.slug}</div>
                      </td>
                      <td className="py-3 pr-3">
                        {i.category} · {i.program}
                      </td>
                      <td className="whitespace-nowrap py-3 pr-3 tabular-nums">{i.deadline}</td>
                      <td className="whitespace-nowrap py-3 pr-3 tabular-nums">
                        {i.responses}
                        {i.target ? ` / ${i.target} (${rate}%)` : "명"}
                      </td>
                      <td className="py-3 pr-3">
                        <StateChip state={i.state} />
                      </td>
                      <td className="py-3 text-right">
                        <RowActions id={i.id} slug={i.slug} title={i.title} state={i.state} deadline={i.deadline} responses={i.responses} siteUrl={site} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
