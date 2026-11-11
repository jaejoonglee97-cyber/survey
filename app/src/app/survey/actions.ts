"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth/staff";
import * as cmd from "@/lib/admin/commands";
import { getStore } from "@/lib/sheets/client";

// 담당자 서버 동작. 권한 확인과 입력 검증은 commands.ts 에서 함.
// 오류 내용(시트 정보 등)은 화면으로 보내지 않음.

async function run<T>(fn: () => Promise<cmd.ActionResult<T>>): Promise<cmd.ActionResult<T>> {
  try {
    return await fn();
  } catch {
    return { ok: false, error: "처리 중 문제가 생김. 잠시 후 다시 시도할 것" };
  }
}

function refresh() {
  revalidatePath("/survey", "layout");
}

export async function saveDraftAction(id: string | null, spec: unknown) {
  return run(async () => {
    const r = await cmd.saveDraft(getStore(), await getCurrentStaff(), id, spec);
    if (r.ok) refresh();
    return r;
  });
}

export async function publishAction(id: string) {
  return run(async () => {
    const r = await cmd.publishSurvey(getStore(), await getCurrentStaff(), id);
    if (r.ok) refresh();
    return r;
  });
}

export async function setDeadlineAction(id: string, deadline: string) {
  return run(async () => {
    const r = await cmd.changeDeadline(getStore(), await getCurrentStaff(), id, deadline);
    if (r.ok) refresh();
    return r;
  });
}

export async function setStatusAction(id: string, status: "open" | "closed") {
  return run(async () => {
    const r = await cmd.changeStatus(getStore(), await getCurrentStaff(), id, status);
    if (r.ok) refresh();
    return r;
  });
}

export async function deleteSurveyAction(id: string) {
  return run(async () => {
    const r = await cmd.removeSurvey(getStore(), await getCurrentStaff(), id);
    if (r.ok) refresh();
    return r;
  });
}

export async function purgeTestSurveysAction(ids: string[]) {
  return run(async () => {
    const r = await cmd.purgeTestSurveys(getStore(), await getCurrentStaff(), ids);
    if (r.ok) refresh();
    return r;
  });
}

export async function duplicateSurveyAction(id: string) {
  return run(async () => {
    const r = await cmd.duplicateSurvey(getStore(), await getCurrentStaff(), id);
    if (r.ok) refresh();
    return r;
  });
}

export async function addStaffAction(email: string, role: "admin" | "viewer") {
  return run(async () => {
    const r = await cmd.addStaffMember(getStore(), await getCurrentStaff(), email, role, process.env.ALLOWED_EMAIL_DOMAIN);
    if (r.ok) refresh();
    return r;
  });
}

export async function changeStaffAction(email: string, patch: { role?: "admin" | "viewer"; active?: boolean }) {
  return run(async () => {
    const r = await cmd.changeStaffMember(getStore(), await getCurrentStaff(), email, patch);
    if (r.ok) refresh();
    return r;
  });
}
