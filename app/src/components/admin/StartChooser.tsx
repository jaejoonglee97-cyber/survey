"use client";

import { useMemo, useState } from "react";
import { START_TEMPLATES, type StartTemplate } from "@/lib/admin/question-bank";
import type { PreviousSurvey } from "./SurveyEditor";
import { buttonCls } from "./ui";

// 새 설문 첫 화면: 어떻게 시작할지 고름(템플릿 / 지난 설문 복사 / 파일)
export function StartChooser({
  previous,
  onTemplate,
  onCopy,
  onFile,
}: {
  previous: PreviousSurvey[];
  onTemplate: (t: StartTemplate) => void;
  onCopy: (p: PreviousSurvey) => void;
  onFile: () => void;
}) {
  const [q, setQ] = useState("");
  const list = useMemo(
    () =>
      [...previous]
        .sort((a, b) => b.year - a.year || a.title.localeCompare(b.title, "ko"))
        .filter((p) => !q.trim() || `${p.title} ${p.program}`.includes(q.trim())),
    [previous, q],
  );

  return (
    <div className="space-y-5">
      <section className="rounded-[18px] border border-line bg-surface p-5" aria-labelledby="tpl-h">
        <h2 id="tpl-h" className="text-[17px] font-bold">
          어떻게 시작할까요?
        </h2>
        <p className="mt-1 text-[13px] text-muted-text">고른 뒤에도 문항은 자유롭게 더하고 빼고 고칠 수 있음.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {START_TEMPLATES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => onTemplate(t)}
              className="rounded-[14px] border-2 border-line p-4 text-left hover:border-ink focus-visible:outline-3 focus-visible:outline-teal"
            >
              <span className="block text-[15px] font-bold">{t.name}</span>
              <span className="mt-1 block text-[13px] text-muted-text">{t.description}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={onFile}
            className="rounded-[14px] border-2 border-dashed border-line p-4 text-left hover:border-ink focus-visible:outline-3 focus-visible:outline-teal"
          >
            <span className="block text-[15px] font-bold">md 파일에서 가져오기</span>
            <span className="mt-1 block text-[13px] text-muted-text">문항을 표로 정리한 문서에서 질문만 가져옴</span>
          </button>
        </div>
      </section>

      {previous.length > 0 && (
        <section className="rounded-[18px] border border-line bg-surface p-5" aria-labelledby="copy-h">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="copy-h" className="text-[17px] font-bold">
                지난 설문 복사
              </h2>
              <p className="mt-1 text-[13px] text-muted-text">문항·사업명·분류·안내문을 그대로 가져옴. 같은 문구를 쓰면 연도별 비교가 정확해짐.</p>
            </div>
            <input
              aria-label="지난 설문 찾기"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="제목·사업명으로 찾기"
              className="h-10 w-full rounded-[10px] border border-line px-3 text-[14px] sm:w-64"
            />
          </div>
          <ul className="mt-4 max-h-80 divide-y divide-line overflow-y-auto">
            {list.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span className="min-w-0">
                  <span className="block font-semibold">{p.title}</span>
                  <span className="text-[12px] text-muted-text">
                    {p.program} · {p.year}년 · 문항 {p.questions.length}개
                  </span>
                </span>
                <button type="button" className={buttonCls.ghost} onClick={() => onCopy(p)}>
                  이 설문으로 시작
                </button>
              </li>
            ))}
            {list.length === 0 && <li className="py-3 text-[14px] text-muted-text">찾는 설문이 없음.</li>}
          </ul>
        </section>
      )}
    </div>
  );
}
