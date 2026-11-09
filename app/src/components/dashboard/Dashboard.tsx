"use client";

import { useMemo, useState } from "react";
import { buildView, filterOptions, fmt1, meanOf, posOf, rulerPct, sum, trendPath, type Filter, type Trend } from "@/lib/dashboard/calc";
import type { DashboardRow } from "@/lib/survey-core";

// 만족도 대시보드 화면. 받는 데이터는 대표 문항 분포뿐임(서술 의견·개별 응답 없음).

const SCALE = ["var(--scale-1)", "var(--scale-2)", "var(--scale-3)", "var(--scale-4)", "var(--scale-5)"];
const BAND = `linear-gradient(90deg, ${SCALE.map((c, i) => `${c} ${i * 20}% ${(i + 1) * 20}%`).join(", ")})`;

export function Dashboard({ rows, minN, generatedAt }: { rows: DashboardRow[]; minN: number; generatedAt: string }) {
  const { years, categories } = useMemo(() => filterOptions(rows), [rows]);
  const [f, setF] = useState<Filter>({ year: "all", category: "all" });
  const v = useMemo(() => buildView(rows, f), [rows, f]);

  if (!rows.length) {
    return <Empty>등록된 설문이 없음. 설문이 게시되고 응답이 모이면 여기에 표시됨.</Empty>;
  }

  return (
    <div className="space-y-5">
      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="year" className="text-[13px] font-semibold">
          연도
        </label>
        <select
          id="year"
          value={String(f.year)}
          onChange={(e) => setF((p) => ({ ...p, year: e.target.value === "all" ? "all" : Number(e.target.value) }))}
          className="h-10 rounded-[10px] border border-line bg-surface px-3 text-[14px]"
        >
          <option value="all">전체</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}년
            </option>
          ))}
        </select>
        <div role="group" aria-label="분류" className="flex flex-wrap gap-2">
          {["all", ...categories].map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={f.category === c}
              onClick={() => setF((p) => ({ ...p, category: c }))}
              className={`h-9 rounded-full border px-4 text-[13px] font-semibold focus-visible:outline-3 focus-visible:outline-teal ${
                f.category === c ? "border-ink bg-lime" : "border-line bg-surface"
              }`}
            >
              {c === "all" ? "전체 분류" : c}
            </button>
          ))}
        </div>
      </div>

      {v.inYear.length === 0 ? (
        <Empty>선택한 조건에 해당하는 설문이 없음.</Empty>
      ) : (
        <>
          {/* 요약 */}
          <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="조사" value={String(v.summary.surveys)} unit="건" tone="bg-lav" />
            <Stat label="응답" value={v.summary.responses.toLocaleString("ko-KR")} unit="명" tone="bg-blue" />
            <Stat label="평균 만족도" value={v.summary.mean === null ? "-" : fmt1(v.summary.mean)} unit={v.summary.mean === null ? "" : "/ 5점"} tone="bg-mint" />
            <Stat label="긍정 응답(4~5점)" value={v.summary.positive === null ? "-" : `${Math.round(v.summary.positive)}%`} tone="bg-surface border border-line" />
          </dl>

          {/* 만족도 눈금 */}
          <Section title="만족도 눈금" lead="색 띠는 1점(낮음)부터 5점(높음)까지의 눈금이고, 표지가 평균 위치임. 모든 비교가 같은 눈금을 씀.">
            {v.overall ? (
              <div className="space-y-5">
                <div>
                  <p className="mb-2 text-[14px] font-bold">{v.overall.label}</p>
                  <Ruler mean={v.overall.mean} hero />
                </div>
                {v.categories.map((c) => (
                  <div key={c.category} className="grid items-center gap-x-6 gap-y-1 border-t border-line pt-4 md:grid-cols-[8rem_1fr_14rem]">
                    <p className="text-[14px] font-semibold">{c.category}</p>
                    <Ruler mean={c.mean} />
                    <p className="text-[12px] text-muted-text md:text-right">
                      {c.surveys}건 · 응답 {c.responses}명 · 긍정 {Math.round(c.positive)}%
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>수치를 표시할 수 있는 설문이 없음. 대표 만족도 문항에 응답이 {minN}건 이상 모이면 표시됨.</Empty>
            )}
          </Section>

          {/* 사업·행사별 */}
          <Section title="사업·행사별 만족도" lead="최근 마감 순. 막대는 1점부터 5점까지의 응답 비율임.">
            <div className="divide-y divide-line">
              {v.inYear.map((r) => (
                <SurveyRow key={r.slug} r={r} minN={minN} />
              ))}
            </div>
          </Section>

          {/* 연도별 추이 */}
          {v.trends.length > 0 && (
            <Section title="연도별 추이" lead="같은 사업이 여러 해에 걸쳐 조사된 경우의 평균 변화임(연도 선택과 관계없이 모든 해를 보여 줌).">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {v.trends.map((t) => (
                  <TrendCard key={t.program} t={t} />
                ))}
              </div>
            </Section>
          )}
        </>
      )}

      <p className="text-[12px] text-muted-text">
        집계 시각 {generatedAt} · 긍정 응답은 4~5점 응답 비율임 · 대표 문항 응답이 {minN}건 미만인 설문은 수치를 보내지 않음 · 서술 의견과 개별 응답은 이 화면에 표시하지 않음 ·
        결과는 최대 1분 늦을 수 있음(새로고침으로 갱신)
      </p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-[18px] border border-dashed border-line bg-surface p-6 text-center text-[14px] text-muted-text">{children}</p>;
}

function Stat({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone: string }) {
  return (
    <div className={`rounded-[18px] p-5 ${tone}`}>
      <dt className="text-[13px] font-bold">{label}</dt>
      <dd className="mt-2">
        <span className="text-[32px] font-bold leading-none tabular-nums">{value}</span>
        {unit && <span className="ml-1 text-[13px] font-semibold">{unit}</span>}
      </dd>
    </div>
  );
}

function Section({ title, lead, children }: { title: string; lead: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[18px] border border-line bg-surface p-5 lg:p-6">
      <h2 className="text-[17px] font-bold">{title}</h2>
      <p className="mb-5 mt-1 text-[13px] text-muted-text">{lead}</p>
      {children}
    </section>
  );
}

/** 1~5점 눈금자 + 평균 표지 */
export function Ruler({ mean, hero = false }: { mean: number; hero?: boolean }) {
  const p = rulerPct(mean);
  const align = p < 8 ? "translate-x-0" : p > 92 ? "-translate-x-full" : "-translate-x-1/2";
  return (
    <div role="img" aria-label={`평균 ${fmt1(mean)}점(5점 만점)`} className={hero ? "pt-9" : "pt-7"}>
      <div className="relative">
        <div className={`${hero ? "h-4" : "h-2.5"} rounded-full`} style={{ background: BAND }} />
        <div className="absolute top-1/2" style={{ left: `${p}%` }}>
          <span className={`absolute bottom-full mb-2 ${align} whitespace-nowrap rounded-[8px] bg-ink px-2 py-0.5 font-bold tabular-nums text-white ${hero ? "text-[15px]" : "text-[12px]"}`}>
            {fmt1(mean)}
          </span>
          <span className={`block -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-ink bg-white ${hero ? "size-6" : "size-4"}`} />
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-text" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n}>{n}</span>
        ))}
      </div>
    </div>
  );
}

