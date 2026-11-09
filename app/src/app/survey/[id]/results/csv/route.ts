import { buildCsv, csvFileName } from "@/lib/admin/csv";
import { canAccess } from "@/lib/auth/policy";
import { getCurrentStaff } from "@/lib/auth/staff";
import { getStore } from "@/lib/sheets/client";

// 원자료 CSV 내려받기(담당자만). 서술 의견이 들어 있어 캐시하지 않음.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff || !canAccess(staff.role, "admin")) return new Response("권한이 없음", { status: 403 });
  const { id } = await ctx.params;
  const store = getStore();
  const rec = await store.getById(id);
  if (!rec || rec.status === "draft") return new Response("설문을 찾을 수 없음", { status: 404 });
  const { rows, submittedAt } = await store.readResponses(rec);
  const csv = buildCsv(rec.spec, rows, submittedAt);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFileName(rec.spec.slug, new Date())}"`,
      "Cache-Control": "no-store",
    },
  });
}
