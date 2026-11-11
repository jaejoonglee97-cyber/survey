"use client";

import { useMemo, useState } from "react";
import { buildEvaluationLines, type Aggregate, type SurveySpec } from "@/lib/survey-core";
import { CopyButton } from "./CopyButton";

const MAX_QUOTES = 3;

// 결과보고서 「평가 → 만족도 평가」 문안. 한글 문서의 해당 칸에 그대로 붙여 넣는 용도
export function EvaluationPanel({ spec, agg }: { spec: Pick<SurveySpec, "program" | "target" | "kpiQuestionId" | "questions">; agg: Aggregate }) {
  const [no, setNo] = useState("4");
  const [hints, setHints] = useState(true);
  const [quotes, setQuotes] = useState<string[]>([]);
  // 같은 내용의 의견은 한 줄로 묶음(건수 표시)
  const opinions = useMemo(() => {
    const m = new Map<string, number>();
    for (const q of agg.questions) if (q.type === "text") for (const t of q.texts) m.set(t.trim(), (m.get(t.trim()) ?? 0) + 1);
    return [...m.entries()].filter(([t]) => t).map(([t, count]) => ({ t, count }));
  }, [agg]);
  const text = useMemo(() => buildEvaluationLines(spec, agg, { headingNo: no, hints, quotes }).join("\n"), [spec, agg, no, hints, quotes]);

  return (
    <section className="rounded-[18px] border-2 border-ink bg-surface p-5" aria-labelledby="eval-h">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="eval-h" className="text-[17px] font-bold">
          결과보고서 「평가」용 만족도 문안
        </h2>
        <CopyButton text={text} label="문안 복사" />
      </div>
      <p className="mt-1 text-[13px] text-muted-text">
        결과보고서 「Ⅴ. 평가」의 만족도 평가 칸에 붙여 넣는 문안임. 수치 문장은 자동으로 만들고, [해석 보완] 자리에 담당자가 해석을 채움.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-4 text-[13px]">
        <label className="flex items-center gap-2 font-semibold">
          소제목 번호
          <input
            value={no}
            onChange={(e) => setNo(e.target.value.replace(/[^0-9.가-힣]/g, "").slice(0, 4))}
            className="h-9 w-16 rounded-[10px] border border-line-strong bg-field px-2 text-center"
          />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={hints} onChange={(e) => setHints(e.target.checked)} className="size-4 accent-ink" />
          [해석 보완] 자리 표시 넣기
        </label>
      </div>

      <pre className="mt-4 max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-[12px] bg-bg p-4 font-sans text-[14px] leading-relaxed">{text}</pre>

      {opinions.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-[14px] font-semibold">
            인용할 서술 의견 고르기 ({quotes.length}/{MAX_QUOTES})
          </summary>
          <p className="mt-2 rounded-[10px] bg-lime-soft px-3 py-2 text-[12px]">
            이름·소속·연락처 등 개인을 알 수 있는 내용이 들어 있는 의견은 고르지 말 것. 고른 의견만 문안에 따옴표로 들어감.
          </p>
          <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto">
            {opinions.map((o, i) => {
              const on = quotes.includes(o.t);
              const full = !on && quotes.length >= MAX_QUOTES;
              return (
                <li key={i}>
                  <label className={`flex items-start gap-2 rounded-[10px] px-3 py-2 text-[14px] ${on ? "bg-lime-soft" : "hover:bg-bg"} ${full ? "opacity-50" : "cursor-pointer"}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={full}
                      onChange={(e) => setQuotes((p) => (e.target.checked ? [...p, o.t] : p.filter((x) => x !== o.t)))}
                      className="mt-1 size-4 shrink-0 accent-ink"
                    />
                    <span className="whitespace-pre-wrap break-words">
                      {o.t}
                      {o.count > 1 && <span className="ml-1 text-[12px] text-muted-text">({o.count}건)</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}
