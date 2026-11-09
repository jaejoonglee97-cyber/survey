import { safeCell, unsafeCell, type SurveySpec } from "../survey-core";

// 원자료 CSV(담당자만). 엑셀에서 수식으로 실행되지 않게 = + - @ 시작 값에 ' 를 붙이고,
// 한글이 깨지지 않게 BOM 을 붙임.

function cell(v: string): string {
  const s = safeCell(unsafeCell(v));
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(spec: Pick<SurveySpec, "questions">, rows: string[][], submittedAt: string[]): string {
  const header = ["제출 시각", ...spec.questions.map((q) => `${q.id} ${q.text}`)];
  const lines = [header, ...rows.map((r, i) => [submittedAt[i] ?? "", ...r])].map((r) => r.map((c) => cell(c ?? "")).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function csvFileName(slug: string, now: Date): string {
  const d = new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
  return `${slug}-responses-${d}.csv`;
}
