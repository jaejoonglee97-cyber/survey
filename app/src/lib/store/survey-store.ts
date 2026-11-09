import { randomBytes } from "node:crypto";
import {
  aggregate,
  applyAutoFixes,
  effectiveState,
  kpiOf,
  LIMITS,
  normalizeAnswers,
  normalizeDeadline,
  parseDeadline,
  safeCell,
  SurveySpecSchema,
  unsafeCell,
  validateDraft,
  type Aggregate,
  type SurveySpec,
  type SurveyStatus,
  type ValidationReport,
} from "../survey-core";
import type { SheetsGateway } from "../sheets/gateway";
import { FIXED_TABS, planFixedTabs, RESPONSE_TAB_PREFIX, type TabPlan } from "../sheets/schema";

// 설문 저장소: 스프레드시트의 탭을 설문·응답·직원·집계 데이터로 다룸.
// 화면과 API 는 이 클래스만 쓰고 시트 구조를 직접 알지 않음.

export type StaffRole = "admin" | "viewer";

export interface SurveyRecord {
  id: string;
  spec: SurveySpec;
  /** 저장된 상태. 실제 상태는 state(마감 시각 반영) */
  status: SurveyStatus;
  state: SurveyStatus;
  createdBy: string;
  createdAt: string;
  publishedAt: string;
  closedAt: string;
  closedNotifiedAt: string;
}

export type SubmitResult =
  | { code: "ok" }
  | { code: "notfound" }
  | { code: "closed" }
  | { code: "full" }
  | { code: "invalid"; error: string; questionId?: string };

export type StoreResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

export interface ResponseSet {
  /** 문항 순서의 셀(제출 시각 제외) */
  rows: string[][];
  submittedAt: string[];
}

export interface SummaryRow {
  surveyId: string;
  n: number;
  dist: [number, number, number, number, number] | null;
  mean: number | null;
  positiveRate: number | null;
  updatedAt: string;
}

const SURVEY_COLS = FIXED_TABS.surveys;
const col = (name: (typeof SURVEY_COLS)[number]) => SURVEY_COLS.indexOf(name);

/** 한국시간 'YYYY-MM-DD HH:mm:ss' */
export function formatKst(d: Date): string {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19);
}

/**
 * 응답 제출 시각은 시(時) 단위로만 기록함('YYYY-MM-DD HH:00').
 * 초 단위로 남기면 현장에서 누가 언제 냈는지 본 사람이 서술 의견과 사람을 짝지을 수 있어 무기명 원칙이 약해짐.
 */
export function submittedHour(d: Date): string {
  return formatKst(d).slice(0, 13) + ":00";
}

/** 응답 수 상한: 대상 인원이 있으면 그 3배(최소 50), 없으면 기본 상한 */
export function responseCap(target: number | undefined, max: number): number {
  return target ? Math.min(max, Math.max(50, target * 3)) : max;
}

export function responseTabName(slug: string): string {
  return RESPONSE_TAB_PREFIX + slug;
}

/** 응답 탭 머리글: 제출 시각 + 'Q1 질문 문구'(사람이 시트에서 읽기 쉽게) */
export function responseHeader(spec: SurveySpec): string[] {
  return ["submitted_at", ...spec.questions.map((q) => safeCell(`${q.id} ${q.text}`.slice(0, 120)))];
}

const ok = <T>(value: T): StoreResult<T> => ({ ok: true, value });
const fail = <T = never>(error: string): StoreResult<T> => ({ ok: false, error });

export interface StoreOptions {
  now?: () => Date;
  /** 설문 목록 캐시 시간(ms). 공개 응답 경로의 읽기 호출을 줄임. 시험에서는 0 */
  cacheMs?: number;
  newId?: () => string;
  /** 설문당 응답 수 상한(기본 LIMITS.maxResponsesPerSurvey) */
  maxResponses?: number;
}

