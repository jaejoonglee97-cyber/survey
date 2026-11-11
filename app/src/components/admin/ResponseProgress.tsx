import type { Timeline } from "@/lib/admin/timeline";
import { Card } from "./ui";

// 결과 화면의 응답 현황: 대상 인원 대비 진행률 + 시간대·날짜별 응답 수 막대
export function ResponseProgress({
  n,
  target,
  timeline,
  state,
  daysLeft,
}: {
  n: number;
  target?: number;
  timeline: Timeline;
  state: "open" | "closed" | "draft";
  daysLeft: number | null;
}) {
  const pct = target ? Math.min(100, Math.round((n / target) * 100)) : null;
  const max = Math.max(1, ...timeline.bars.map((b) => b.count));
  return (
    <Card title="응답 현황">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-[14px]">
          <strong className="text-[22px] tabular-nums">{n}</strong>명 응답
          {target ? (
            <span className="text-muted-text">
              {" "}
              / 대상 {target}명 ({pct}%)
            </span>
          ) : null}
        </p>
        {state === "open" && daysLeft !== null && (
          <span className="rounded-full bg-lime-soft px-3 py-1 text-[13px] font-bold">{daysLeft === 0 ? "오늘 마감" : `마감까지 ${daysLeft}일`}</span>
        )}
        {state === "closed" && <span className="rounded-full bg-line px-3 py-1 text-[13px] font-bold">마감</span>}
      </div>
      {pct !== null && (
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-bg" role="progressbar" aria-label="대상 인원 대비 응답률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="h-full rounded-full bg-teal" style={{ width: `${pct}%` }} />
        </div>
      )}

      {timeline.bars.length > 0 ? (
        <>
          <p className="mt-5 text-[13px] font-semibold">{timeline.unit === "hour" ? "시간대별 응답" : "날짜별 응답"}</p>
          <div className="mt-2 overflow-x-auto">
            <ol
              className="flex h-32 min-w-full items-end gap-1"
              style={{ width: `max(100%, ${timeline.bars.length * 28}px)` }}
              aria-label={`${timeline.unit === "hour" ? "시간대별" : "날짜별"} 응답 수`}
            >
              {timeline.bars.map((b) => (
                <li key={b.key} className="flex h-full min-w-6 flex-1 flex-col items-center justify-end" title={`${b.label} ${b.count}명`}>
                  <span className="text-[10px] tabular-nums text-muted-text">{b.count || ""}</span>
                  <span
                    className={`w-full rounded-t-[4px] ${b === timeline.peak && b.count ? "bg-teal-deep" : "bg-teal"}`}
                    style={{ height: `${(b.count / max) * 100}%`, minHeight: b.count ? 3 : 0 }}
                  />
                  <span className="sr-only">
                    {b.label} {b.count}명
                  </span>
                </li>
              ))}
            </ol>
            <ol className="mt-1 flex min-w-full gap-1" style={{ width: `max(100%, ${timeline.bars.length * 28}px)` }} aria-hidden="true">
              {timeline.bars.map((b, i) => (
                <li key={b.key} className="min-w-6 flex-1 text-center text-[10px] text-muted-text">
                  {timeline.bars.length <= 14 || i % Math.ceil(timeline.bars.length / 14) === 0 ? b.label : ""}
                </li>
              ))}
            </ol>
          </div>
          {timeline.peak && timeline.peak.count > 0 && (
            <p className="mt-2 text-[12px] text-muted-text">
              응답이 가장 많았던 때: {timeline.peak.label} ({timeline.peak.count}명). 제출 시각은 무기명 보호를 위해 시 단위로만 기록함.
            </p>
          )}
        </>
      ) : (
        <p className="mt-4 text-[14px] text-muted-text">아직 응답이 없음.</p>
      )}
    </Card>
  );
}
