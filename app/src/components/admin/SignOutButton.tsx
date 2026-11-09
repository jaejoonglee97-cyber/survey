"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="h-9 rounded-[10px] border border-line bg-surface px-3 text-[13px] focus-visible:outline-3 focus-visible:outline-teal"
    >
      로그아웃
    </button>
  );
}