export class SurveyStore {
  private readonly now: () => Date;
  private readonly cacheMs: number;
  private readonly newId: () => string;
  private readonly maxResponses: number;
  private cache: { at: number; rows: string[][] } | null = null;

  constructor(
    private readonly gw: SheetsGateway,
    opts: StoreOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.cacheMs = opts.cacheMs ?? 15_000;
    this.newId = opts.newId ?? (() => "s_" + randomBytes(6).toString("hex"));
    this.maxResponses = opts.maxResponses ?? LIMITS.maxResponsesPerSurvey;
  }

  // ───────── 탭 준비 ─────────

  async planTabs(): Promise<TabPlan[]> {
    const tabs = await this.gw.listTabs();
    const existing = await Promise.all(
      tabs.filter((t) => t in FIXED_TABS).map(async (title) => ({ title, header: (await this.gw.readAll(title))[0] ?? [] })),
    );
    return planFixedTabs(existing);
  }

  /** 없는 고정 탭을 만들고 빈 탭에 머리글을 씀. 다른 머리글은 덮어쓰지 않음 */
  async ensureTabs(): Promise<TabPlan[]> {
    const plan = await this.planTabs();
    for (const p of plan) {
      if (p.action === "create") await this.gw.addTab(p.tab, [...FIXED_TABS[p.tab]]);
      else if (p.action === "write_header") await this.gw.updateRow(p.tab, 1, [...FIXED_TABS[p.tab]]);
    }
    return plan;
  }

  // ───────── 설문 읽기 ─────────

  private async surveyRows(fresh = false): Promise<string[][]> {
    const t = this.now().getTime();
    if (!fresh && this.cache && t - this.cache.at < this.cacheMs) return this.cache.rows;
    const all = await this.gw.readAll("surveys");
    const rows = all.slice(1);
    this.cache = { at: t, rows };
    return rows;
  }

  private invalidate() {
    this.cache = null;
  }

  private toRecord(r: string[]): SurveyRecord | null {
    const get = (c: (typeof SURVEY_COLS)[number]) => r[col(c)] ?? "";
    let spec: SurveySpec;
    try {
      const questions = JSON.parse(get("questions_json") || "[]");
      const target = get("target") ? Number(get("target")) : undefined;
      const parsed = SurveySpecSchema.safeParse({
        title: unsafeCell(get("title")),
        slug: get("slug"),
        category: unsafeCell(get("category")),
        program: unsafeCell(get("program")),
        year: Number(get("year")),
        deadline: get("deadline"),
        ...(target ? { target } : {}),
        intro: unsafeCell(get("intro")),
        questions,
        kpiQuestionId: get("kpi_question_id") || null,
      });
      if (!parsed.success) return null;
      spec = parsed.data;
    } catch {
      return null;
    }
    const status = get("status") as SurveyStatus;
    if (!["draft", "open", "closed"].includes(status)) return null;
    return {
      id: get("id"),
      spec,
      status,
      state: effectiveState(status, spec.deadline, this.now()),
      createdBy: get("created_by"),
      createdAt: get("created_at"),
      publishedAt: get("published_at"),
      closedAt: get("closed_at"),
      closedNotifiedAt: get("closed_notified_at"),
    };
  }

  private toRow(rec: Omit<SurveyRecord, "state">): string[] {
    const s = rec.spec;
    const values: Record<(typeof SURVEY_COLS)[number], string> = {
      id: rec.id,
      slug: s.slug,
      title: safeCell(s.title),
      category: safeCell(s.category),
      program: safeCell(s.program),
      year: String(s.year),
      deadline: s.deadline,
      target: s.target ? String(s.target) : "",
      intro: safeCell(s.intro),
      questions_json: JSON.stringify(s.questions),
      kpi_question_id: s.kpiQuestionId ?? "",
      status: rec.status,
      created_by: safeCell(rec.createdBy),
      created_at: rec.createdAt,
      published_at: rec.publishedAt,
      closed_at: rec.closedAt,
      closed_notified_at: rec.closedNotifiedAt,
    };
    return SURVEY_COLS.map((c) => values[c]);
  }

