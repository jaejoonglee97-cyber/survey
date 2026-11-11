import { importMd, parseDeadline, type Question, type RawAnswers, type SurveySpec } from "../survey-core";
import type { SheetsGateway } from "../sheets/gateway";
import { FIXED_TABS, RESPONSE_TAB_PREFIX } from "../sheets/schema";
import { SurveyStore } from "./survey-store";

// 더미 데이터 생성. 실제 사람으로 보이는 이름·연락처는 쓰지 않음. 서술 의견에는 '(더미)' 표시를 붙임.
// 같은 seed 값이면 같은 데이터가 만들어짐(재현 가능).

export interface SeedSurveyDef {
  md: string;
  overrides: Partial<SurveySpec>;
  responses: number;
  /** 1~5 점수 분포 가중치 */
  scoreWeights: [number, number, number, number, number];
  /** true 면 게시하지 않고 초안으로 둠 */
  draft?: boolean;
  /** 결과 메일을 이미 보낸 것으로 기록 */
  notified?: boolean;
}

const DUMMY_OPINIONS = [
  "일정이 조금 더 여유로웠으면 좋겠음(더미)",
  "프로그램 구성이 알찼음(더미)",
  "안내 자료를 미리 받으면 좋겠음(더미)",
  "장소 접근성이 아쉬웠음(더미)",
  "다음에도 참여하고 싶음(더미)",
  "진행이 매끄러웠음(더미)",
  "=1+1 (수식 주입 시험용 더미)",
];

/** 재현 가능한 난수(mulberry32) */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(rand: () => number, weights: readonly number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let x = rand() * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x < 0) return i;
  }
  return weights.length - 1;
}

/** 문항 규칙에 맞는 임의 응답 */
export function randomAnswers(questions: Question[], rand: () => number, scoreWeights: readonly number[]): RawAnswers {
  const out: RawAnswers = {};
  for (const q of questions) {
    if (!q.required && rand() < 0.3) continue;
    if (q.type === "scale5") out[q.id] = pickWeighted(rand, scoreWeights) + 1;
    // 10점 척도는 5단계 가중치를 두 칸씩 나눠 씀(1~2, 3~4, …, 9~10)
    else if (q.type === "scale10") out[q.id] = pickWeighted(rand, scoreWeights) * 2 + 1 + (rand() < 0.5 ? 0 : 1);
    else if (q.type === "text") out[q.id] = DUMMY_OPINIONS[Math.floor(rand() * DUMMY_OPINIONS.length)];
    else {
      const opts = q.options ?? [];
      const asValue = (i: number) => (opts[i].other ? `${opts[i].label}: 기타 응답 ${i + 1}(더미)` : opts[i].label);
      if (q.type === "single") out[q.id] = asValue(Math.floor(rand() * opts.length));
      else {
        const k = 1 + Math.floor(rand() * Math.min(q.max || opts.length, opts.length));
        const idx = [...opts.keys()].sort(() => rand() - 0.5).slice(0, k);
        out[q.id] = idx.map(asValue);
      }
    }
  }
  return out;
}

export function defaultSeedSurveys(healingMd: string, eventMd: string): SeedSurveyDef[] {
  const ev = (slug: string, program: string, category: string, deadline: string, target?: number) =>
    eventMd
      .replace(/title: .*/, `title: ${program} 만족도 설문`)
      .replace(/slug: .*/, `slug: ${slug}`)
      .replace(/category: .*/, `category: ${category}`)
      .replace(/program: .*/, `program: ${program}`)
      .replace(/deadline: .*/, `deadline: ${deadline}`)
      .replace(/target:.*/, target ? `target: ${target}` : "target:");
  return [
    {
      md: healingMd,
      overrides: { title: "2025 서울사회복지사 힐링캠프 만족도 설문", slug: "healing2025", year: 2025, deadline: "2025-12-10 23:59", target: 40 },
      responses: 32,
      scoreWeights: [1, 2, 6, 14, 10],
      notified: true,
    },
    {
      md: healingMd,
      overrides: { deadline: "2026-12-10 23:59" },
      responses: 18,
      scoreWeights: [0, 1, 3, 10, 12],
    },
    {
      md: ev("ai-edu-2026", "AI 활용 실무 교육", "교육", "2026-10-20 18:00", 60),
      overrides: { title: "2026 AI 활용 실무 교육 만족도 설문" },
      responses: 45,
      scoreWeights: [1, 3, 8, 18, 15],
      notified: true,
    },
    {
      md: ev("party2025", "회원 송년회", "행사", "2025-12-28 23:59", 30),
      overrides: { title: "2025 회원 송년회 만족도 설문" },
      responses: 4,
      scoreWeights: [0, 0, 1, 2, 2],
      notified: true,
    },
    {
      md: ev("meeting2026", "직원 간담회", "행사", "2026-12-20 18:00"),
      overrides: { title: "2026 직원 간담회 만족도 설문(초안)" },
      responses: 0,
      scoreWeights: [1, 1, 1, 1, 1],
      draft: true,
    },
  ];
}

