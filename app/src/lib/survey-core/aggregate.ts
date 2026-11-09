import { unsafeCell } from "./answers";
import { MULTI_SEP, type QuestionType, type SurveySpec } from "./spec";

// 집계. rows 는 문항 순서의 셀 문자열 배열 목록(응답 탭의 행에서 제출 시각 열을 뺀 것).

export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
export const round1 = (x: number) => Math.round(x * 10) / 10;

interface BaseAgg {
  id: string;
  text: string;
  type: QuestionType;
  section?: string;
  /** 이 문항에 답한 응답 수 */
  answered: number;
}
export interface ChoiceAgg extends BaseAgg {
  type: "single" | "multi";
  options: { label: string; count: number; pct: number }[];
  otherTexts: string[];
}
export interface ScaleAgg extends BaseAgg {
  type: "scale5";
  dist: [number, number, number, number, number];
  valid: number;
  mean: number;
  /** 긍정 응답(4~5점) 수와 비율 */
  pos: number;
  posPct: number;
  low?: string;
  high?: string;
}
export interface TextAgg extends BaseAgg {
  type: "text";
  texts: string[];
}
export type QuestionAgg = ChoiceAgg | ScaleAgg | TextAgg;

export interface Aggregate {
  n: number;
  questions: QuestionAgg[];
}

export function aggregate(spec: Pick<SurveySpec, "questions">, rows: readonly (readonly unknown[])[]): Aggregate {
  const questions = spec.questions.map((q, qi): QuestionAgg => {
    const cells = rows.map((r) => (r[qi] == null ? "" : String(r[qi]))).filter((c) => c !== "");
    const base = { id: q.id, text: q.text, section: q.section, answered: cells.length };

    if (q.type === "single" || q.type === "multi") {
      const opts = q.options ?? [];
      const counts = new Map(opts.map((o) => [o.label, 0]));
      const otherTexts: string[] = [];
      for (const c of cells) {
        const partsOf = q.type === "multi" ? c.split(MULTI_SEP) : [c];
        for (const p of partsOf) {
          for (const o of opts) {
            if (p === o.label) {
              counts.set(o.label, (counts.get(o.label) ?? 0) + 1);
              break;
            }
            if (o.other && p.startsWith(o.label + ": ")) {
              counts.set(o.label, (counts.get(o.label) ?? 0) + 1);
              otherTexts.push(unsafeCell(p.slice(o.label.length + 2)));
              break;
            }
          }
        }
      }
      return {
        ...base,
        type: q.type,
        options: opts.map((o) => ({ label: o.label, count: counts.get(o.label) ?? 0, pct: pct(counts.get(o.label) ?? 0, cells.length) })),
        otherTexts,
      };
    }

    if (q.type === "scale5") {
      const dist: [number, number, number, number, number] = [0, 0, 0, 0, 0];
      let sum = 0;
      for (const c of cells) {
        const v = Number(c);
        if (Number.isInteger(v) && v >= 1 && v <= 5) {
          dist[v - 1]++;
          sum += v;
        }
      }
      const valid = dist.reduce((a, b) => a + b, 0);
      const pos = dist[3] + dist[4];
      return {
        ...base,
        type: "scale5",
        dist,
        valid,
        mean: valid ? round1(sum / valid) : 0,
        pos,
        posPct: pct(pos, valid),
        low: q.low,
        high: q.high,
      };
    }

    return { ...base, type: "text", texts: cells.map(unsafeCell) };
  });
  return { n: rows.length, questions };
}

/** 대표 문항의 분포만 뽑음(summary 탭·대시보드용). 대표 문항이 없으면 null. */
export function kpiOf(spec: Pick<SurveySpec, "kpiQuestionId">, agg: Aggregate): ScaleAgg | null {
  if (!spec.kpiQuestionId) return null;
  const q = agg.questions.find((x) => x.id === spec.kpiQuestionId);
  return q && q.type === "scale5" ? q : null;
}
