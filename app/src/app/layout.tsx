import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "만족도 설문 · 서울특별시사회복지사협회",
  description: "사업·행사 참여자 만족도 설문",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
