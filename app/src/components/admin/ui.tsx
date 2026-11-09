// 직원 화면 공통 조각: 페이지 머리, 통계 카드, 카드, 상태 칩, 눈금 막대

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-text">Seoul Association of Social Workers</p>
        <h1 className="mt-1 text-[28px] font-bold leading-tight lg:text-[32px]">{title}</h1>
        {description && <p className="mt-1 text-[14px] text-muted-text">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  unit,
  note,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  note?: string;
  tone: "lav" | "blue" | "mint";
}) {
  const bg = { lav: "bg-lav", blue: "bg-blue", mint: "bg-mint" }[tone];
  return (
    <div className={`relative overflow-hidden rounded-[18px] ${bg} p-5`}>
      <p className="text-[13px] font-bold">{label}</p>
      <p className="mt-2">
        <span className="text-[36px] font-bold leading-none tabular-nums">{value}</span>
        {unit && <span className="ml-1 text-[14px] font-semibold">{unit}</span>}
      </p>
      {note && <p className="mt-2 text-[12px]">{note}</p>}
      <span className="pointer-events-none absolute -bottom-8 -right-8 size-28 rounded-full border-[14px] border-white/30" aria-hidden="true" />
    </div>
  );
}

export function Card({
  title,
  badge,
  action,
  children,
  className = "",
}: {
  title?: string;
  badge?: string | number;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-[18px] border border-line bg-surface p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && (
            <h2 className="text-[17px] font-bold">
              {title}
              {badge !== undefined && <span className="ml-2 rounded-full bg-bg px-2 py-0.5 align-middle text-[12px] font-semibold">{badge}</span>}
            </h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

const STATE_CHIP = {
  open: { label: "진행 중", cls: "bg-lime-soft" },
  closed: { label: "마감", cls: "bg-line" },
  draft: { label: "초안", cls: "bg-lav" },
} as const;

export function StateChip({ state }: { state: keyof typeof STATE_CHIP }) {
  const c = STATE_CHIP[state];
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${c.cls}`}>{c.label}</span>;
}

const SCALE_BG = ["bg-scale-1", "bg-scale-2", "bg-scale-3", "bg-scale-4", "bg-scale-5"];

/** 1~5점 분포 막대(점수 숫자를 함께 표시해 색만으로 의미를 전달하지 않음) */
export function DistBar({ dist, label }: { dist: readonly number[]; label: string }) {
  const n = dist.reduce((a, b) => a + b, 0);
  if (!n) return <p className="text-[13px] text-muted-text">응답 없음</p>;
  return (
    <div>
      <div className="flex h-7 overflow-hidden rounded-[8px]" role="img" aria-label={`${label}: ${dist.map((c, i) => `${i + 1}점 ${c}명`).join(", ")}`}>
        {dist.map((c, i) =>
          c ? (
            <div
              key={i}
              className={`${SCALE_BG[i]} flex items-center justify-center text-[11px] font-bold ${i === 4 ? "text-white" : ""}`}
              style={{ width: `${(c / n) * 100}%` }}
            >
              {c / n >= 0.08 ? `${i + 1}` : ""}
            </div>
          ) : null,
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-[12px] text-muted-text" aria-hidden="true">
        {dist.map((c, i) => (
          <span key={i}>
            {i + 1}점 {c}명
          </span>
        ))}
      </div>
    </div>
  );
}

export const buttonCls = {
  primary: "inline-flex h-10 items-center justify-center rounded-[10px] bg-ink px-4 text-[14px] font-bold text-white disabled:opacity-50 focus-visible:outline-3 focus-visible:outline-teal",
  lime: "inline-flex h-10 items-center justify-center rounded-[10px] bg-lime px-4 text-[14px] font-bold disabled:opacity-50 focus-visible:outline-3 focus-visible:outline-teal",
  ghost:
    "inline-flex h-10 items-center justify-center rounded-[10px] border border-line bg-surface px-4 text-[14px] font-semibold disabled:opacity-50 focus-visible:outline-3 focus-visible:outline-teal",
  danger:
    "inline-flex h-10 items-center justify-center rounded-[10px] border border-scale-1 bg-[#fdf0eb] px-4 text-[14px] font-semibold text-[#8a3520] disabled:opacity-50 focus-visible:outline-3 focus-visible:outline-teal",
};