  /** 모든 설문(읽을 수 없는 행은 건너뜀). 최근 마감 순 */
  async listSurveys(opts: { fresh?: boolean } = {}): Promise<SurveyRecord[]> {
    const rows = await this.surveyRows(opts.fresh ?? true);
    return rows
      .map((r) => this.toRecord(r))
      .filter((r): r is SurveyRecord => r !== null)
      .sort((a, b) => (a.spec.deadline < b.spec.deadline ? 1 : a.spec.deadline > b.spec.deadline ? -1 : 0));
  }

  async getById(id: string): Promise<SurveyRecord | null> {
    return (await this.listSurveys()).find((s) => s.id === id) ?? null;
  }

  /** 공개 경로용(짧은 캐시 사용) */
  async getBySlug(slug: string, opts: { fresh?: boolean } = {}): Promise<SurveyRecord | null> {
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(slug)) return null;
    const rows = await this.surveyRows(opts.fresh ?? false);
    for (const r of rows) {
      if (r[col("slug")] !== slug) continue;
      return this.toRecord(r);
    }
    return null;
  }

  /** 공개 응답 화면에 보여 줄 설문: 진행 중인 것만 */
  async getOpenBySlug(slug: string): Promise<SurveyRecord | null> {
    const s = await this.getBySlug(slug);
    return s && s.state === "open" ? s : null;
  }

  private async rowIndexOf(id: string): Promise<number> {
    const rows = await this.surveyRows(true);
    const i = rows.findIndex((r) => r[col("id")] === id);
    return i < 0 ? -1 : i + 2; // 머리글 1행 + 0부터 센 위치
  }

  private async write(rec: Omit<SurveyRecord, "state">): Promise<void> {
    const row = await this.rowIndexOf(rec.id);
    if (row < 0) throw new Error("설문을 찾을 수 없음");
    await this.gw.updateRow("surveys", row, this.toRow(rec));
    this.invalidate();
  }

  // ───────── 설문 만들기·고치기·게시 ─────────

  async createDraft(spec: SurveySpec, createdBy: string): Promise<StoreResult<SurveyRecord>> {
    const check = validateDraft(spec);
    const metaErr = check.issues.find((i) => i.code === "META" && i.level === "error");
    if (metaErr) return fail(metaErr.message);
    if ((await this.listSurveys()).some((s) => s.spec.slug === spec.slug)) return fail("이미 쓰고 있는 링크 주소(slug)임: " + spec.slug);
    const rec = {
      id: this.newId(),
      spec,
      status: "draft" as const,
      createdBy,
      createdAt: formatKst(this.now()),
      publishedAt: "",
      closedAt: "",
      closedNotifiedAt: "",
    };
    await this.gw.append("surveys", [this.toRow(rec)]);
    this.invalidate();
    return ok({ ...rec, state: "draft" });
  }

  /** 게시 전 초안만 고칠 수 있음(게시 후 문항은 응답 열과 묶여 바꾸지 않음) */
  async updateDraft(id: string, spec: SurveySpec): Promise<StoreResult<SurveyRecord>> {
    const cur = await this.getById(id);
    if (!cur) return fail("설문을 찾을 수 없음");
    if (cur.status !== "draft") return fail("게시된 설문의 문항은 바꿀 수 없음");
    const metaErr = validateDraft(spec).issues.find((i) => i.code === "META" && i.level === "error");
    if (metaErr) return fail(metaErr.message);
    if (spec.slug !== cur.spec.slug && (await this.listSurveys()).some((s) => s.spec.slug === spec.slug)) {
      return fail("이미 쓰고 있는 링크 주소(slug)임: " + spec.slug);
    }
    const next = { ...cur, spec };
    await this.write(next);
    return ok(next);
  }

  /** 담당자가 확정·게시: 점검 오류가 없고 마감일이 미래여야 함. 응답 탭을 만듦 */
  async publish(id: string): Promise<StoreResult<{ record: SurveyRecord; report: ValidationReport }>> {
    const cur = await this.getById(id);
    if (!cur) return fail("설문을 찾을 수 없음");
    if (cur.status !== "draft") return fail("이미 게시된 설문임");
    const spec = applyAutoFixes(cur.spec);
    const report = validateDraft(spec);
    if (!report.canConfirm) return fail("점검 오류가 있어 게시할 수 없음: " + report.issues.filter((i) => i.level === "error").map((i) => i.message).join("; "));
    const d = parseDeadline(spec.deadline);
    if (!d || d.getTime() <= this.now().getTime()) return fail("마감일이 이미 지났음");

    const tab = responseTabName(spec.slug);
    const tabs = await this.gw.listTabs();
    if (tabs.includes(tab)) {
      const existing = await this.gw.readAll(tab);
      if (existing.length > 1) return fail(`응답 탭(${tab})에 이미 데이터가 있음. 시트에서 확인할 것`);
      await this.gw.deleteTab(tab);
    }
    await this.gw.addTab(tab, responseHeader(spec));
    const next = { ...cur, spec, status: "open" as const, publishedAt: formatKst(this.now()) };
    await this.write(next);
    return ok({ record: { ...next, state: effectiveState("open", spec.deadline, this.now()) }, report });
  }

  // ───────── 마감 관리 ─────────

  /**
   * 마감일 변경. 연장하면 결과 메일 발송 기록을 지워 다시 마감될 때 다시 보냄.
   * 담당자가 직접 마감한(closed) 설문은 상태를 바꾸지 않음(재개방은 setStatus).
   */
  async setDeadline(id: string, deadline: string): Promise<StoreResult<SurveyRecord>> {
    const nd = normalizeDeadline(deadline);
    if (!nd) return fail("마감일 형식이 올바르지 않음(YYYY-MM-DD HH:mm)");
    const cur = await this.getById(id);
    if (!cur) return fail("설문을 찾을 수 없음");
    const extended = parseDeadline(nd)!.getTime() > this.now().getTime();
    const next = {
      ...cur,
      spec: { ...cur.spec, deadline: nd },
      closedNotifiedAt: extended && cur.status !== "closed" ? "" : cur.closedNotifiedAt,
      closedAt: extended && cur.status !== "closed" ? "" : cur.closedAt,
    };
    await this.write(next);
    return ok({ ...next, state: effectiveState(next.status, nd, this.now()) });
  }

  /** 지금 마감(closed) 또는 재개방(open). 재개방은 마감일이 미래일 때만 */
  async setStatus(id: string, status: "open" | "closed"): Promise<StoreResult<SurveyRecord>> {
    const cur = await this.getById(id);
    if (!cur) return fail("설문을 찾을 수 없음");
    if (cur.status === "draft") return fail("게시 전 설문임");
    if (status === "open") {
      const d = parseDeadline(cur.spec.deadline);
      if (!d || d.getTime() <= this.now().getTime()) return fail("마감일이 지난 설문은 먼저 마감일을 연장해야 함");
    }
    const next = {
      ...cur,
      status,
      closedAt: status === "closed" ? cur.closedAt || formatKst(this.now()) : "",
      closedNotifiedAt: status === "open" ? "" : cur.closedNotifiedAt,
    };
    await this.write(next);
    return ok({ ...next, state: effectiveState(status, cur.spec.deadline, this.now()) });
  }

  /** 마감되었는데 아직 결과 메일을 보내지 않은 설문 */
  async listClosedUnnotified(): Promise<SurveyRecord[]> {
    return (await this.listSurveys()).filter((s) => s.state === "closed" && s.status !== "draft" && !s.closedNotifiedAt);
  }

  async markClosedNotified(id: string): Promise<StoreResult<SurveyRecord>> {
    const cur = await this.getById(id);
    if (!cur) return fail("설문을 찾을 수 없음");
    const t = formatKst(this.now());
    const next = { ...cur, closedAt: cur.closedAt || t, closedNotifiedAt: t };
    await this.write(next);
    return ok(next);
  }

  /** 응답이 없는 설문만 삭제(응답 탭 포함) */
  async deleteSurvey(id: string): Promise<StoreResult> {
    const cur = await this.getById(id);
    if (!cur) return fail("설문을 찾을 수 없음");
    const tab = responseTabName(cur.spec.slug);
    const hasTab = cur.status !== "draft" && (await this.gw.listTabs()).includes(tab);
    if (hasTab && (await this.gw.readAll(tab)).length > 1) return fail("응답이 있는 설문은 삭제할 수 없음");
    if (hasTab) await this.gw.deleteTab(tab);
    const row = await this.rowIndexOf(id);
    if (row > 0) await this.gw.deleteRow("surveys", row);
    this.invalidate();
    // 같은 사업의 집계 캐시도 정리
    await this.deleteSummary(id);
    return ok(undefined);
  }

  // ───────── 응답 ─────────

  /** 공개 응답 제출: 마감 확인(제출 순간 기준) → 검증 → 행 추가. IP·기기 정보는 저장하지 않음 */
  async submitResponse(slug: string, answers: unknown): Promise<SubmitResult> {
    const s = await this.getBySlug(slug);
    if (!s || s.status === "draft") return { code: "notfound" };
    if (s.state !== "open") return { code: "closed" };
    const r = normalizeAnswers(s.spec, answers);
    if (!r.ok) return { code: "invalid", error: r.error, ...(r.questionId ? { questionId: r.questionId } : {}) };
    // 검증 사이에 마감 시각이 지났을 수 있어 쓰기 직전에 다시 확인
    if (effectiveState(s.status, s.spec.deadline, this.now()) !== "open") return { code: "closed" };
    const tab = responseTabName(slug);
    const count = (await this.gw.countRows([tab]))[tab] ?? 0;
    if (count >= responseCap(s.spec.target, this.maxResponses)) return { code: "full" };
    await this.gw.append(responseTabName(slug), [[submittedHour(this.now()), ...r.row]]);
    return { code: "ok" };
  }

  async readResponses(rec: Pick<SurveyRecord, "spec" | "status">): Promise<ResponseSet> {
    if (rec.status === "draft") return { rows: [], submittedAt: [] };
    const tab = responseTabName(rec.spec.slug);
    const all = await this.gw.readAll(tab);
    const header = all[0] ?? [];
    const expected = responseHeader(rec.spec);
    const ids = header.slice(1).map((h) => unsafeCell(h).split(" ")[0]);
    const want = rec.spec.questions.map((q) => q.id);
    if (header[0] !== "submitted_at" || ids.join(",") !== want.join(",")) {
      throw new Error(`응답 탭(${tab})의 머리글이 문항과 맞지 않음. 시트에서 열을 옮기거나 지우지 않았는지 확인할 것`);
    }
    const width = expected.length;
    const rows = all.slice(1).filter((r) => r.some((c) => c !== ""));
    return {
      submittedAt: rows.map((r) => r[0] ?? ""),
      rows: rows.map((r) => Array.from({ length: width - 1 }, (_, i) => r[i + 1] ?? "")),
    };
  }

  /** 여러 설문의 응답 수(한 번의 요청). 초안·응답 탭 없음은 0 */
  async responseCounts(recs: Pick<SurveyRecord, "id" | "spec" | "status">[]): Promise<Map<string, number>> {
    const tabs = new Set(await this.gw.listTabs());
    const targets = recs.filter((r) => r.status !== "draft" && tabs.has(responseTabName(r.spec.slug)));
    const counts = await this.gw.countRows(targets.map((r) => responseTabName(r.spec.slug)));
    return new Map(recs.map((r) => [r.id, counts[responseTabName(r.spec.slug)] ?? 0]));
  }

  async countResponses(rec: Pick<SurveyRecord, "spec" | "status">): Promise<number> {
    return (await this.readResponses(rec)).rows.length;
  }

  async aggregateSurvey(rec: SurveyRecord): Promise<Aggregate> {
    return aggregate(rec.spec, (await this.readResponses(rec)).rows);
  }

  // ───────── 직원 ─────────

  async getStaffRole(email: string): Promise<StaffRole | null> {
    const e = email.trim().toLowerCase();
    if (!e) return null;
    const rows = (await this.gw.readAll("staff")).slice(1);
    for (const r of rows) {
      if ((r[0] ?? "").trim().toLowerCase() !== e) continue;
      const active = (r[2] ?? "").trim().toLowerCase();
      if (!["true", "y", "yes", "1", "o", "예"].includes(active)) return null;
      const role = (r[1] ?? "").trim().toLowerCase();
      return role === "admin" || role === "viewer" ? role : null;
    }
    return null;
  }

  async addStaff(email: string, role: StaffRole): Promise<StoreResult> {
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return fail("이메일 형식이 올바르지 않음");
    const rows = (await this.gw.readAll("staff")).slice(1);
    const i = rows.findIndex((r) => (r[0] ?? "").trim().toLowerCase() === e);
    const values = [e, role, "TRUE", formatKst(this.now())];
    if (i >= 0) await this.gw.updateRow("staff", i + 2, values);
    else await this.gw.append("staff", [values]);
    return ok(undefined);
  }

  // ───────── 대표 문항 집계 캐시(summary 탭) ─────────

  /** 대표 문항 집계를 계산만 함(시트에 쓰지 않음) */
  async computeSummary(rec: SurveyRecord): Promise<SummaryRow> {
    const agg = await this.aggregateSurvey(rec);
    const k = kpiOf(rec.spec, agg);
    return {
      surveyId: rec.id,
      n: agg.n,
      dist: k ? k.dist : null,
      mean: k && k.valid ? k.mean : null,
      positiveRate: k && k.valid ? k.posPct : null,
      updatedAt: formatKst(this.now()),
    };
  }

  /** 계산해서 summary 탭에 기록 */
  async refreshSummary(rec: SurveyRecord): Promise<SummaryRow> {
    const row = await this.computeSummary(rec);
    const values = [
      row.surveyId,
      String(row.n),
      ...(row.dist ? row.dist.map(String) : ["", "", "", "", ""]),
      row.mean === null ? "" : String(row.mean),
      row.positiveRate === null ? "" : String(row.positiveRate),
      row.updatedAt,
    ];
    const rows = (await this.gw.readAll("summary")).slice(1);
    const i = rows.findIndex((r) => r[0] === rec.id);
    if (i >= 0) await this.gw.updateRow("summary", i + 2, values);
    else await this.gw.append("summary", [values]);
    return row;
  }

  async readSummaries(): Promise<Map<string, SummaryRow>> {
    const rows = (await this.gw.readAll("summary")).slice(1);
    const out = new Map<string, SummaryRow>();
    for (const r of rows) {
      if (!r[0]) continue;
      const d = r.slice(2, 7);
      const hasDist = d.length === 5 && d.every((x) => x !== "" && Number.isInteger(Number(x)));
      out.set(r[0], {
        surveyId: r[0],
        n: Number(r[1] ?? 0) || 0,
        dist: hasDist ? (d.map(Number) as SummaryRow["dist"]) : null,
        mean: r[7] ? Number(r[7]) : null,
        positiveRate: r[8] ? Number(r[8]) : null,
        updatedAt: r[9] ?? "",
      });
    }
    return out;
  }

  private async deleteSummary(id: string) {
    const rows = (await this.gw.readAll("summary")).slice(1);
    const i = rows.findIndex((r) => r[0] === id);
    if (i >= 0) await this.gw.deleteRow("summary", i + 2);
  }
}
