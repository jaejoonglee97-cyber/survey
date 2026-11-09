"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  answeredCount,
  collectAnswers,
  emptyQuestionState,
  initialFormState,
  isOptionDisabled,
  problemMessage,
  toggleOption,
  type FormState,
  type QuestionState,
} from "@/lib/respond/form-state";
import type { PublicSurvey, Question } from "@/lib/survey-core";
import { StateView } from "./StateView";

// 응답 폼. 모든 문구는 텍스트로만 렌더링함(HTML 해석 없음).

type Phase = { kind: "form" } | { kind: "sending" } | { kind: "done" } | { kind: "closed" };

const doneKey = (slug: string) => `survey_done_${slug}`;

export function SurveyForm({ slug, survey }: { slug: string; survey: PublicSurvey }) {
  const [state, setState] = useState<FormState>(() => initialFormState(survey.questions));
  const [errors, setErrors] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [doneBefore, setDoneBefore] = useState(false);
  const msgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setDoneBefore(!!localStorage.getItem(doneKey(slug)));
    } catch {
      /* 저장소를 못 쓰는 브라우저는 안내 생략 */
    }
  }, [slug]);

  const total = survey.questions.length;
  const answered = useMemo(() => answeredCount(survey.questions, state), [survey.questions, state]);

  const update = (id: string, fn: (s: QuestionState) => QuestionState) => {
    setState((prev) => ({ ...prev, [id]: fn(prev[id] ?? emptyQuestionState()) }));
    if (errors.has(id)) {
      setErrors((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  async function submit() {
    const { answers, problems } = collectAnswers(survey.questions, state);
    if (problems.length) {
      setErrors(new Set(problems.map((p) => p.questionId)));
      setMessage(problemMessage(problems));
      const first = document.getElementById(`q-${problems[0].questionId}`);
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      first?.querySelector<HTMLElement>("input, textarea")?.focus({ preventScroll: true });
      return;
    }
    setErrors(new Set());
    setMessage("");
    setPhase({ kind: "sending" });
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; closed?: boolean; message?: string; questionId?: string };
      if (res.ok && body.ok) {
        try {
          localStorage.setItem(doneKey(slug), "1");
        } catch {
          /* 무시 */
        }
        setPhase({ kind: "done" });
        window.scrollTo(0, 0);
        return;
      }
      if (body.closed) {
        setPhase({ kind: "closed" });
        return;
      }
      if (body.questionId) setErrors(new Set([body.questionId]));
      setMessage(body.message || "제출하지 못했습니다. 다시 시도해 주십시오.");
    } catch {
      setMessage("제출하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주십시오. 입력한 내용은 유지됩니다.");
    }
    setPhase({ kind: "form" });
    msgRef.current?.focus();
  }

  if (phase.kind === "done") return <StateView title="응답해 주셔서 감사합니다" lines={["제출이 완료되었습니다. 이 화면을 닫으셔도 됩니다."]} />;
  if (phase.kind === "closed") return <StateView title="마감된 설문입니다" lines={["제출 직전에 마감되었습니다."]} />;

  const pct = total ? Math.round((answered / total) * 100) : 0;
  let lastSection: string | undefined;

  return (
    <>
      <div className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[640px] items-center gap-3 px-4 py-2">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-line"
            role="progressbar"
            aria-label="응답 진행률"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={answered}
          >
            <div className="h-full rounded-full bg-teal transition-[width] motion-reduce:transition-none" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs tabular-nums text-muted-text">
            {answered} / {total}
          </span>
        </div>
      </div>

      <main className="mx-auto max-w-[640px] px-4 pb-16 pt-6">
        <header className="mb-6">
          <h1 className="text-2xl font-bold leading-snug">{survey.title}</h1>
          <p className="mt-2 text-[13px] text-muted-text">
            마감 {survey.deadline} · 문항 {total}개 · 무기명
          </p>
          {survey.intro && (
            <div className="mt-4 whitespace-pre-line rounded-2xl border border-line bg-surface p-4 text-[15px] leading-relaxed">{survey.intro}</div>
          )}
          {doneBefore && (
            <p className="mt-3 rounded-xl bg-lime-soft px-4 py-3 text-sm">이 기기에서 이미 제출한 기록이 있습니다. 이미 응답하셨다면 이 화면을 닫아 주십시오.</p>
          )}
        </header>

        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (phase.kind === "form") void submit();
          }}
        >
          {survey.questions.map((q, i) => {
            const showSection = q.section && q.section !== lastSection;
            lastSection = q.section ?? lastSection;
            return (
              <div key={q.id}>
                {showSection && <h2 className="mb-3 mt-8 text-[13px] font-semibold tracking-wide text-teal-deep">{q.section}</h2>}
                <QuestionField
                  q={q}
                  no={i + 1}
                  s={state[q.id] ?? emptyQuestionState()}
                  invalid={errors.has(q.id)}
                  onChange={(fn) => update(q.id, fn)}
                />
              </div>
            );
          })}

          <div ref={msgRef} tabIndex={-1} role="alert" className={message ? "mt-6 rounded-xl border border-scale-1 bg-[#fdf0eb] px-4 py-3 text-sm font-medium" : "sr-only"}>
            {message}
          </div>

          <button
            type="submit"
            disabled={phase.kind === "sending"}
            className="mt-6 h-14 w-full rounded-[12px] bg-ink text-base font-bold text-white disabled:opacity-60"
          >
            {phase.kind === "sending" ? "제출 중입니다" : "제출하기"}
          </button>
        </form>

        <p className="mt-8 text-[12px] leading-relaxed text-muted-text">
          이 설문은 무기명으로 진행되며 이름·연락처·IP 주소 등 개인을 알 수 있는 정보를 수집하지 않습니다. 응답은 사업 개선과 결과 보고에만 쓰이며, 결과는 통계로만
          공개됩니다. 서술 문항에는 개인을 알 수 있는 내용을 적지 말아 주십시오. 서울특별시사회복지사협회
        </p>
      </main>
    </>
  );
}

