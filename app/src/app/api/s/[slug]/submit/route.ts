import { submitLimiters } from "@/lib/respond/rate-limit";
import { handleSubmit } from "@/lib/respond/submit-handler";
import { getStore } from "@/lib/sheets/client";

// 공개 응답 제출. 주 속도 제한은 Vercel Firewall 규칙(README 참고), 코드에는 보조 제한을 둠.
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  return handleSubmit(getStore(), slug, req, submitLimiters);
}
