import { timingSafeEqual } from "node:crypto";
import { recipients, type Mailer, type MailMessage } from "../mail/mailer";
import type { SurveyRecord, SurveyStore } from "../store/survey-store";
import { buildReportLines } from "../survey-core";

// 마감 처리(크론이 매시간 호출). 응답 차단은 제출 시점에 이미 이루어지므로, 여기서는
// 마감된 설문의 집계 캐시를 확정하고 결과 요약 메일을 한 번 보냄.
// 메일 발송에 실패한 설문은 기록하지 않아 다음 실행에서 다시 시도함.

/** Authorization: Bearer <CRON_SECRET> 확인(길이가 짧은 비밀값은 거부, 시간 차이로 추측하지 못하게 비교) */
export function isCronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function buildResultMail(rec: SurveyRecord, reportLines: string[], to: string[], siteUrl: string): MailMessage {
  const link = siteUrl ? `${siteUrl.replace(/\/$/, "")}/survey/${rec.id}/results` : `/survey/${rec.id}/results`;
  const text = [
    `[만족도 설문] ${rec.spec.title} 설문이 마감되어 결과를 요약함.`,
    "",
    ...reportLines,
    "",
    `결과 화면(담당자 로그인 필요): ${link}`,
    "",
    "이 메일에는 수치만 담았으며 서술 의견 원문은 싣지 않음. 결과 화면에서 확인할 것.",
  ].join("\n");
  return { to, subject: `[만족도 설문] ${rec.spec.title} 마감 결과 요약`, text };
}

export interface CloseJobResult {
  checked: number;
  sent: number;
  failed: number;
  /** 받는 사람이 없어 메일 없이 기록만 한 설문 */
  noRecipient: number;
}

export async function runCloseJob(
  store: SurveyStore,
  mailer: Mailer,
  opts: { adminNotify?: string; siteUrl?: string },
): Promise<CloseJobResult> {
  const targets = await store.listClosedUnnotified();
  const result: CloseJobResult = { checked: targets.length, sent: 0, failed: 0, noRecipient: 0 };
  for (const rec of targets) {
    try {
      await store.refreshSummary(rec);
      const agg = await store.aggregateSurvey(rec);
      // 지금도 직원 탭에서 활성 담당자(admin)인 사람에게만 보냄(권한이 회수된 사람·열람자 제외)
      const candidates = recipients(opts.adminNotify, rec.createdBy);
      const roles = await Promise.all(candidates.map((e) => store.getStaffRole(e)));
      const to = candidates.filter((_, i) => roles[i] === "admin");
      if (to.length) {
        await mailer.send(buildResultMail(rec, buildReportLines(rec.spec, agg), to, opts.siteUrl ?? ""));
        result.sent++;
      } else result.noRecipient++;
      await store.markClosedNotified(rec.id);
    } catch {
      result.failed++;
    }
  }
  return result;
}