function QuestionField({
  q,
  no,
  s,
  invalid,
  onChange,
}: {
  q: Question;
  no: number;
  s: QuestionState;
  invalid: boolean;
  onChange: (fn: (s: QuestionState) => QuestionState) => void;
}) {
  const hintId = `q-${q.id}-hint`;
  const hints: string[] = [];
  if (q.note) hints.push(q.note);
  if (q.type === "multi" && !q.note) hints.push(q.max ? `최대 ${q.max}개까지 선택할 수 있습니다.` : "해당하는 것을 모두 선택해 주십시오.");

  return (
    <fieldset
      id={`q-${q.id}`}
      aria-invalid={invalid || undefined}
      aria-describedby={hints.length ? hintId : undefined}
      className={`mb-4 rounded-[20px] border p-5 ${invalid ? "border-scale-1 bg-[#fdf0eb]" : "border-line bg-surface"}`}
    >
      <legend className="float-left w-full text-[16px] font-semibold leading-snug">
        <span className="mr-1 text-muted-text">{no}.</span>
        {q.text}
        {q.required && <span className="ml-2 inline-block rounded-full bg-lime px-2 py-0.5 align-middle text-[11px] font-bold">필수</span>}
      </legend>
      <div className="clear-both" />
      {hints.length > 0 && (
        <p id={hintId} className="mt-1 text-[13px] text-muted-text">
          {hints.join(" ")}
        </p>
      )}
      {invalid && <p className="mt-1 text-[13px] font-medium text-[#a8432a]">이 문항을 확인해 주십시오.</p>}

      <div className="mt-3">
        {(q.type === "single" || q.type === "multi") &&
          (q.options ?? []).map((o, idx) => {
            const checked = s.selected.includes(idx);
            const disabled = isOptionDisabled(q, s, idx);
            const inputId = `q-${q.id}-o${idx}`;
            return (
              <div key={idx} className="mb-2">
                <label
                  htmlFor={inputId}
                  className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-[12px] border-2 px-4 py-2 text-[15px] has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-teal ${
                    checked ? "border-ink bg-lime-soft" : "border-line bg-surface"
                  } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                >
                  <input
                    id={inputId}
                    type={q.type === "single" ? "radio" : "checkbox"}
                    name={q.id}
                    checked={checked}
                    disabled={disabled}
                    onChange={() => onChange((prev) => toggleOption(q, prev, idx))}
                    className="size-5 shrink-0 accent-ink"
                  />
                  <span>{o.other ? `${o.label} (직접 입력)` : o.label}</span>
                </label>
                {o.other && checked && (
                  <input
                    type="text"
                    maxLength={200}
                    placeholder="직접 입력"
                    aria-label={`${o.label} 내용`}
                    value={s.other[idx] ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      onChange((prev) => ({ ...prev, other: { ...prev.other, [idx]: v } }));
                    }}
                    className="mt-2 h-12 w-full rounded-[10px] border border-line bg-surface px-4 text-[15px] focus-visible:outline-3 focus-visible:outline-teal"
                  />
                )}
              </div>
            );
          })}

        {q.type === "scale5" && (
          <>
            <div className="grid grid-cols-5 gap-2">
              {[1, 2, 3, 4, 5].map((v) => {
                const checked = s.scale === v;
                const label = v === 1 ? `1점 ${q.low ?? ""}` : v === 5 ? `5점 ${q.high ?? ""}` : `${v}점`;
                return (
                  <label
                    key={v}
                    className={`flex h-12 cursor-pointer items-center justify-center rounded-[12px] border-2 text-base font-bold has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-teal ${
                      checked ? "border-ink bg-lime-soft" : "border-line bg-surface"
                    }`}
                  >
                    <input
                      type="radio"
                      name={q.id}
                      value={v}
                      checked={checked}
                      aria-label={label.trim()}
                      onChange={() => onChange((prev) => ({ ...prev, scale: v }))}
                      className="sr-only"
                    />
                    {v}
                  </label>
                );
              })}
            </div>
            <div className="mt-2 flex justify-between gap-4 text-[12px] text-muted-text" aria-hidden="true">
              <span>1 {q.low}</span>
              <span className="text-right">5 {q.high}</span>
            </div>
          </>
        )}

        {q.type === "text" && (
          <>
            <textarea
              maxLength={1000}
              rows={4}
              aria-label={q.text}
              value={s.text}
              onChange={(e) => {
                const v = e.target.value;
                onChange((prev) => ({ ...prev, text: v }));
              }}
              className="w-full rounded-[12px] border border-line bg-surface p-3 text-[15px] leading-relaxed focus-visible:outline-3 focus-visible:outline-teal"
            />
            <p className="mt-1 text-right text-[12px] tabular-nums text-muted-text">{s.text.length} / 1000</p>
          </>
        )}
      </div>
    </fieldset>
  );
}
