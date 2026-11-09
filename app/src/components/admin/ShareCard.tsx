import { CopyButton } from "./CopyButton";
import { Card, buttonCls } from "./ui";

// 응답 링크·QR 공유 카드(서버 컴포넌트). QR 은 서버에서 만든 PNG 이미지
export function ShareCard({ url, qr, slug, justPublished }: { url: string; qr: string; slug: string; justPublished?: boolean }) {
  return (
    <Card title={justPublished ? "게시함 · 응답 링크와 QR" : "응답 링크와 QR"} className={justPublished ? "border-ink bg-lime-soft" : ""}>
      <div className="flex flex-wrap items-center gap-5">
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL 이미지라 next/image 최적화 대상이 아님 */}
        <img src={qr} alt={`응답 링크 QR 코드: ${url}`} width={160} height={160} className="rounded-[12px] border border-line bg-white" />
        <div className="min-w-0 flex-1 space-y-3">
          <p className="break-all font-mono text-[14px] font-semibold">{url}</p>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={url} label="링크 복사" />
            <a href={qr} download={`${slug}-qr.png`} className={buttonCls.ghost}>
              QR 이미지 내려받기
            </a>
            <a href={url} target="_blank" rel="noopener noreferrer" className={buttonCls.ghost}>
              응답 화면 열기
            </a>
          </div>
          <p className="text-[12px] text-muted-text">링크를 받은 누구나 로그인 없이 무기명으로 응답할 수 있음. 마감 일시가 지나면 자동으로 닫힘.</p>
        </div>
      </div>
    </Card>
  );
}
