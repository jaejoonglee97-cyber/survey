import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CopyButton } from "@/components/admin/CopyButton";
import { EvaluationPanel } from "@/components/admin/EvaluationPanel";
import { ResponseProgress } from "@/components/admin/ResponseProgress";
import { ShareCard } from "@/components/admin/ShareCard";
import { Card, DistBar, PageHeader, StatCard, StateChip, buttonCls } from "@/components/admin/ui";
import { daysLeft } from "@/lib/admin/overview";
import { qrDataUrl, responseUrl } from "@/lib/admin/qr";
import { responseTimeline } from "@/lib/admin/timeline";
import { requirePage } from "@/lib/auth/staff";
import { getStore } from "@/lib/sheets/client";
import { aggregate, buildReportLines, kpiOf, pct, type QuestionAgg } from "@/lib/survey-core";

export const dynamic = "force-dynamic";
export const metadata = { title: "설문 결과 · 만족도 설문" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ published?: string }> };

export default async function ResultsPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { published } = await searchParams;
  await requirePage("admin", `/survey/${id}/results`);
  const store = getStore();
  const rec = await store.getById(id);
  if (!rec) notFound();
  if (rec.status === "draft") redirect(`/survey/${id}/edit`);

  const { rows, submittedAt } = await store.readResponses(rec);
  const agg = aggregate(rec.spec, rows);
  const kpi = kpiOf(rec.spec, agg);
  const report = buildReportLines(rec.spec, agg).join("\n");
  const target = rec.spec.target;
  const h = await headers();
  const site = process.env.NEXT_PUBLIC_SITE_URL || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const url = responseUrl(site, rec.spec.slug);
  const qr = rec.state === "open" ? await qrDataUrl(url) : null;

  return (
    <>
      <PageHeader
        title={rec.spec.title}
        description={`${rec.spec.category} · ${rec.spec.program} · 마감 ${rec.spec.deadline}`}
        actions={
          <>
            <StateChip state={rec.state} />
            <Link href="/survey/list" className={buttonCls.ghost}>
              목록으로
            </Link>
          </>
        }
      />

      {qr && (
        <div className="mb-5">
          <ShareCard url={url} qr={qr} slug={rec.spec.slug} justPublished={published === "1"} />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard tone="lav" label="응답 수" value={String(agg.n)} unit="명" />
        <StatCard tone="blue" label="응답률" value={target ? String(pct(agg.n, target)) : "-"} unit={target ? "%" : undefined} note={target ? `대상 ${target}명` : "대상 인원 미입력"} />
        <StatCard
          tone="mint"
          label="대표 만족도 평균"
          value={kpi && kpi.valid ? String(kpi.mean) : "-"}
          unit={kpi && kpi.valid ? "/ 5점" : undefined}
          note={kpi && kpi.valid ? `긍정(4~5점) ${kpi.posPct}%` : "응답 없음"}
        />
      </div>

      <div className="mt-5">
        <ResponseProgress n={agg.n} target={target} timeline={responseTimeline(submittedAt)} state={rec.state} daysLeft={daysLeft(rec.spec.deadline, new Date())} />
      </div>

      <div className="mt-5 space-y-4">
        {agg.questions.map((q, i) => (
          <QuestionResult key={q.id} q={q} no={i + 1} isKpi={q.id === rec.spec.kpiQuestionId} />
        ))}
      </div>

      <div className="mt-5">
        <EvaluationPanel spec={{ program: rec.spec.program, target: rec.spec.target, kpiQuestionId: rec.spec.kpiQuestionId, questions: rec.spec.questions }} agg={agg} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Card title="문항별 수치 요약" action={<CopyButton text={report} label="수치 요약 복사" />}>
          <pre className="whitespace-pre-wrap break-words font-sans text-[14px] leading-relaxed">{report}</pre>
          <p className="mt-3 text-[12px] text-muted-text">수치만 정리한 초안임. 서술 의견 원문은 들어가지 않음. 보고서에 옮긴 뒤 담당자가 검토할 것.</p>
        </Card>
        <Card title="원자료">
          <p className="text-[14px]">응답 원자료를 CSV(엑셀)로 내려받음. 담당자만 가능함.</p>
          <a href={`/survey/${rec.id}/results/csv`} className={`${buttonCls.primary} mt-3`} download>
            CSV 내려받기
          </a>
          <p className="mt-3 text-[12px] text-muted-text">서술 의견이 들어 있으므로 기관 안에서만 보관하고 외부로 보내지 말 것.</p>
        </Card>
      </div>
    </>
  );
}

function QuestionResult({ q, no, isKpi }: { q: QuestionAgg; no: number; isKpi: boolean }) {
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-[16px] font-bold">
          <span className="mr-1 text-muted-text">{no}.</span>
          {q.text}
          {isKpi && <span className="ml-2 rounded-full bg-lime px-2 py-0.5 align-middle text-[11px] font-bold">★ 대표 만족도</span>}
        </h3>
        <span className="text-[12px] text-muted-text">응답 {q.answered}명</span>
      </div>

      {(q.type === "single" || q.type === "multi") && (
        <>
          <ul className="space-y-2">
            {q.options.map((o) => (
              <li key={o.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-[14px] sm:grid-cols-[minmax(0,14rem)_1fr_auto]">
                <span className="truncate" title={o.label}>
                  {o.label}
                </span>
                <span className="col-span-2 h-3 overflow-hidden rounded-full bg-bg sm:col-span-1 sm:row-start-1 sm:col-start-2" aria-hidden="true">
                  <span className="block h-full rounded-full bg-teal" style={{ width: `${o.pct}%` }} />
                </span>
                <span className="row-start-1 col-start-2 text-right tabular-nums sm:col-start-3">
                  {o.count}명 ({o.pct}%)
                </span>
              </li>
            ))}
          </ul>
          {q.type === "multi" && <p className="mt-2 text-[12px] text-muted-text">복수 응답이라 비율 합이 100%를 넘을 수 있음.</p>}
          {q.otherTexts.length > 0 && (
            <details className="mt-3 text-[14px]">
              <summary className="cursor-pointer font-semibold">직접 입력 내용 {q.otherTexts.length}건</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {q.otherTexts.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {q.type === "scale5" && (
        <>
          <p className="mb-2 text-[14px]">
            평균 <strong className="text-[18px] tabular-nums">{q.valid ? q.mean : "-"}</strong>점 · 긍정(4~5점) {q.posPct}% ({q.pos}/{q.valid}명) · ‘{q.high}’ {q.topPct}%
          </p>
          <DistBar dist={q.dist} label={q.text} />
          <p className="mt-1 text-[12px] text-muted-text">
            1 = {q.low} · 5 = {q.high}
          </p>
        </>
      )}

      {q.type === "scale10" && (
        <>
          <p className="mb-2 text-[14px]">
            평균 <strong className="text-[18px] tabular-nums">{q.valid ? q.mean : "-"}</strong>점(10점 만점) · 9~10점 {q.topPct}% ({q.top}/{q.valid}명)
          </p>
          <ol className="flex h-24 items-end gap-1" aria-label={`${q.text}: ${q.dist.map((c, i) => `${i + 1}점 ${c}명`).join(", ")}`}>
            {q.dist.map((c, i) => {
              const max = Math.max(1, ...q.dist);
              return (
                <li key={i} className="flex h-full flex-1 flex-col items-center justify-end">
                  <span className="text-[10px] tabular-nums text-muted-text">{c || ""}</span>
                  <span className="w-full rounded-t-[4px] bg-t-scale10" style={{ height: `${(c / max) * 100}%`, minHeight: c ? 3 : 0 }} />
                  <span className="mt-1 text-[11px] text-muted-text">{i + 1}</span>
                </li>
              );
            })}
          </ol>
          <p className="mt-1 text-[12px] text-muted-text">
            1 = {q.low} · 10 = {q.high}
          </p>
        </>
      )}

      {q.type === "text" &&
        (q.texts.length === 0 ? (
          <p className="text-[14px] text-muted-text">의견 없음</p>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {q.texts.map((t, i) => (
              <li key={i} className="whitespace-pre-wrap break-words rounded-[10px] bg-bg px-3 py-2 text-[14px]">
                {t}
              </li>
            ))}
          </ul>
        ))}
    </Card>
  );
}