function Stack({ dist }: { dist: readonly number[] }) {
  const n = sum(dist);
  return (
    <div className="mt-3 flex h-6 overflow-hidden rounded-[8px]" role="img" aria-label={`점수 분포 ${dist.map((v, i) => `${i + 1}점 ${v}명`).join(", ")}`}>
      {dist.map((v, i) => {
        if (!v) return null;
        const p = (v / n) * 100;
        return (
          <span
            key={i}
            title={`${i + 1}점 ${v}명 (${fmt1(p)}%)`}
            className={`flex items-center justify-center text-[11px] font-bold ${i === 4 ? "text-white" : ""}`}
            style={{ width: `${p}%`, background: SCALE[i] }}
          >
            {p >= 9 ? `${Math.round(p)}%` : ""}
          </span>
        );
      })}
    </div>
  );
}

function SurveyRow({ r, minN }: { r: DashboardRow; minN: number }) {
  const rate = r.target ? ` · 응답률 ${fmt1((r.n / r.target) * 100)}%` : "";
  return (
    <article className="grid gap-x-8 gap-y-2 py-5 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,18rem)_1fr]">
      <div className="min-w-0">
        <h3 className="text-[15px] font-bold">{r.title}</h3>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted-text">
          {r.category} · {r.year}년
          <span className={`rounded-full px-2 py-0.5 font-semibold text-ink ${r.state === "open" ? "bg-lime-soft" : "bg-line"}`}>
            {r.state === "open" ? "진행 중(중간 집계)" : "마감"}
          </span>
        </p>
      </div>
      {r.shown && r.dist ? (
        <div>
          <Ruler mean={meanOf(r.dist)!} />
          <Stack dist={r.dist} />
          <div className="mt-1 flex justify-between text-[11px] text-muted-text" aria-hidden="true">
            <span>1점</span>
            <span>5점</span>
          </div>
          <p className="mt-1 text-[13px]">
            응답 {r.n}명{rate} · 긍정 응답 {Math.round(posOf(r.dist)!)}%
          </p>
        </div>
      ) : (
        <p className="self-center rounded-[10px] bg-bg px-4 py-3 text-[13px] text-muted-text">
          {!r.hasKpi
            ? `대표 만족도 문항이 지정되지 않은 설문이라 비교에서 제외됨. (응답 ${r.n}명)`
            : `대표 문항 응답이 ${r.valid}건으로 ${minN}건 미만이라 수치를 표시하지 않음. (응답 ${r.n}명${rate})`}
        </p>
      )}
    </article>
  );
}

function TrendCard({ t }: { t: Trend }) {
  const pts = trendPath(t.points);
  const up = t.delta >= 0.05;
  const down = t.delta <= -0.05;
  return (
    <div className="rounded-[14px] border border-line p-4">
      <h3 className="text-[15px] font-bold">{t.program}</h3>
      <p className={`mt-1 text-[13px] font-semibold ${down ? "text-[#8a3520]" : up ? "text-teal-deep" : "text-muted-text"}`}>{t.deltaText}</p>
      <svg viewBox="0 0 260 96" className="mt-2 w-full" role="img" aria-label={t.points.map((p) => `${p.year}년 ${fmt1(p.mean)}점`).join(", ")}>
        <polyline points={pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} fill="none" stroke="var(--teal)" strokeWidth="2.5" strokeLinejoin="round" />
        {t.points.map((p, i) => (
          <g key={p.year}>
            <circle cx={pts[i].x} cy={pts[i].y} r="4.5" fill={i === pts.length - 1 ? "var(--teal)" : "#fff"} stroke="var(--teal)" strokeWidth="2" />
            <text x={pts[i].x} y={pts[i].y - 10} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--ink)">
              {fmt1(p.mean)}
            </text>
            <text x={pts[i].x} y={90} textAnchor="middle" fontSize="11" fill="var(--muted-text)">
              {p.year}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
