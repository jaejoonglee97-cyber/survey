"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { purgeTestSurveysAction } from "@/app/survey/actions";
import { buttonCls } from "./ui";

export interface TestSurveyRow {
  id: string;
  title: string;
  slug: string;
  responses: number;
}

// 시험 데이터 정리: 시험 설문(test-…, [시험]…)만 골라 응답까지 지움. 되돌릴 수 없어 확인 창을 거침
export function TestDataCleaner({ rows }: { rows: TestSurveyRow[] }) {
  const [picked, setPicked] = useState<Set<string>>(new Set(rows.map((r) => r.id)));
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  if (rows.length === 0) {
    return (
      <p className="text-[14px] text-muted-text">
        시험 설문이 없음. {msg?.kind === "ok" && <span className="font-semibold text-ink">{msg.text}</span>}
      </p>
    );
  }

  const chosen = rows.filter((r) => picked.has(r.id));
  const total = chosen.reduce((s, r) => s + r.responses, 0);

  return (
    <div>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id}>
            <label className="flex cursor-pointer items-center gap-3 py-3">
              <input
                type="checkbox"
                checked={picked.has(r.id)}
                onChange={(e) =>
                  setPicked((p) => {
                    const n = new Set(p);
                    if (e.target.checked) n.add(r.id);
                    else n.delete(r.id);
                    return n;
                  })
                }
                className="size-5 accent-ink"
              />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{r.title}</span>
                <span className="text-[12px] text-muted-text">
                  /s/{r.slug} · 응답 {r.responses}건
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <button type="button" disabled={!chosen.length || pending} className={`${buttonCls.danger} mt-3`} onClick={() => dialogRef.current?.showModal()}>
        고른 시험 설문 {chosen.length}개 지우기
      </button>
      {msg && (
        <p role={msg.kind === "err" ? "alert" : "status"} className={`mt-3 rounded-[10px] px-3 py-2 text-[13px] ${msg.kind === "err" ? "bg-[#fdf0eb] text-[#8a3520]" : "bg-lime-soft"}`}>
          {msg.text}
        </p>
      )}

      <dialog ref={dialogRef} className="m-auto w-[min(92vw,440px)] rounded-[18px] border border-line bg-surface p-6 backdrop:bg-ink/40">
        <h2 className="text-[17px] font-bold">시험 설문을 지울까요?</h2>
        <p className="mt-3 text-[14px]">
          설문 {chosen.length}개와 응답 {total}건, 대시보드 집계를 시트에서 지움. <strong>되돌릴 수 없음.</strong>
        </p>
        <p className="mt-2 text-[12px] text-muted-text">링크 주소가 test- 로 시작하거나 제목·사업명이 [시험] 으로 시작하는 설문만 지워지고, 실제 설문은 지워지지 않음.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={buttonCls.ghost} onClick={() => dialogRef.current?.close()}>
            취소
          </button>
          <button
            type="button"
            disabled={pending}
            className={buttonCls.danger}
            onClick={() =>
              start(async () => {
                const r = await purgeTestSurveysAction(chosen.map((c) => c.id));
                dialogRef.current?.close();
                if (r.ok) {
                  setMsg({ kind: "ok", text: `설문 ${r.value.surveys}개, 응답 ${r.value.responses}건을 지움${r.value.skipped ? ` (건너뜀 ${r.value.skipped}개)` : ""}` });
                  router.refresh();
                } else setMsg({ kind: "err", text: r.error });
              })
            }
          >
            지우기
          </button>
        </div>
      </dialog>
    </div>
  );
}
