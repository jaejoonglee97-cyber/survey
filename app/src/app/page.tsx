import { redirect } from "next/navigation";

// 첫 화면은 직원 화면으로 보냄(로그인하지 않았으면 로그인 화면으로 이동)
export default function Home() {
  redirect("/survey");
}
