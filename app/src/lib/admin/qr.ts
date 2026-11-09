import QRCode from "qrcode";

// 응답 링크 QR 코드(PNG data URL). 이미지로만 표시하므로 HTML 을 끼워 넣지 않음.
export async function qrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 2, width: 480, color: { dark: "#1c2420", light: "#ffffff" } });
}

/** 응답 링크: 설정된 사이트 주소가 없으면 요청 주소로 만듦 */
export function responseUrl(site: string, slug: string): string {
  return `${site.replace(/\/$/, "")}/s/${slug}`;
}
