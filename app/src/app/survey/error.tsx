"use client";

// 직원 화면에서 서버 오류가 났을 때(대개 데이터 저장소·환경변수 설정 문제). 오류 내용은 서버 로그에만 남김
export default function SurveyError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="rounded-[18px] border border-line bg-surface p-6">
      <h1 className="text-xl font-bold">화면을 불러오지 못함</h1>
      <p className="mt-2 text-[14px] text-muted-text">
        데이터 저장소(구글 시트) 연결이나 환경변수 설정에 문제가 있을 수 있음. Vercel 의 Logs 에서 오류 메시지를 확인할 것(빠진 환경변수 이름이 나옴).
      </p>
      {error.digest && <p className="mt-2 font-mono text-[12px] text-muted-text">오류 번호: {error.digest}</p>}
      <button type="button" onClick={reset} className="mt-4 h-10 rounded-[10px] border border-line px-4 text-[14px] font-semibold">
        다시 시도
      </button>
    </section>
  );
}