export interface SeedOptions {
  now: Date;
  seed?: number;
  staff?: { email: string; role: "admin" | "viewer" }[];
}

export interface SeedReport {
  surveys: { slug: string; status: string; responses: number }[];
  staff: number;
}

/** 탭을 비우고(응답 탭 삭제, 고정 탭은 머리글만 남김) 처음 상태로 되돌림 */
export async function resetData(gw: SheetsGateway): Promise<void> {
  for (const t of await gw.listTabs()) {
    if (t.startsWith(RESPONSE_TAB_PREFIX)) await gw.deleteTab(t);
    else if (t in FIXED_TABS) await gw.clearBelowHeader(t);
  }
}

export async function seedDummy(gw: SheetsGateway, defs: SeedSurveyDef[], opts: SeedOptions): Promise<SeedReport> {
  const rand = seededRandom(opts.seed ?? 2026);
  let clock = opts.now;
  const store = new SurveyStore(gw, { now: () => clock, cacheMs: 0 });
  await store.ensureTabs();
  if ((await gw.readAll("surveys")).length > 1) throw new Error("surveys 탭에 이미 데이터가 있음. --reset 으로 비운 뒤 다시 실행할 것");

  const report: SeedReport = { surveys: [], staff: 0 };
  for (const def of defs) {
    const parsed = importMd(def.md);
    if (!parsed.ok) throw new Error("시드 md 오류: " + parsed.errors.join("; "));
    const spec: SurveySpec = { ...parsed.spec, ...def.overrides };
    if (!def.overrides.year) spec.year = Number(spec.deadline.slice(0, 4));
    const deadline = parseDeadline(spec.deadline)!;

    // 응답을 받던 시기로 시계를 돌려 게시·응답을 재현함
    const start = new Date(Math.min(deadline.getTime() - 7 * 86400_000, opts.now.getTime() - 86400_000));
    clock = start;
    const created = await store.createDraft(spec, "seed@example.org");
    if (!created.ok) throw new Error(created.error);
    if (def.draft) {
      report.surveys.push({ slug: spec.slug, status: "draft", responses: 0 });
      continue;
    }
    const pub = await store.publish(created.value.id);
    if (!pub.ok) throw new Error(`${spec.slug} 게시 실패: ${pub.error}`);

    const end = Math.min(deadline.getTime(), opts.now.getTime());
    const step = Math.max(60_000, Math.floor((end - start.getTime()) / (def.responses + 1)));
    for (let i = 0; i < def.responses; i++) {
      clock = new Date(start.getTime() + step * (i + 1));
      const r = await store.submitResponse(spec.slug, randomAnswers(pub.value.record.spec.questions, rand, def.scoreWeights));
      if (r.code !== "ok") throw new Error(`${spec.slug} 응답 ${i + 1} 실패: ${JSON.stringify(r)}`);
    }

    clock = opts.now;
    const rec = (await store.getById(created.value.id))!;
    if (def.notified && rec.state === "closed") await store.markClosedNotified(rec.id);
    await store.refreshSummary((await store.getById(rec.id))!);
    report.surveys.push({ slug: spec.slug, status: rec.state, responses: def.responses });
  }

  for (const s of opts.staff ?? [
    { email: "admin@example.org", role: "admin" as const },
    { email: "viewer@example.org", role: "viewer" as const },
  ]) {
    const r = await store.addStaff(s.email, s.role);
    if (!r.ok) throw new Error(r.error);
    report.staff++;
  }
  return report;
}
