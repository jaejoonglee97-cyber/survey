"use client";

import { hasQuestion, QUESTION_BANK, type BankQuestion } from "@/lib/admin/question-bank";
import type { QuestionType, SurveySpec } from "@/lib/survey-core";

const TYPE_LABEL: Record<QuestionType, string> = { single: "단일", multi: "복수", scale5: "5점", text: "서술" };

// 자주 쓰는 문항 목록. 누르면 맨 뒤에 추가됨
export function QuestionBank({ spec, onAdd, onClose }: { spec: SurveySpec; onAdd: (item: BankQuestion) => void; onClose: () => void }) {
  return (
    <div className="rounded-[18px] border border-ink bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[15px] font-bold">문항 은행</p>
        <button type="button" onClick={onClose} className="h-9 rounded-[10px] border border-line px-3 text-[13px]">
          닫기
        </button>
      </div>
      <p className="mt-1 text-[12px] text-muted-text">자주 쓰는 문항을 누르면 맨 아래에 추가됨. 추가한 뒤 문구·보기를 고칠 수 있음.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {QUESTION_BANK.map((g) => (
          <div key={g.name}>
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-teal-deep">{g.name}</p>
            <ul className="space-y-1.5">
              {g.items.map((item) => {
                const added = hasQuestion(spec, item);
                const text = item.kpi ? "(사업·행사명)에 대해 전반적으로 만족하십니까? — 대표 만족도" : item.text;
                return (
                  <li key={item.text}>
                    <button
                      type="button"
                      disabled={added}
                      onClick={() => onAdd(item)}
                      className="flex w-full items-start gap-2 rounded-[10px] border border-line px-3 py-2 text-left text-[13px] hover:border-ink disabled:cursor-default disabled:bg-bg disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-teal"
                    >
                      <span className="mt-0.5 shrink-0 rounded-full bg-bg px-2 py-0.5 text-[11px] font-semibold">{TYPE_LABEL[item.type]}</span>
                      <span className="min-w-0 flex-1">{text}</span>
                      <span className="shrink-0 text-[12px] font-semibold">{added ? "추가됨" : "+ 추가"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
