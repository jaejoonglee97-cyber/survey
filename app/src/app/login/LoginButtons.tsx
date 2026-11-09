"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

export function LoginButtons({ google, dev, callbackUrl }: { google: boolean; dev: boolean; callbackUrl: string }) {
  const [email, setEmail] = useState("admin@example.org");
  return (
    <div className="mt-6 space-y-4">
      {google && (
        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl })}
          className="h-12 w-full rounded-[10px] bg-ink font-bold text-white focus-visible:outline-3 focus-visible:outline-teal"
        >
          구글 계정으로 로그인
        </button>
      )}
      {dev && (
        <form
          className="rounded-xl border border-dashed border-line p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void signIn("dev", { email, callbackUrl });
          }}
        >
          <p className="text-sm font-semibold">개발용 로그인 (로컬 더미 데이터 모드에서만 보임)</p>
          <label htmlFor="dev-email" className="mt-2 block text-[13px] text-muted-text">
            직원 탭의 더미 이메일
          </label>
          <select
            id="dev-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 h-11 w-full rounded-[10px] border border-line bg-surface px-3"
          >
            <option value="admin@example.org">admin@example.org (담당자)</option>
            <option value="viewer@example.org">viewer@example.org (열람자)</option>
          </select>
          <button type="submit" className="mt-3 h-11 w-full rounded-[10px] bg-lime font-bold focus-visible:outline-3 focus-visible:outline-teal">
            더미 계정으로 로그인
          </button>
        </form>
      )}
    </div>
  );
}
