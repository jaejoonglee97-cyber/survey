import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/staff";
import { authMode, devLoginEnabled, safeCallbackPath } from "@/lib/auth/policy";
import { LoginButtons } from "./LoginButtons";

export const dynamic = "force-dynamic";
export const metadata = { title: "로그인 · 만족도 설문" };

type Props = { searchParams: Promise<{ callbackUrl?: string; error?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const { callbackUrl, error } = await searchParams;
  const mode = authMode(process.env);
  if (mode === "blocked") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
        <div className="rounded-[20px] border border-line bg-surface p-8">
          <h1 className="text-xl font-bold">직원 화면을 열 수 없음</h1>
          <p className="mt-3 text-sm text-muted-text">
            로그인 없는 시험 모드(AUTH_MODE=off)는 더미 시트에서만 쓸 수 있음. 지금 설정은 운영 시트(SHEETS_ENV=production)를 가리키고 있음. SHEETS_ENV 를
            dummy 로 바꾸거나 로그인 설정을 켤 것.
          </p>
        </div>
      </main>
    );
  }
  const staff = await getCurrentStaff();
  if (staff) redirect(safeCallbackPath(callbackUrl, staff.role));

  const google = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const dev = devLoginEnabled(process.env);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="rounded-[20px] border border-line bg-surface p-8">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-text">Seoul Association of Social Workers</p>
        <h1 className="mt-2 text-2xl font-bold">만족도 설문 · 직원 로그인</h1>
        <p className="mt-2 text-sm text-muted-text">협회 구글 계정으로 로그인함. 등록된 직원만 이용할 수 있음.</p>
        {error && (
          <p role="alert" className="mt-4 rounded-xl border border-scale-1 bg-[#fdf0eb] px-4 py-3 text-sm">
            로그인할 수 없음. 협회 계정인지, 직원 목록에 등록되어 있는지 확인할 것.
          </p>
        )}
        <LoginButtons google={google} dev={dev} callbackUrl={safeCallbackPath(callbackUrl, null)} />
        {!google && !dev && <p className="mt-4 text-sm text-muted-text">로그인 설정(GOOGLE_CLIENT_ID 등)이 없음. 관리자에게 문의할 것.</p>}
      </div>
    </main>
  );
}
