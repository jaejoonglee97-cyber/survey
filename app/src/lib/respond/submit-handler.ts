import type { SurveyStore } from "../store/survey-store";
import type { SlidingWindowLimiter } from "./rate-limit";

// 공개 응답 제출 처리(프레임워크와 분리해 시험 가능하게 둠).
// 요청 크기·형식 검사 → 저장소의 검증·마감 확인 → 응답자용 문구로 변환.
// 요청 본문·IP·기기 정보는 저장하거나 로그에 남기지 않음.

export const MAX_BODY_BYTES = 20 * 1024;

export interface SubmitResponseBody {
  ok: boolean;
  /** 응답자에게 보여 줄 문구(합쇼체) */
  message?: string;
  closed?: boolean;
  questionId?: string;
}

const json = (status: number, body: SubmitResponseBody) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

async function readLimited(req: Request, limit: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > limit) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function handleSubmit(
  store: SurveyStore,
  slug: string,
  req: Request,
  limiters?: { perSurvey: SlidingWindowLimiter; global: SlidingWindowLimiter },
): Promise<Response> {
  // 요청이 한꺼번에 몰리면(자동 스크립트 등) 시트 한도를 지키기 위해 잠시 거절함
  if (limiters && (!limiters.global.allow("all") || !limiters.perSurvey.allow(slug))) {
    return json(429, { ok: false, message: "지금 응답이 몰리고 있습니다. 잠시 후 다시 제출해 주십시오. 입력한 내용은 유지됩니다." });
  }
  // JSON 이 아닌 요청(다른 사이트의 폼 전송 등)은 받지 않음
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().startsWith("application/json")) {
    return json(415, { ok: false, message: "요청 형식이 올바르지 않습니다." });
  }
  const text = await readLimited(req, MAX_BODY_BYTES);
  if (text === null) return json(413, { ok: false, message: "응답 내용이 너무 깁니다. 서술 응답을 줄여 주십시오." });

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { ok: false, message: "요청 형식이 올바르지 않습니다." });
  }
  const answers = (body as { answers?: unknown } | null)?.answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return json(400, { ok: false, message: "요청 형식이 올바르지 않습니다." });
  }

  try {
    const r = await store.submitResponse(slug, answers);
    switch (r.code) {
      case "ok":
        return json(200, { ok: true });
      case "notfound":
        return json(404, { ok: false, message: "설문을 찾을 수 없습니다. 안내받은 링크를 다시 확인해 주십시오." });
      case "full":
        return json(409, { ok: false, message: "이 설문은 받을 수 있는 응답 수를 모두 채워 더 이상 응답할 수 없습니다." });
      case "closed":
        return json(409, { ok: false, closed: true, message: "마감된 설문입니다." });
      case "invalid": {
        const s = await store.getBySlug(slug);
        const no = s && r.questionId ? s.spec.questions.findIndex((q) => q.id === r.questionId) + 1 : 0;
        const message = no > 0 ? `${no}번 문항의 응답을 확인해 주십시오.` : "응답 내용을 확인해 주십시오.";
        return json(422, { ok: false, message, ...(r.questionId ? { questionId: r.questionId } : {}) });
      }
    }
  } catch {
    // 오류 내용(시트 정보 등)은 응답자에게 보내지 않음
    return json(503, { ok: false, message: "일시적인 문제로 제출하지 못했습니다. 잠시 후 다시 시도해 주십시오. 입력한 내용은 유지됩니다." });
  }
}
