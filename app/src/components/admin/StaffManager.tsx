"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addStaffAction, changeStaffAction } from "@/app/survey/actions";
import type { StaffMember } from "@/lib/store/survey-store";
import { buttonCls } from "./ui";

// 직원(담당자·열람자) 관리. 시트의 staff 탭을 고치는 것과 같음
export function StaffManager({ staff, me }: { staff: StaffMember[]; me: string }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "viewer">("viewer");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const done = (r: { ok: boolean; error?: string }, ok: string) => {
    setMsg(r.ok ? { kind: "ok", text: ok } : { kind: "err", text: r.error ?? "처리하지 못함" });
    if (r.ok) router.refresh();
  };

  return (
    <div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await addStaffAction(email, role);
            if (r.ok) setEmail("");
            done(r, r.ok && r.value.warning ? `추가함. 주의: ${r.value.warning}` : "추가함");
          });
        }}
      >
        <label className="min-w-0 flex-1 text-[13px] font-semibold">
          이메일
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@sasw.or.kr"
            className="mt-1 h-11 w-full rounded-[10px] border border-line-strong bg-field px-3 text-[15px] font-normal focus:border-ink focus:bg-surface"
          />
        </label>
        <label className="text-[13px] font-semibold">
          역할
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "viewer")}
            className="mt-1 block h-11 rounded-[10px] border border-line-strong bg-field px-3 text-[15px] font-normal"
          >
            <option value="viewer">열람자(대시보드만)</option>
            <option value="admin">담당자(전체)</option>
          </select>
        </label>
        <button type="submit" disabled={pending} className={buttonCls.primary}>
          추가
        </button>
      </form>

      {msg && (
        <p role={msg.kind === "err" ? "alert" : "status"} className={`mt-3 rounded-[10px] px-3 py-2 text-[13px] ${msg.kind === "err" ? "bg-[#fdf0eb] text-[#8a3520]" : "bg-lime-soft"}`}>
          {msg.text}
        </p>
      )}

      <div className="relative -mx-5 mt-5 overflow-x-auto px-5">
        <table className="w-full min-w-[560px] text-left text-[14px]">
          <thead className="border-b border-line text-[12px] text-muted-text">
            <tr>
              <th scope="col" className="py-2 pr-3 font-semibold">이메일</th>
              <th scope="col" className="py-2 pr-3 font-semibold">역할</th>
              <th scope="col" className="py-2 pr-3 font-semibold">상태</th>
              <th scope="col" className="py-2 pr-3 font-semibold">등록</th>
              <th scope="col" className="py-2 font-semibold">
                <span className="sr-only">작업</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {staff.map((m) => {
              const self = m.email === me.toLowerCase();
              return (
                <tr key={m.email} className={m.active ? "" : "text-muted-text"}>
                  <td className="py-3 pr-3 font-medium">
                    {m.email}
                    {self && <span className="ml-2 rounded-full bg-lime px-2 py-0.5 text-[11px] font-bold text-ink">나</span>}
                  </td>
                  <td className="py-3 pr-3">
                    <label className="sr-only" htmlFor={`role-${m.email}`}>
                      {m.email} 역할
                    </label>
                    <select
                      id={`role-${m.email}`}
                      value={m.role ?? ""}
                      disabled={pending}
                      onChange={(e) => {
                        const v = e.target.value as "admin" | "viewer";
                        start(async () => done(await changeStaffAction(m.email, { role: v }), `${m.email} 역할을 바꿈`));
                      }}
                      className="h-9 rounded-[10px] border border-line-strong bg-field px-2 text-[13px]"
                    >
                      {!m.role && <option value="">알 수 없음</option>}
                      <option value="admin">담당자</option>
                      <option value="viewer">열람자</option>
                    </select>
                  </td>
                  <td className="py-3 pr-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${m.active ? "bg-lime-soft text-ink" : "bg-line"}`}>{m.active ? "사용" : "중지"}</span>
                  </td>
                  <td className="whitespace-nowrap py-3 pr-3 text-[12px] tabular-nums">{m.addedAt.slice(0, 10)}</td>
                  <td className="py-3 text-right">
                    <button
                      type="button"
                      disabled={pending}
                      className={m.active ? buttonCls.ghost : buttonCls.lime}
                      onClick={() =>
                        start(async () => done(await changeStaffAction(m.email, { active: !m.active }), `${m.email} 계정을 ${m.active ? "중지" : "다시 사용"}함`))
                      }
                    >
                      {m.active ? "사용 중지" : "다시 사용"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {staff.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-muted-text">
                  등록된 직원이 없음.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[12px] text-muted-text">
        사용 중지하면 바로 로그인·접근이 막히고 결과 메일도 받지 않음. 퇴사·인사이동 때 사용 중지할 것. 자기 자신의 담당자 권한은 낮출 수 없고, 활성 담당자는 최소 한 명 남아야 함.
      </p>
    </div>
  );
}
