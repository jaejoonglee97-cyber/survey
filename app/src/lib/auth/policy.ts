// 접근 규칙(순수 함수). 화면을 숨기는 것만으로 권한을 대신하지 않고, 모든 서버 동작이 이 규칙으로 다시 확인함.

export type Role = "admin" | "viewer";
export type Area = "admin" | "dashboard";

/** admin: 설문 생성·관리·결과(서술 포함)·CSV. viewer: 대시보드 집계만 */
export function canAccess(role: Role | null | undefined, area: Area): boolean {
  if (!role) return false;
  if (area === "dashboard") return role === "admin" || role === "viewer";
  return role === "admin";
}

/**
 * 구글 로그인 허용 도메인 확인. 도메인 설정이 비어 있으면 아무도 허용하지 않음(설정 누락 시 열리지 않게).
 * 여러 도메인은 쉼표로 구분.
 */
export function isAllowedEmail(email: string | null | undefined, allowedDomains: string | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return false;
  const domain = e.slice(at + 1);
  const allowed = (allowedDomains ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  return allowed.includes(domain);
}

/**
 * 로그인 방식.
 *  - "on"     : 직원 로그인 사용(기본)
 *  - "test"   : AUTH_MODE=off 이고 데이터가 더미일 때. 로그인 없이 모두 담당자로 들어옴(기능 시험용)
 *  - "blocked": AUTH_MODE=off 인데 운영 시트(SHEETS_ENV=production)를 가리킴. 직원 화면을 열지 않음
 * 인터넷에 열린 주소이므로 실제 응답이 들어 있는 시트에서는 로그인 없는 모드를 허용하지 않음.
 */
export type AuthMode = "on" | "test" | "blocked";

export function authMode(env: Record<string, string | undefined>): AuthMode {
  if ((env.AUTH_MODE ?? "").trim().toLowerCase() !== "off") return "on";
  const dummy = env.DATA_BACKEND === "local" || (env.SHEETS_ENV ?? "dummy").trim() !== "production";
  return dummy ? "test" : "blocked";
}

/** 시험 모드에서 쓰는 가상의 담당자 */
export const TEST_MODE_STAFF = { email: "test-mode@localhost", role: "admin" as const };

/** 개발용 로그인(이메일만으로 로그인)은 로컬 더미 데이터 모드의 개발 서버에서만 켬 */
export function devLoginEnabled(env: Record<string, string | undefined>): boolean {
  return env.DATA_BACKEND === "local" && !env.VERCEL && env.NODE_ENV !== "production";
}

/** 로그인 뒤 돌아갈 주소: 같은 사이트의 /survey 경로만 허용(외부 주소로 보내는 공격 방지) */
export function safeCallbackPath(raw: string | null | undefined, role: Role | null): string {
  const fallback = role === "viewer" ? "/survey/dashboard" : "/survey";
  if (!raw || !raw.startsWith("/survey") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  return raw;
}
