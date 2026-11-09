import { z } from "zod";

// 서버 전용 값을 읽어 검증함. 값 자체는 오류 메시지에 절대 넣지 않음.

const schema = z.object({
  GOOGLE_SHEETS_ID: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{20,}$/, "GOOGLE_SHEETS_ID 형식이 아님(URL의 /d/ 와 /edit 사이 값)"),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z
    .string()
    .trim()
    .regex(/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/, "GOOGLE_SERVICE_ACCOUNT_EMAIL 형식이 아님"),
  GOOGLE_PRIVATE_KEY: z.string().min(1, "GOOGLE_PRIVATE_KEY 가 비어 있음"),
  SHEETS_ENV: z.enum(["dummy", "production"]).default("dummy"),
});

export interface SheetsConfig {
  spreadsheetId: string;
  clientEmail: string;
  privateKey: string;
  env: "dummy" | "production";
}

/** 환경변수에 '\n' 문자로 들어온 줄바꿈과 바깥 따옴표를 정리함. */
export function normalizePrivateKey(raw: string): string {
  let key = raw.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  key = key.replace(/\\n/g, "\n").replace(/\r\n/g, "\n");
  return key;
}

export function readSheetsConfig(env: Record<string, string | undefined>): SheetsConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => (i.code === "invalid_type" ? `${String(i.path[0])} 가 없음` : i.message));
    throw new Error(
      `시트 연결 설정 오류: ${names.join("; ")} (.env.local 을 확인하거나, 시트 없이 개발하려면 DATA_BACKEND=local)`,
    );
  }
  const privateKey = normalizePrivateKey(parsed.data.GOOGLE_PRIVATE_KEY);
  if (!privateKey.startsWith("-----BEGIN PRIVATE KEY-----") || !privateKey.includes("-----END PRIVATE KEY-----")) {
    throw new Error("시트 연결 설정 오류: GOOGLE_PRIVATE_KEY 가 서비스 계정 비공개 키 형식이 아님");
  }
  return {
    spreadsheetId: parsed.data.GOOGLE_SHEETS_ID,
    clientEmail: parsed.data.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey,
    env: parsed.data.SHEETS_ENV,
  };
}

/** 더미 설정인데 시트 제목에 '더미/dummy' 표시가 없으면 운영 시트를 잘못 가리킨 것일 수 있음. */
export function looksLikeDummyTitle(title: string): boolean {
  return /더미|dummy|test|테스트/i.test(title);
}
