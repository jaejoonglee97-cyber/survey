"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { deleteSurveyAction, setDeadlineAction, setStatusAction } from "@/app/survey/actions";
import { parseDeadline, type SurveyStatus } from "@/lib/survey-core";
import { buttonCls } from "./ui";

type Mode = "menu" | "deadline" | "close" | "delete" | null;

export function RowActions({
  id,
  slug,
  title,
  state,
  deadline,
  responses,
  siteUrl,
}: {
  id: string;
  slug: string;
  title: string;
  state: SurveyStatus;
  deadline: string;
  responses: number;
  siteUrl: string;
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [msg, setMsg] = useState("");
  const [value, setValue] = useState(deadline.replace(" ", "T"));
  const [pending, start] = useTransition();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (mode && mode !== "menu" && !d.open) d.showModal();
    if ((!mode || mode === "menu") && d.open) d.close();
  }, [mode]);

  const link = `${siteUrl || (typeof window !== "undefined" ? window.location.origin : "")}/s/${slug}`;

  function done(r: { ok: boolean; error?: string }, ok: string) {
    if (r.ok) {
      setMode(null);
      setMsg(ok);
      router.refresh();
    } else setMsg(r.error ?? "처리하지 못함");
  }

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={mode === "menu"}
        onClick={() => setMode(mode === "menu" ? null : "menu")}
        className="h-9 rounded-[10px] border border-line px-3 text-[13px] font-semibold focus-visible:outline-3 focus-visible:outline-teal"
      >
        작업 <span className="sr-only">: {title}</span>
      </button>
      {msg && (
        <p role="status" className="mt-1 max-w-[220px] text-[12px] text-muted-text">
          {msg}
        </p>
      )}

      {mode === "menu" && (
        <ul role="menu" className="absolute right-0 z-20 mt-1 w-48 rounded-[12px] border border-line bg-surface p-1 text-[14px] shadow-sm">
          {state === "draft" ? (
            <li role="none">
              <Link role="menuitem" href={`/survey/${id}/edit`} className="block rounded-[8px] px-3 py-2 hover:bg-bg">
                편집·게시
              </Link>
            </li>
          ) : (
            <>
              <li role="none">
                <button
                  role="menuitem"
                  type="button"
                  className="w-full rounded-[8px] px-3 py-2 text-left hover:bg-bg"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(link);
                      setMsg("응답 링크를 복사함");
                    } catch {
                      setMsg(link);
                    }
                    setMode(null);
                  }}
                >
                  응답 링크 복사
                </button>
              </li>
              <li role="none">
                <button role="menuitem" type="button" className="w-full rounded-[8px] px-3 py-2 text-left hover:bg-bg" onClick={() => setMode("deadline")}>
                  마감일 변경
                </button>
              </li>
              {state === "closed" && (parseDeadline(deadline)?.getTime() ?? 0) > Date.now() && (
                <li role="none">
                  <button
                    role="menuitem"
                    type="button"
                    className="w-full rounded-[8px] px-3 py-2 text-left hover:bg-bg"
                    onClick={() => start(async () => done(await setStatusAction(id, "open"), "다시 열었음"))}
                  >
                    다시 열기
                  </button>
                </li>
              )}
              {state === "open" && (
                <li role="none">
                  <button role="menuitem" type="button" className="w-full rounded-[8px] px-3 py-2 text-left hover:bg-bg" onClick={() => setMode("close")}>
                    지금 마감
                  </button>
                </li>
              )}
            </>
          )}
          {responses === 0 && (
            <li role="none">
              <button role="menuitem" type="button" className="w-full rounded-[8px] px-3 py-2 text-left text-[#8a3520] hover:bg-bg" onClick={() => setMode("delete")}>
                삭제
              </button>
            </li>
          )}
        </ul>
      )}

      <dialog
        ref={dialogRef}
        onClose={() => setMode((m) => (m === "menu" ? m : null))}
        className="m-auto w-[min(92vw,420px)] rounded-[18px] border border-line bg-surface p-6 text-left backdrop:bg-ink/40"
      >
        <h2 className="text-[17px] font-bold">{title}</h2>
        {mode === "deadline" && (
          <form
            className="mt-4"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => done(await setDeadlineAction(id, value.replace("T", " ")), "마감일을 바꿈"));
            }}
          >
            <label htmlFor={`dl-${id}`} className="block text-[13px] font-semibold">
              새 마감 일시(분 단위, 그 분이 끝날 때까지 접수)
            </label>
            <input
              id={`dl-${id}`}
              type="datetime-local"
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="mt-1 h-11 w-full rounded-[10px] border border-line px-3"
            />
            <p className="mt-2 text-[12px] text-muted-text">마감 뒤 연장하면 다시 응답을 받고, 다시 마감될 때 결과 메일을 다시 보냄. 담당자가 직접 마감한 설문은 연장해도 닫힌 채로 있음.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={buttonCls.ghost} onClick={() => setMode(null)}>
                취소
              </button>
              <button type="submit" disabled={pending} className={buttonCls.primary}>
                바꾸기
              </button>
            </div>
          </form>
        )}
        {mode === "close" && (
          <div className="mt-4">
            <p className="text-[14px]">지금 마감하면 응답 링크로 더 이상 응답할 수 없음. 마감일이 남아 있으면 나중에 다시 열 수 있음.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={buttonCls.ghost} onClick={() => setMode(null)}>
                취소
              </button>
              <button
                type="button"
                disabled={pending}
                className={buttonCls.danger}
                onClick={() => start(async () => done(await setStatusAction(id, "closed"), "마감함"))}
              >
                지금 마감
              </button>
            </div>
          </div>
        )}
        {mode === "delete" && (
          <div className="mt-4">
            <p className="text-[14px]">응답이 없는 설문이라 삭제할 수 있음. 삭제하면 되돌릴 수 없음.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={buttonCls.ghost} onClick={() => setMode(null)}>
                취소
              </button>
              <button type="button" disabled={pending} className={buttonCls.danger} onClick={() => start(async () => done(await deleteSurveyAction(id), "삭제함"))}>
                삭제
              </button>
            </div>
          </div>
        )}
        {msg && mode && mode !== "menu" && (
          <p role="alert" className="mt-3 text-[13px] text-[#8a3520]">
            {msg}
          </p>
        )}
      </dialog>
    </div>
  );
}
