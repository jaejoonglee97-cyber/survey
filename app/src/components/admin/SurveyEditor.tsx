"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { publishAction, saveDraftAction } from "@/app/survey/actions";
import * as ops from "@/lib/admin/editor-ops";
import {
  applyAutoFixes,
  exportMd,
  importMd,
  validateDraft,
  type Issue,
  type Question,
  type QuestionType,
  type SurveySpec,
} from "@/lib/survey-core";
import { buttonCls } from "./ui";

// 문항 편집기(AI 설계 대신). 점검은 서버와 같은 규칙(survey-core)을 화면에서도 바로 보여 주고,
// 저장·게시 때 서버가 다시 확인함.

export interface PreviousSurvey {
  id: string;
  title: string;
  program: string;
  year: number;
  intro: string;
  questions: Question[];
  kpiQuestionId: string | null;
}

const TYPE_LABEL: Record<QuestionType, string> = { single: "단일 선택", multi: "복수 선택", scale5: "5점 척도", text: "서술" };
const CATEGORIES = ["교육", "행사", "사업", "기타"];
const fieldCls = "h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-[15px] focus-visible:outline-3 focus-visible:outline-teal";
const labelCls = "block text-[13px] font-semibold";

export function SurveyEditor({ id: initialId, initial, previous }: { id: string | null; initial: SurveySpec; previous: PreviousSurvey[] }) {
  const [id, setId] = useState(initialId);
  const idRef = useRef(initialId);
  const [spec, setSpec] = useState<SurveySpec>(initial);
  const [savedJson, setSavedJson] = useState(initialId ? JSON.stringify(ops.tidy(initial)) : "");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [mdOpen, setMdOpen] = useState(false);
  const [mdText, setMdText] = useState("");
  const [mdResult, setMdResult] = useState<{ errors: string[]; warnings: string[] } | null>(null);
  const [pending, start] = useTransition();
  const publishRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  const tidy = useMemo(() => ops.tidy(spec), [spec]);
  const prev = useMemo(
    () => previous.filter((p) => p.program && p.program === tidy.program).sort((a, b) => b.year - a.year)[0],
    [previous, tidy.program],
  );
  const report = useMemo(() => validateDraft(applyAutoFixes(tidy), prev ? { previous: prev } : {}), [tidy, prev]);
  const dirty = JSON.stringify(tidy) !== savedJson;
  const byQuestion = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const i of report.issues) if (i.questionId) m.set(i.questionId, [...(m.get(i.questionId) ?? []), i]);
    return m;
  }, [report]);
  const generalIssues = report.issues.filter((i) => !i.questionId);
  const programs = useMemo(() => [...new Set(previous.map((p) => p.program))].sort(), [previous]);

  const set = (fn: (s: SurveySpec) => SurveySpec) => {
    setSpec(fn);
    setMsg(null);
  };

  function save(after?: (newId: string) => void) {
    start(async () => {
      const r = await saveDraftAction(idRef.current, tidy);
      if (!r.ok) {
        setMsg({ kind: "err", text: r.error });
        return;
      }
      setSavedJson(JSON.stringify(tidy));
      setMsg({ kind: "ok", text: "초안을 저장함" });
      if (!idRef.current) {
        idRef.current = r.value.id;
        setId(r.value.id);
        window.history.replaceState(null, "", `/survey/${r.value.id}/edit`);
      }
      after?.(r.value.id);
    });
  }

  function publish() {
    const current = idRef.current;
    if (!current) return;
    start(async () => {
      const r = await publishAction(current);
      publishRef.current?.close();
      if (!r.ok) {
        setMsg({ kind: "err", text: r.error });
        return;
      }
      router.push(`/survey/${current}/results?published=1`);
    });
  }

  function applyMd() {
    const r = importMd(mdText);
    setMdResult({ errors: r.errors, warnings: r.warnings });
    if (!r.ok) return;
    set(() => r.spec);
    setMdOpen(false);
    setMsg({ kind: "ok", text: `md 파일에서 문항 ${r.spec.questions.length}개를 불러옴. 저장해야 반영됨.` });
  }

  const minutes = Math.max(1, Math.round(report.estimatedSeconds / 60));

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        {/* 기본 정보 */}
        <section className="rounded-[18px] border border-line bg-surface p-5" aria-labelledby="basics-h">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 id="basics-h" className="text-[17px] font-bold">
              기본 정보
            </h2>
            <button type="button" className={buttonCls.ghost} onClick={() => setMdOpen((v) => !v)} aria-expanded={mdOpen}>
              md 파일 불러오기
            </button>
          </div>

          {mdOpen && (
            <div className="mb-5 rounded-[12px] border border-dashed border-line p-4">
              <label htmlFor="md-file" className={labelCls}>
                md 파일 선택 또는 내용 붙여 넣기
              </label>
              <input
                id="md-file"
                type="file"
                accept=".md,text/markdown,text/plain"
                className="mt-1 block text-[14px]"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f && f.size < 200_000) setMdText(await f.text());
                }}
              />
              <textarea
                aria-label="md 내용"
                value={mdText}
                onChange={(e) => setMdText(e.target.value)}
                rows={8}
                className="mt-2 w-full rounded-[10px] border border-line p-3 font-mono text-[13px]"
                placeholder={"---\ntitle: …\nslug: …\ndeadline: 2026-12-31 23:59\n---\n## [5점*] …"}
              />
              {mdResult && (mdResult.errors.length > 0 || mdResult.warnings.length > 0) && (
                <ul className="mt-2 space-y-1 text-[13px]">
                  {mdResult.errors.map((e, i) => (
                    <li key={`e${i}`} className="text-[#8a3520]">
                      오류: {e}
                    </li>
                  ))}
                  {mdResult.warnings.map((w, i) => (
                    <li key={`w${i}`} className="text-muted-text">
                      확인: {w}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex gap-2">
                <button type="button" className={buttonCls.primary} disabled={!mdText.trim()} onClick={applyMd}>
                  지금 초안을 이 내용으로 바꾸기
                </button>
                <button type="button" className={buttonCls.ghost} onClick={() => setMdOpen(false)}>
                  닫기
                </button>
              </div>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label htmlFor="f-title" className={labelCls}>
                설문 제목
              </label>
              <input id="f-title" className={fieldCls} maxLength={100} value={spec.title} onChange={(e) => set((s) => ({ ...s, title: e.target.value }))} placeholder="예: 2026 회원 송년회 만족도 설문" />
            </div>
            <div>
              <label htmlFor="f-program" className={labelCls}>
                사업·행사명 <span className="font-normal text-muted-text">(해마다 같은 이름 → 연도별 비교)</span>
              </label>
              <input
                id="f-program"
                list="program-list"
                className={fieldCls}
                maxLength={60}
                value={spec.program}
                onChange={(e) => {
                  const v = e.target.value;
                  set((s) => ops.syncKpiText({ ...s, program: v }, s.program, v));
                }}
              />
              <datalist id="program-list">
                {programs.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>
            <div>
              <label htmlFor="f-category" className={labelCls}>
                분류
              </label>
              <select id="f-category" className={fieldCls} value={CATEGORIES.includes(spec.category) ? spec.category : "기타"} onChange={(e) => set((s) => ({ ...s, category: e.target.value }))}>
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="f-slug" className={labelCls}>
                링크 주소 <span className="font-normal text-muted-text">(영문 소문자·숫자·하이픈)</span>
              </label>
              <div className="flex items-center gap-1">
                <span className="text-[14px] text-muted-text">/s/</span>
                <input
                  id="f-slug"
                  className={fieldCls}
                  maxLength={40}
                  value={spec.slug}
                  onChange={(e) => set((s) => ({ ...s, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))}
                  placeholder="party2026"
                />
              </div>
            </div>
            <div>
              <label htmlFor="f-deadline" className={labelCls}>
                마감 일시 <span className="font-normal text-muted-text">(그 분이 끝날 때까지 접수)</span>
              </label>
              <input
                id="f-deadline"
                type="datetime-local"
                className={fieldCls}
                value={spec.deadline.replace(" ", "T")}
                onChange={(e) => set((s) => ({ ...s, deadline: e.target.value.replace("T", " ") }))}
              />
            </div>
            <div>
              <label htmlFor="f-target" className={labelCls}>
                대상 인원 <span className="font-normal text-muted-text">(응답률 계산, 선택)</span>
              </label>
              <input
                id="f-target"
                type="number"
                min={1}
                inputMode="numeric"
                className={fieldCls}
                value={spec.target ?? ""}
                onChange={(e) => set((s) => ({ ...s, target: e.target.value ? Number(e.target.value) : undefined }))}
              />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="f-intro" className={labelCls}>
                안내문 <span className="font-normal text-muted-text">(응답자에게 보임, 합쇼체)</span>
              </label>
              <textarea id="f-intro" rows={3} maxLength={1000} className="w-full rounded-[10px] border border-line p-3 text-[15px]" value={spec.intro} onChange={(e) => set((s) => ({ ...s, intro: e.target.value }))} />
            </div>
          </div>

          {prev && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-[12px] bg-lime-soft px-4 py-3 text-[14px]">
              <span>
                같은 사업의 지난 설문이 있음: <strong>{prev.title}</strong>. 문구를 그대로 쓰면 연도별 비교가 정확해짐.
              </span>
              <button
                type="button"
                className={buttonCls.ghost}
                onClick={() => {
                  if (window.confirm("지금 문항을 지우고 지난 설문의 문항으로 바꿈. 계속할까요?")) set((s) => ops.copyQuestionsFrom(s, prev));
                }}
              >
                지난 문항 불러오기
              </button>
            </div>
          )}
        </section>

        {/* 문항 */}
        <section aria-labelledby="questions-h" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="questions-h" className="text-[17px] font-bold">
              문항 <span className="text-muted-text">{spec.questions.length}개</span>
            </h2>
          </div>
          {spec.questions.map((q, i) => (
            <QuestionEditor
              key={q.id}
              q={q}
              no={i + 1}
              total={spec.questions.length}
              isKpi={spec.kpiQuestionId === q.id}
              issues={byQuestion.get(q.id) ?? []}
              set={set}
            />
          ))}
          <div className="flex flex-wrap gap-2 rounded-[18px] border border-dashed border-line p-4">
            <span className="self-center text-[13px] font-semibold">문항 추가:</span>
            {(Object.keys(TYPE_LABEL) as QuestionType[]).map((t) => (
              <button key={t} type="button" className={buttonCls.ghost} onClick={() => set((s) => ops.addQuestion(s, t))}>
                + {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* 점검 패널 */}
      <aside className="xl:sticky xl:top-4 xl:self-start" aria-labelledby="check-h">
        <div className="rounded-[18px] border border-line bg-surface p-5">
          <h2 id="check-h" className="text-[17px] font-bold">
            점검
          </h2>
          <p className="mt-1 text-[14px]">
            <span className={report.errorCount ? "font-bold text-[#8a3520]" : "font-bold"}>오류 {report.errorCount}</span> · 확인 {report.warningCount} · 약 {minutes}분
          </p>
          {report.issues.length === 0 ? (
            <p className="mt-3 text-[14px] text-muted-text">문제 없음.</p>
          ) : (
            <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto text-[13px]">
              {generalIssues.map((i, k) => (
                <IssueLine key={k} issue={i} />
              ))}
              {[...byQuestion.entries()].map(([qid, list]) =>
                list.map((i, k) => <IssueLine key={`${qid}-${k}`} issue={i} prefix={`${spec.questions.findIndex((q) => q.id === qid) + 1}번`} />),
              )}
            </ul>
          )}

          {msg && (
            <p role={msg.kind === "err" ? "alert" : "status"} className={`mt-4 rounded-[10px] px-3 py-2 text-[13px] ${msg.kind === "err" ? "bg-[#fdf0eb] text-[#8a3520]" : "bg-lime-soft"}`}>
              {msg.text}
            </p>
          )}

          <div className="mt-4 grid gap-2">
            <button type="button" className={buttonCls.lime} disabled={pending || (!!id && !dirty)} onClick={() => save()}>
              {pending ? "처리 중" : dirty || !id ? "초안 저장" : "저장됨"}
            </button>
            <button
              type="button"
              className={buttonCls.primary}
              disabled={pending || !report.canConfirm}
              onClick={() => {
                if (dirty || !id) save(() => publishRef.current?.showModal());
                else publishRef.current?.showModal();
              }}
            >
              확정하고 게시
            </button>
            {!report.canConfirm && <p className="text-[12px] text-muted-text">오류를 모두 고쳐야 게시할 수 있음.</p>}
            <button
              type="button"
              className={buttonCls.ghost}
              onClick={() => {
                const blob = new Blob([exportMd(tidy)], { type: "text/markdown;charset=utf-8" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `${tidy.slug || "survey"}.md`;
                a.click();
                URL.revokeObjectURL(a.href);
              }}
            >
              md 파일로 내보내기
            </button>
            <Link href="/survey/list" className={buttonCls.ghost}>
              목록으로
            </Link>
          </div>
          <p className="mt-3 text-[12px] text-muted-text">게시하면 문항을 바꿀 수 없음(응답과 어긋나지 않게). 서술 문항이 있으면 개인정보 기재 금지 안내가 자동으로 들어감.</p>
        </div>
      </aside>

      <dialog ref={publishRef} className="m-auto w-[min(92vw,460px)] rounded-[18px] border border-line bg-surface p-6 backdrop:bg-ink/40">
        <h2 className="text-[17px] font-bold">게시할까요?</h2>
        <ul className="mt-3 space-y-1 text-[14px]">
          <li>· 제목: {tidy.title}</li>
          <li>
            · 응답 링크: <span className="font-mono">/s/{tidy.slug}</span>
          </li>
          <li>· 마감: {tidy.deadline} (이 분이 끝날 때까지 접수)</li>
          <li>· 문항 {tidy.questions.length}개, 약 {minutes}분</li>
        </ul>
        <p className="mt-3 text-[13px] text-muted-text">게시 후에는 문항을 바꿀 수 없고, 마감일 변경·지금 마감만 할 수 있음.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={buttonCls.ghost} onClick={() => publishRef.current?.close()}>
            취소
          </button>
          <button type="button" className={buttonCls.primary} disabled={pending} onClick={publish}>
            게시
          </button>
        </div>
      </dialog>
    </div>
  );
}

function IssueLine({ issue, prefix }: { issue: Issue; prefix?: string }) {
  const tag = issue.level === "error" ? "오류" : issue.level === "warning" ? "확인" : "자동 보정";
  const cls = issue.level === "error" ? "text-[#8a3520]" : "text-ink";
  return (
    <li className={cls}>
      <span className="font-semibold">
        [{tag}]{prefix ? ` ${prefix}` : ""}
      </span>{" "}
      {issue.message}
    </li>
  );
}

function QuestionEditor({
  q,
  no,
  total,
  isKpi,
  issues,
  set,
}: {
  q: Question;
  no: number;
  total: number;
  isKpi: boolean;
  issues: Issue[];
  set: (fn: (s: SurveySpec) => SurveySpec) => void;
}) {
  const hasError = issues.some((i) => i.level === "error");
  const base = `q-${q.id}`;
  return (
    <fieldset className={`rounded-[18px] border bg-surface p-5 ${hasError ? "border-scale-1" : "border-line"}`}>
      <legend className="sr-only">{no}번 문항</legend>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-bold">{no}.</span>
        <label htmlFor={`${base}-type`} className="sr-only">
          유형
        </label>
        <select id={`${base}-type`} value={q.type} onChange={(e) => set((s) => ops.changeType(s, q.id, e.target.value as QuestionType))} className="h-9 rounded-[10px] border border-line bg-surface px-2 text-[13px]">
          {(Object.keys(TYPE_LABEL) as QuestionType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-[13px]">
          <input type="checkbox" checked={q.required} onChange={(e) => set((s) => ops.updateQuestion(s, q.id, { required: e.target.checked }))} className="size-4 accent-ink" />
          필수
        </label>
        {q.type === "scale5" &&
          (isKpi ? (
            <span className="rounded-full bg-lime px-2 py-0.5 text-[12px] font-bold">★ 대표 만족도</span>
          ) : (
            <button type="button" className="h-8 rounded-full border border-line px-3 text-[12px]" onClick={() => set((s) => ops.setKpi(s, q.id))}>
              대표 만족도로 지정
            </button>
          ))}
        <span className="ml-auto flex gap-1">
          <button type="button" aria-label={`${no}번 문항 위로`} disabled={no === 1} className="size-9 rounded-[10px] border border-line disabled:opacity-40" onClick={() => set((s) => ops.moveQuestion(s, q.id, -1))}>
            ↑
          </button>
          <button type="button" aria-label={`${no}번 문항 아래로`} disabled={no === total} className="size-9 rounded-[10px] border border-line disabled:opacity-40" onClick={() => set((s) => ops.moveQuestion(s, q.id, 1))}>
            ↓
          </button>
          <button
            type="button"
            aria-label={`${no}번 문항 삭제`}
            className="size-9 rounded-[10px] border border-line text-[#8a3520]"
            onClick={() => {
              if (!isKpi || window.confirm("대표 만족도 문항임. 삭제하면 다른 5점 문항을 대표로 지정해야 게시할 수 있음. 삭제할까요?")) set((s) => ops.removeQuestion(s, q.id));
            }}
          >
            ✕
          </button>
        </span>
      </div>

      <label htmlFor={`${base}-text`} className="mt-3 block text-[13px] font-semibold">
        질문
      </label>
      <input
        id={`${base}-text`}
        maxLength={200}
        value={q.text}
        onChange={(e) => set((s) => ops.updateQuestion(s, q.id, { text: e.target.value }))}
        className="h-11 w-full rounded-[10px] border border-line px-3 text-[15px] focus-visible:outline-3 focus-visible:outline-teal"
        placeholder="예: 강사의 진행에 만족하십니까?"
      />
      {isKpi && <p className="mt-1 text-[12px] text-muted-text">대표 문항은 다른 설문과 비교하는 기준이라 표준 문구를 권장함.</p>}

      <details className="mt-2 text-[13px]">
        <summary className="cursor-pointer text-muted-text">영역 제목·안내 문구</summary>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <input aria-label="영역 제목" placeholder="영역 제목(선택)" value={q.section ?? ""} onChange={(e) => set((s) => ops.updateQuestion(s, q.id, { section: e.target.value }))} className="h-10 rounded-[10px] border border-line px-3" />
          <input aria-label="질문 아래 안내" placeholder="질문 아래 안내(선택)" value={q.note ?? ""} onChange={(e) => set((s) => ops.updateQuestion(s, q.id, { note: e.target.value }))} className="h-10 rounded-[10px] border border-line px-3" />
        </div>
      </details>

      {(q.type === "single" || q.type === "multi") && (
        <div className="mt-3">
          <p className="text-[13px] font-semibold">보기</p>
          <ul className="mt-1 space-y-2">
            {(q.options ?? []).map((o, idx) => (
              <li key={idx} className="flex flex-wrap items-center gap-2">
                <input
                  aria-label={`보기 ${idx + 1}`}
                  maxLength={100}
                  value={o.label}
                  onChange={(e) => {
                    const v = e.target.value;
                    set((s) => ops.setOptions(s, q.id, (q.options ?? []).map((x, j) => (j === idx ? { ...x, label: v } : x))));
                  }}
                  className="h-10 min-w-0 flex-1 rounded-[10px] border border-line px-3"
                />
                <label className="flex items-center gap-1 text-[12px]">
                  <input
                    type="checkbox"
                    checked={!!o.other}
                    onChange={(e) => {
                      const v = e.target.checked;
                      set((s) => ops.setOptions(s, q.id, (q.options ?? []).map((x, j) => (j === idx ? { ...x, other: v } : x))));
                    }}
                    className="accent-ink"
                  />
                  직접입력
                </label>
                <button
                  type="button"
                  aria-label={`보기 ${idx + 1} 삭제`}
                  className="size-9 rounded-[10px] border border-line"
                  onClick={() => set((s) => ops.setOptions(s, q.id, (q.options ?? []).filter((_, j) => j !== idx)))}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button type="button" className="h-9 rounded-[10px] border border-line px-3 text-[13px]" onClick={() => set((s) => ops.setOptions(s, q.id, [...(q.options ?? []), { label: "" }]))}>
              + 보기
            </button>
            {q.type === "multi" && (
              <label className="flex items-center gap-2 text-[13px]">
                최대 선택 개수
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={q.max ?? 0}
                  onChange={(e) => set((s) => ops.updateQuestion(s, q.id, { max: Math.max(0, Number(e.target.value) || 0) }))}
                  className="h-9 w-16 rounded-[10px] border border-line px-2"
                />
                <span className="text-muted-text">(0 = 제한 없음)</span>
              </label>
            )}
          </div>
        </div>
      )}

      {q.type === "scale5" && (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <label className="text-[13px]">
            <span className="font-semibold">1점 라벨</span>
            <input value={q.low ?? ""} disabled={isKpi} onChange={(e) => set((s) => ops.updateQuestion(s, q.id, { low: e.target.value }))} className="mt-1 h-10 w-full rounded-[10px] border border-line px-3 disabled:bg-bg" />
          </label>
          <label className="text-[13px]">
            <span className="font-semibold">5점 라벨</span>
            <input value={q.high ?? ""} disabled={isKpi} onChange={(e) => set((s) => ops.updateQuestion(s, q.id, { high: e.target.value }))} className="mt-1 h-10 w-full rounded-[10px] border border-line px-3 disabled:bg-bg" />
          </label>
        </div>
      )}

      {issues.length > 0 && (
        <ul className="mt-3 space-y-1 text-[13px]">
          {issues.map((i, k) => (
            <IssueLine key={k} issue={i} />
          ))}
        </ul>
      )}
    </fieldset>
  );
}
