import { canAccess, type Role } from "../auth/policy";
import type { SurveyStore } from "../store/survey-store";
import { SurveySpecSchema, type SurveySpec } from "../survey-core";

// 담당자 동작(서버 동작의 본체). 모든 동작이 권한을 서버에서 다시 확인함.
// 화면(서버 액션)은 이 함수를 감싸기만 함 → 권한·입력 검증을 시험으로 고정할 수 있음.

export type ActionResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

export interface Actor {
  email: string;
  role: Role;
}

const FORBIDDEN = { ok: false as const, error: "권한이 없음" };
const ID_RE = /^s_[a-z0-9]{4,40}$/;

function guard(actor: Actor | null): actor is Actor {
  return !!actor && canAccess(actor.role, "admin");
}

function parseSpec(raw: unknown): ActionResult<SurveySpec> {
  const r = SurveySpecSchema.safeParse(raw);
  if (!r.success) return { ok: false, error: "설문 내용 형식이 올바르지 않음" };
  return { ok: true, value: r.data };
}

export async function saveDraft(store: SurveyStore, actor: Actor | null, id: string | null, rawSpec: unknown): Promise<ActionResult<{ id: string }>> {
  if (!guard(actor)) return FORBIDDEN;
  const spec = parseSpec(rawSpec);
  if (!spec.ok) return spec;
  if (id === null) {
    const r = await store.createDraft(spec.value, actor.email);
    return r.ok ? { ok: true, value: { id: r.value.id } } : r;
  }
  if (!ID_RE.test(id)) return { ok: false, error: "설문을 찾을 수 없음" };
  const r = await store.updateDraft(id, spec.value);
  return r.ok ? { ok: true, value: { id } } : r;
}

export async function publishSurvey(store: SurveyStore, actor: Actor | null, id: string): Promise<ActionResult<{ slug: string }>> {
  if (!guard(actor)) return FORBIDDEN;
  if (!ID_RE.test(id)) return { ok: false, error: "설문을 찾을 수 없음" };
  const r = await store.publish(id);
  if (!r.ok) return r;
  await store.refreshSummary(r.value.record);
  return { ok: true, value: { slug: r.value.record.spec.slug } };
}

export async function changeDeadline(store: SurveyStore, actor: Actor | null, id: string, deadline: unknown): Promise<ActionResult> {
  if (!guard(actor)) return FORBIDDEN;
  if (!ID_RE.test(id) || typeof deadline !== "string") return { ok: false, error: "요청이 올바르지 않음" };
  const r = await store.setDeadline(id, deadline);
  return r.ok ? { ok: true, value: undefined } : r;
}

export async function changeStatus(store: SurveyStore, actor: Actor | null, id: string, status: unknown): Promise<ActionResult> {
  if (!guard(actor)) return FORBIDDEN;
  if (!ID_RE.test(id) || (status !== "open" && status !== "closed")) return { ok: false, error: "요청이 올바르지 않음" };
  const r = await store.setStatus(id, status);
  if (!r.ok) return r;
  await store.refreshSummary(r.value);
  return { ok: true, value: undefined };
}

export async function removeSurvey(store: SurveyStore, actor: Actor | null, id: string): Promise<ActionResult> {
  if (!guard(actor)) return FORBIDDEN;
  if (!ID_RE.test(id)) return { ok: false, error: "설문을 찾을 수 없음" };
  return store.deleteSurvey(id);
}
