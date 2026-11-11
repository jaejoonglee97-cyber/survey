import type { Aggregate, ChoiceAgg, Scale10Agg, ScaleAgg } from "./aggregate";
import { pct } from "./aggregate";
import type { SurveySpec } from "./spec";

// 결과보고서 「Ⅴ. 평가 → N. 만족도 평가」 문안. 협회 결과보고서 문체(‘- ’ 글머리, 명사형 종결)를 따름.
// 숫자 문장은 자동으로 만들고, 해석은 담당자가 보완하도록 자리 표시를 둠(판단이 들어가는 부분).
// 서술 의견은 담당자가 고른 것만 인용함(개인을 알 수 있는 내용이 없는지 담당자가 확인).

export interface EvaluationOptions {
  /** 소제목 번호(예: "4") */
  headingNo?: string;
  /** 담당자가 고른 인용 의견(최대 3개 권장) */
  quotes?: string[];
  /** 해석 보완 자리 표시를 넣을지 */
  hints?: boolean;
}

// ───────── 조사(助詞) ─────────

const DIGIT_BATCHIM: Record<string, "none" | "rieul" | "other"> = {
  "0": "other", "1": "rieul", "2": "none", "3": "other", "4": "none", "5": "none", "6": "other", "7": "rieul", "8": "rieul", "9": "none",
};

