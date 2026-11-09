import Link from "next/link";
import { redirect } from "next/navigation";
import { SidebarNav } from "@/components/admin/SidebarNav";
import { SignOutButton } from "@/components/admin/SignOutButton";
import { authMode } from "@/lib/auth/policy";
import { getCurrentStaff } from "@/lib/auth/staff";
import { getBackendKind } from "@/lib/sheets/client";

// 직원 화면 공통 틀(사이드바 + 상단바). 권한 확인은 각 화면과 서버 동작에서도 다시 함.
export const dynamic = "force-dynamic";

export default async function SurveyLayout({ children }: { children: React.ReactNode }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  // 저장소 설정 오류는 여기서 터뜨리지 않고 각 화면의 오류 안내(error.tsx)로 넘김
  let local = false;
  try {
    local = getBackendKind() === "local";
  } catch {
    local = false;
  }
  const testMode = authMode(process.env) === "test";

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[250px_1fr] print:block">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:p-2"
      >
        본문으로 건너뛰기
      </a>
      {/* 넓은 화면: 고정 사이드바 */}
      <aside className="hidden print:!hidden border-r border-line bg-sidebar px-3 py-5 lg:block">
        <Link href={staff.role === "admin" ? "/survey" : "/survey/dashboard"} className="flex items-center gap-2 px-2 pb-2">
          <span className="grid size-9 place-items-center rounded-[12px] bg-lime text-sm font-black" aria-hidden="true">
            서
          </span>
          <span className="text-[15px] font-bold leading-tight">
            서사협
            <br />
            <span className="text-[12px] font-medium text-muted-text">회원서비스</span>
          </span>
        </Link>
        <SidebarNav role={staff.role} />
      </aside>

      <div className="min-w-0">
        <header className="print:hidden flex min-h-[64px] flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 lg:px-8">
          {/* 좁은 화면: 메뉴 접기 */}
          <details className="relative lg:hidden">
            <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-[10px] border border-line px-3 text-sm font-semibold">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
              메뉴
            </summary>
            <div className="absolute left-0 z-20 mt-2 w-64 rounded-[16px] border border-line bg-sidebar p-2 shadow-sm">
              <SidebarNav role={staff.role} />
            </div>
          </details>
          <p className="hidden text-[13px] text-muted-text lg:block">회원서비스 › 만족도 설문</p>
          <div className="flex items-center gap-2">
            {local && <span className="rounded-full bg-lav px-3 py-1 text-[12px] font-semibold">로컬 더미 데이터</span>}
            <span className="hidden items-center gap-1 rounded-full border border-line px-3 py-1 text-[12px] sm:inline-flex">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              무기명 · 기록 보호
            </span>
            <span className="flex items-center text-[13px]" title={staff.email}>
              <span className="mr-1 inline-grid size-8 place-items-center rounded-full bg-avatar text-[13px] font-bold" aria-hidden="true">
                {staff.email[0]?.toUpperCase()}
              </span>
              <span className="sr-only">{staff.email}</span>
              <span className="text-muted-text">{staff.role === "admin" ? "담당자" : "열람자"}</span>
            </span>
            {!testMode && <SignOutButton />}
          </div>
        </header>
        {testMode && (
          <p role="note" className="border-b border-line bg-lime-soft px-4 py-2 text-[13px] font-semibold lg:px-8">
            시험 모드: 로그인 없이 누구나 이 화면에 들어올 수 있음. 더미 데이터만 넣을 것(실제 응답·개인정보 금지).
          </p>
        )}
        <main id="main" className="px-4 py-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
