import { canAccess, isAllowedEmail, type Role } from "../auth/policy";
import type { SurveyStore } from "../store/survey-store";
import { koreaYear, SurveySpecSchema, type SurveySpec } from "../survey-core";
import { defaultDeadline } from "./editor-ops";

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

// ───────── 시험 데이터 정리 ─────────

/** 고른 시험 설문을 응답까지 지움. 시험 설문이 아닌 것이 섞여 있으면 그것만 건너뜀 */
export async function purgeTestSurveys(
  store: SurveyStore,
  actor: Actor | null,
  ids: unknown,
): Promise<ActionResult<{ surveys: number; responses: number; skipped: number }>> {
  if (!guard(actor)) return FORBIDDEN;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || !ids.every((x) => typeof x === "string" && ID_RE.test(x))) {
    return { ok: false, error: "요청이 올바르지 않음" };
  }
  let surveys = 0;
  let responses = 0;
  let skipped = 0;
  for (const id of ids as string[]) {
    const r = await store.purgeTestSurvey(id);
    if (r.ok) {
      surveys++;
      responses += r.value.responses;
    } else skipped++;
  }
  return { ok: true, value: { surveys, responses, skipped } };
}

// ───────── 복제 ─────────

/** 설문을 복제해 새 초안을 만듦(문항·사업명·분류·안내문·대상 인원 유지, 마감일은 14일 뒤, 연도는 올해) */
export async function duplicateSurvey(store: SurveyStore, actor: Actor | null, id: string, now: Date = new Date()): Promise<ActionResult<{ id: string }>> {
  if (!guard(actor)) return FORBIDDEN;
  if (!ID_RE.test(id)) return { ok: false, error: "설문을 찾을 수 없음" };
  const cur = await store.getById(id);
  if (!cur) return { ok: false, error: "설문을 찾을 수 없음" };
  const taken = new Set((await store.listSurveys()).map((s) => s.spec.slug));
  const base = cur.spec.slug.replace(/-copy\d*$/, "").slice(0, 33);
  let slug = `${base}-copy`;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-copy${n}`;
  const title = `${cur.spec.title.replace(/ \(복사본\)$/, "")} (복사본)`.slice(0, 100);
  const r = await store.createDraft(
    { ...cur.spec, title, slug, deadline: defaultDeadline(now), year: koreaYear(now), questions: cur.spec.questions.map((q) => ({ ...q })) },
    actor.email,
  );
  return r.ok ? { ok: true, value: { id: r.value.id } } : r;
}

// ───────── 직원 관리 ─────────

const EMAIL_RE = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;

/** 직원 추가(이미 있으면 역할을 바꾸고 다시 활성). 허용 도메인 밖이면 로그인할 수 없다는 안내를 함께 돌려줌 */
export async function addStaffMember(
  store: SurveyStore,
  actor: Actor | null,
  email: unknown,
  role: unknown,
  allowedDomain?: string,
): Promise<ActionResult<{ warning?: string }>> {
  if (!guard(actor)) return FORBIDDEN;
  const e = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(e) || e.length > 120) return { ok: false, error: "이메일 형식이 올바르지 않음" };
  if (role !== "admin" && role !== "viewer") return { ok: false, error: "역할이 올바르지 않음" };
  const r = await store.addStaff(e, role);
  if (!r.ok) return r;
  const domain = (allowedDomain ?? "").trim();
  const warning = domain && !isAllowedEmail(e, domain) ? `허용 도메인(${domain}) 밖의 주소라 구글 로그인을 할 수 없음` : undefined;
  return { ok: true, value: warning ? { warning } : {} };
}

/** 역할·활성 변경. 자기 자신은 낮추거나 끌 수 없고, 활성 담당자가 한 명은 남아 있어야 함 */
export async function changeStaffMember(
  store: SurveyStore,
  actor: Actor | null,
  email: unknown,
  patch: unknown,
): Promise<ActionResult> {
  if (!guard(actor)) return FORBIDDEN;
  const e = typeof email === "string" ? email.trim().toLowerCase() : "";
  const p = (patch ?? {}) as { role?: unknown; active?: unknown };
  const role = p.role === undefined ? undefined : p.role === "admin" || p.role === "viewer" ? p.role : null;
  const active = p.active === undefined ? undefined : typeof p.active === "boolean" ? p.active : null;
  if (!e || role === null || active === null || (role === undefined && active === undefined)) return { ok: false, error: "요청이 올바르지 않음" };

  const list = await store.listStaff();
  const target = list.find((m) => m.email === e);
  if (!target) return { ok: false, error: "직원 목록에 없는 이메일임" };
  const losesAdmin = target.role === "admin" && target.active && (role === "viewer" || active === false);
  if (losesAdmin && e === actor.email.toLowerCase()) return { ok: false, error: "자기 자신의 담당자 권한은 낮추거나 끌 수 없음" };
  const activeAdmins = list.filter((m) => m.role === "admin" && m.active).length;
  if (losesAdmin && activeAdmins <= 1) return { ok: false, error: "활성 담당자가 최소 한 명은 있어야 함" };
  return store.updateStaff(e, { ...(role ? { role } : {}), ...(active !== undefined ? { active } : {}) });
}