/** 마지막 글자의 받침: 없음 / ㄹ / 그 밖. 괄호·문장부호는 건너뜀 */
export function batchim(word: string): "none" | "rieul" | "other" {
  const chars = [...word.replace(/[\s)\]’”'"%.,!?·…]+$/u, "")];
  const c = chars[chars.length - 1] ?? "";
  if (/[0-9]/.test(c)) return DIGIT_BATCHIM[c];
  const code = c.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return "none";
  const jong = code % 28;
  return jong === 0 ? "none" : jong === 8 ? "rieul" : "other";
}

/** 으로/로 */
export const euro = (w: string) => (batchim(w) === "other" ? "으로" : "로");
/** 이/가 */
export const iga = (w: string) => (batchim(w) === "none" ? "가" : "이");
/** 은/는 */
export const eunneun = (w: string) => (batchim(w) === "none" ? "는" : "은");

// ───────── 문안 ─────────

export function toneOf(mean: number, topPct: number): string {
  if (mean >= 4.5 || topPct >= 60) return "매우 긍정적인";
  if (mean >= 4.0) return "긍정적인";
  if (mean >= 3.5) return "대체로 긍정적인";
  if (mean >= 3.0) return "보통 수준인";
  return "다소 아쉬운";
}

const q = (s: string) => `‘${s}’`;

function scaleSentence(a: ScaleAgg): string {
  const high = a.high || "매우 만족";
  return `${q(a.text)} 문항은 ${a.topPct}%가 ${q(high)}${euro(high)} 응답하였으며 평균 ${a.mean.toFixed(1)}점(5점 만점)으로 나타남.`;
}
function choiceSentence(a: ChoiceAgg): string | null {
  const top = [...a.options].sort((x, y) => y.count - x.count)[0];
  if (!top || !top.count) return null;
  if (a.type === "multi") return `${q(a.text)} 문항은 ${q(top.label)}${iga(top.label)} ${top.pct}%로 가장 많이 선택되었음(복수응답).`;
  return `${q(a.text)} 문항은 ${q(top.label)} 응답이 ${top.pct}%로 가장 많았음.`;
}

export function buildEvaluationLines(
  spec: Pick<SurveySpec, "program" | "target" | "kpiQuestionId" | "questions">,
  agg: Aggregate,
  opts: EvaluationOptions = {},
): string[] {
  const hint = (t: string) => (opts.hints === false ? "" : ` [${t}]`);
  const L: string[] = [`${opts.headingNo?.trim() || "4"}. 만족도 평가`];
  const n = agg.n;
  if (!n) {
    L.push("- 접수된 응답이 없어 만족도를 평가하지 못함.");
    return L;
  }

  const byId = new Map(agg.questions.map((a) => [a.id, a]));
  const kpi = spec.kpiQuestionId ? byId.get(spec.kpiQuestionId) : undefined;
  const scales5 = agg.questions.filter((a): a is ScaleAgg => a.type === "scale5" && a.valid > 0);
  const overallMean = kpi && kpi.type === "scale5" && kpi.valid ? kpi.mean : scales5.length ? scales5.reduce((s, a) => s + a.mean, 0) / scales5.length : null;
  const overallTop = kpi && kpi.type === "scale5" ? kpi.topPct : 0;

  // 1) 총평
  const rate = spec.target ? `, 응답률 ${pct(n, spec.target)}%` : "";
  L.push(
    overallMean === null
      ? `- 참여자 만족도 조사(응답 ${n}명${rate}) 결과는 다음과 같이 집계됨.`
      : `- 참여자 만족도 조사(응답 ${n}명${rate})를 분석한 결과, 전체 프로그램에 대한 반응은 전반적으로 ${toneOf(overallMean, overallTop)} 것으로 나타남.`,
  );

  // 2) 대표 만족도
  if (kpi && kpi.type === "scale5" && kpi.valid) {
    const high = kpi.high || "매우 만족";
    L.push(
      `- 우선 전체 만족도에서 ${kpi.topPct}%가 ${q(high)}${euro(high)} 응답하였고, 긍정 응답(4~5점)은 ${kpi.posPct}%, 평균은 ${kpi.mean.toFixed(1)}점(5점 만점)으로 나타남.${hint("해석 보완: 예) 이는 운영 방향과 구성에 대한 신뢰도가 높았음을 의미함")}`,
    );
  }

  // 3) 10점 척도 문항은 한 문단으로
  const s10 = agg.questions.filter((a): a is Scale10Agg => a.type === "scale10" && a.valid > 0);
  if (s10.length) {
    const parts = s10.map((a) => `${q(a.text)} 평균 ${a.mean.toFixed(1)}점`);
    L.push(`- 또한 ${parts.join(", ")}(10점 만점)으로 나타남.${hint("해석 보완")}`);
  }

  // 4) 영역별(편집기의 '영역 제목' 기준). 영역이 없으면 문항마다 한 문단
  const rest = agg.questions.filter((a) => a.id !== spec.kpiQuestionId && a.type !== "text" && a.type !== "scale10" && a.answered > 0);
  const groups: { name: string | null; items: typeof rest }[] = [];
  for (const a of rest) {
    const name = a.section?.trim() || null;
    const last = groups[groups.length - 1];
    if (name && last && last.name === name) last.items.push(a);
    else if (name && groups.some((g) => g.name === name)) groups.find((g) => g.name === name)!.items.push(a);
    else groups.push({ name, items: [a] });
  }
  for (const g of groups) {
    const sentences = g.items
      .map((a) => (a.type === "scale5" ? scaleSentence(a) : a.type === "single" || a.type === "multi" ? choiceSentence(a) : null))
      .filter((s): s is string => !!s);
    if (!sentences.length) continue;
    L.push(`- ${g.name ? `${g.name}에 대한 평가: ` : ""}${sentences.join(" ")}${hint("해석 보완")}`);
  }

  // 5) 서술 의견
  const texts = agg.questions.filter((a) => a.type === "text").reduce((s, a) => s + (a.type === "text" ? a.texts.length : 0), 0);
  const quotes = (opts.quotes ?? []).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (texts || quotes.length) {
    L.push(
      quotes.length
        ? `- 서술 의견은 총 ${texts}건이 접수되었으며, ${quotes.map((s) => `“${s}”`).join(", ")} 등의 의견이 있었음.`
        : `- 서술 의견은 총 ${texts}건이 접수되었음.${hint("인용할 의견을 결과 화면에서 고를 수 있음")}`,
    );
  }

  // 6) 상대적으로 낮은 문항
  const low = scales5.filter((a) => a.id !== spec.kpiQuestionId && a.mean < 3.5).sort((a, b) => a.mean - b.mean)[0];
  if (low) L.push(`- 다만 ${q(low.text)} 문항은 평균 ${low.mean.toFixed(1)}점으로 상대적으로 낮아 개선 방안 검토가 필요함.`);

  // 7) 종합
  const name = spec.program.replace(/^\[시험\]\s*/, "").trim();
  const strong = groups
    .filter((g) => g.name)
    .map((g) => {
      const sc = g.items.filter((a): a is ScaleAgg => a.type === "scale5");
      return { name: g.name!, mean: sc.length ? sc.reduce((s, a) => s + a.mean, 0) / sc.length : 0 };
    })
    .filter((g) => g.mean >= 4)
    .sort((a, b) => b.mean - a.mean)
    .slice(0, 3)
    .map((g) => g.name);
  const subject = name ? `이번 ${name}${eunneun(name)} ` : "";
  L.push(
    strong.length
      ? `- 종합적으로 볼 때, ${subject}${strong.join(", ")} 등에서 고른 만족도를 확보한 것으로 분석됨.${hint("해석 보완")}`
      : `- 종합적으로 볼 때, ${subject}${overallMean !== null && overallMean >= 4 ? "전반적으로 높은 만족도를 확보한" : "운영 전반에 대한 보완점을 확인한"} 것으로 분석됨.${hint("해석 보완")}`,
  );
  return L;
}
