import { auth, sheets, type sheets_v4 } from "@googleapis/sheets";
import type { SheetsConfig } from "./config";

// 구글 시트 API 클라이언트 생성. 권한 범위는 스프레드시트만(드라이브 전체 권한을 요청하지 않음).
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

export function createSheetsApi(config: SheetsConfig): sheets_v4.Sheets {
  const jwt = new auth.JWT({
    email: config.clientEmail,
    key: config.privateKey,
    scopes: SCOPES,
  });
  return sheets({ version: "v4", auth: jwt });
}
