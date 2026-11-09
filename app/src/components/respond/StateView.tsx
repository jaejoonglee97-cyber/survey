// 응답 화면의 안내 상태(없는 링크·마감·완료·오류). 가운데 정렬 카드.
export function StateView({ title, lines }: { title: string; lines: string[] }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[640px] items-center px-4 py-10">
      <section className="w-full rounded-[20px] border border-line bg-surface px-6 py-10 text-center" aria-live="polite">
        <h1 className="text-xl font-bold">{title}</h1>
        {lines.filter(Boolean).map((t, i) => (
          <p key={i} className="mt-2 text-[15px] text-muted-text">
            {t}
          </p>
        ))}
      </section>
    </main>
  );
}
