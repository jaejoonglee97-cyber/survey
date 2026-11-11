"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/auth/policy";

const ITEMS: { href: string; label: string; icon: string; adminOnly: boolean }[] = [
  { href: "/survey", label: "설문 홈", icon: "M3 11.5 12 4l9 7.5M5 10v10h14V10", adminOnly: true },
  { href: "/survey/list", label: "설문 목록", icon: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01", adminOnly: true },
  { href: "/survey/new", label: "새 설문", icon: "M12 5v14M5 12h14", adminOnly: true },
  { href: "/survey/dashboard", label: "만족도 대시보드", icon: "M4 20V10M10 20V4M16 20v-7M22 20H2", adminOnly: false },
  { href: "/survey/settings", label: "설정", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z", adminOnly: true },
];

function isActive(path: string, href: string) {
  if (href === "/survey") return path === "/survey";
  if (href === "/survey/list") return path === "/survey/list" || /^\/survey\/s_[^/]+\/(results|edit)/.test(path);
  return path.startsWith(href);
}

export function SidebarNav({ role }: { role: Role }) {
  const path = usePathname() ?? "";
  return (
    <nav aria-label="만족도 설문 메뉴">
      <p className="px-3 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-text">메뉴</p>
      <ul className="space-y-1">
        {ITEMS.filter((i) => role === "admin" || !i.adminOnly).map((i) => {
          const active = isActive(path, i.href);
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center gap-3 rounded-[12px] px-3 text-[15px] focus-visible:outline-3 focus-visible:outline-teal ${
                  active ? "bg-lime font-bold" : "hover:bg-line/60"
                }`}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={i.icon} />
                </svg>
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
