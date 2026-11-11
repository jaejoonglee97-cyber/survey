import { pct, type Aggregate, type ChoiceAgg, type Scale10Agg, type ScaleAgg, type TextAgg } from "./aggregate";
import type { SurveySpec } from "./spec";

// 결과보고서 문안(공문서 명사형 종결). 수치만 정리하고 서술 의견 원문은 넣지 않음.
// 문장은 프로토타입 buildReportLines_ 와 글자 단위로 같아야 함.

export function buildReportLines(
  spec: Pick<SurveySpec, "title" | "deadline" | "target">,
  agg: Aggregate,
  target?: number,
): string[] {
  const L: string[] = [];
  const n = agg.n;
  const t = target || spec.target || 0;
  L.push("1. 응답 현황");
  L.push("- 설문명: " + spec.title);
  L.push("- 설문 기한: " + spec.deadline + "까지");
  if (t) L.push("- 대상 " + t + "명 중 " + n + "명이 응답하여 응답률 " + pct(n, t) + "%임.");
  else L.push("- 총 " + n + "명이 응답하였음.");
  if (n === 0) {
    L.push("- 접수된 응답이 없었음.");
    return L;
  }

  const scales = agg.questions.filter((q): q is ScaleAgg => q.type === "scale5");
  const scales10 = agg.questions.filter((q): q is Scale10Agg => q.type === "scale10");
  const choices = agg.questions.filter((q): q is ChoiceAgg => q.type === "single" || q.type === "multi");
  const texts = agg.questions.filter((q): q is TextAgg => q.type === "text");
  let sec = 2;

  if (scales.length) {
    L.push("");
    L.push(sec++ + ". 만족도 및 평가 문항(5점 척도)");
    for (const q of scales) {
      if (!q.valid) {
        L.push("- ‘" + q.text + "’ 문항은 응답이 없었음.");
        continue;
      }
      L.push(
        "- ‘" + q.text + "’ 문항은 평균 " + q.mean + "점(5점 만점), 긍정 응답(4~5점) 비율 " + q.posPct + "%(" + q.pos + "/" + q.valid + "명)로 나타났음.",
      );
    }
  }
  if (scales10.length) {
    L.push("");
    L.push(sec++ + ". 점수 문항(10점 척도)");
    for (const q of scales10) {
      if (!q.valid) {
        L.push("- ‘" + q.text + "’ 문항은 응답이 없었음.");
        continue;
      }
      L.push("- ‘" + q.text + "’ 문항은 평균 " + q.mean + "점(10점 만점), 9~10점 응답 비율 " + q.topPct + "%(" + q.top + "/" + q.valid + "명)로 나타났음.");
    }
  }
  if (choices.length) {
    L.push("");
    L.push(sec++ + ". 선택형 문항");
    for (const q of choices) {
      const sorted = q.options
        .filter((o) => o.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);
      if (!sorted.length) {
        L.push("- ‘" + q.text + "’ 문항은 응답이 없었음.");
        continue;
      }
      const parts = sorted.map((o) => "‘" + o.label + "’ " + o.count + "명(" + o.pct + "%)");
      const tail = sorted.length === 1 ? "이 선택하였음" : " 순으로 나타났음";
      L.push("- ‘" + q.text + "’ 문항은 " + parts.join(", ") + tail + (q.type === "multi" ? "(복수응답)." : "."));
    }
  }
  if (texts.length) {
    L.push("");
    L.push(sec++ + ". 서술형 의견");
    for (const q of texts) L.push("- ‘" + q.text + "’ 문항에 총 " + q.texts.length + "건의 의견이 접수되었음.");
  }
  return L;
}
