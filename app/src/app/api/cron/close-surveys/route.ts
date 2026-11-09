import { isCronAuthorized, runCloseJob } from "@/lib/jobs/close-surveys";
import { createMailer } from "@/lib/mail/mailer";
import { getStore } from "@/lib/sheets/client";

// Vercel Cron 이 매시간 호출(vercel.json). Authorization: Bearer $CRON_SECRET 이 맞아야 실행됨.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isCronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const result = await runCloseJob(getStore(), createMailer(process.env), {
      adminNotify: process.env.ADMIN_NOTIFY_EMAIL,
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    });
    // 로그에는 건수만 남김
    console.info(`[cron:close-surveys] 대상 ${result.checked} · 발송 ${result.sent} · 실패 ${result.failed} · 받는 사람 없음 ${result.noRecipient}`);
    return Response.json(result, { status: result.failed ? 500 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "처리 실패" }, { status: 500 });
  }
}
