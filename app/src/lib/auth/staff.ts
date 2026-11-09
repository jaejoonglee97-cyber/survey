import "server-only";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getStore } from "../sheets/client";
import { authOptions } from "./options";
import { authMode, canAccess, devLoginEnabled, isAllowedEmail, TEST_MODE_STAFF, type Area, type Role } from "./policy";

export interface Staff {
  email: string;
  role: Role;
}

/** 현재 로그인한 직원(요청마다 staff 탭에서 역할을 다시 확인). 없거나 권한이 없으면 null */
export const getCurrentStaff = cache(async (): Promise<Staff | null> => {
  // 로그인 없는 시험 모드(더미 데이터일 때만). 운영 시트를 가리키면 아무도 들어오지 못함
  const mode = authMode(process.env);
  if (mode === "test") return { ...TEST_MODE_STAFF };
  if (mode === "blocked") return null;
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase();
  if (!email) return null;
  // 구글 로그인은 도메인을 다시 확인. 개발용 로그인은 로컬 더미 모드에서만 허용
  if (!isAllowedEmail(email, process.env.ALLOWED_EMAIL_DOMAIN) && !devLoginEnabled(process.env)) return null;
  const role = await getStore().getStaffRole(email);
  return role ? { email, role } : null;
});

/** 화면용: 로그인·권한이 없으면 로그인 화면이나 대시보드로 보냄 */
export async function requirePage(area: Area, path: string): Promise<Staff> {
  const staff = await getCurrentStaff();
  if (!staff) redirect(`/login?callbackUrl=${encodeURIComponent(path)}`);
  if (!canAccess(staff.role, area)) redirect("/survey/dashboard");
  return staff;
}

export class ForbiddenError extends Error {
  constructor() {
    super("권한이 없음");
  }
}

/** 서버 동작용: 권한이 없으면 예외 */
export async function requireAction(area: Area): Promise<Staff> {
  const staff = await getCurrentStaff();
  if (!staff || !canAccess(staff.role, area)) throw new ForbiddenError();
  return staff;
}
