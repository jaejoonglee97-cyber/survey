import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { getStore } from "../sheets/client";
import { devLoginEnabled, isAllowedEmail } from "./policy";

// 직원 로그인. 구글 계정(협회 도메인) + staff 탭에 등록된 사람만 들어올 수 있음.
// 역할(admin/viewer)은 세션에 넣지 않고 요청마다 staff 탭에서 다시 읽음(권한 회수가 바로 반영되게).

const providers: NextAuthOptions["providers"] = [];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      // 구글 계정 선택 화면에서 협회 도메인을 우선 보여 줌(실제 확인은 아래 signIn 에서 함)
      authorization: { params: { hd: (process.env.ALLOWED_EMAIL_DOMAIN ?? "").split(",")[0]?.trim() || undefined, prompt: "select_account" } },
    }),
  );
}

if (devLoginEnabled(process.env)) {
  providers.push(
    CredentialsProvider({
      id: "dev",
      name: "개발용 로그인",
      credentials: { email: { label: "이메일", type: "email" } },
      async authorize(credentials) {
        // 로컬 더미 데이터 모드에서만 켜짐. staff 탭에 있는 더미 계정만 허용
        if (!devLoginEnabled(process.env)) return null;
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const role = await getStore().getStaffRole(email);
        return role ? { id: email, email } : null;
      },
    }),
  );
}

export const authOptions: NextAuthOptions = {
  providers,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    async signIn({ account, profile, user }) {
      if (account?.provider === "dev") return !!user?.email;
      if (account?.provider !== "google") return false;
      const p = profile as { email?: string; email_verified?: boolean; hd?: string } | undefined;
      if (!p?.email || p.email_verified !== true) return false;
      if (!isAllowedEmail(p.email, process.env.ALLOWED_EMAIL_DOMAIN)) return false;
      // 협회 Workspace 계정이면 구글이 hd(소속 도메인)를 함께 줌. 있으면 이것도 허용 도메인이어야 함
      if (p.hd && !isAllowedEmail(`x@${p.hd}`, process.env.ALLOWED_EMAIL_DOMAIN)) return false;
      return (await getStore().getStaffRole(p.email)) !== null;
    },
    async jwt({ token }) {
      // 이메일만 담음(이름·사진 등은 담지 않음)
      return { sub: token.sub, email: token.email?.toLowerCase() };
    },
    async session({ session, token }) {
      return { expires: session.expires, user: { email: token.email ?? null } };
    },
  },
};
