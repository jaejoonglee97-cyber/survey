import type { sheets_v4 } from "@googleapis/sheets";
import { quoteTab, type SheetsGateway } from "./gateway";
import { withRetry, type RetryOptions } from "./retry";

// 실제 구글 스프레드시트 게이트웨이. 모든 호출을 재시도로 감쌈.
// 값은 RAW 로 써서 수식으로 해석되지 않게 하고, 읽을 때는 표시된 문자열로 받음.

export class GoogleGateway implements SheetsGateway {
  private sheetIds: Map<string, number> | null = null;

  constructor(
    private readonly api: sheets_v4.Sheets,
    private readonly spreadsheetId: string,
    private readonly retry: RetryOptions = {},
  ) {}

  private call<T>(fn: () => Promise<T>): Promise<T> {
    return withRetry(fn, this.retry);
  }

  private async meta() {
    const res = await this.call(() =>
      this.api.spreadsheets.get({ spreadsheetId: this.spreadsheetId, fields: "properties.title,sheets.properties(title,sheetId)" }),
    );
    this.sheetIds = new Map(
      (res.data.sheets ?? [])
        .filter((s) => s.properties?.title != null && s.properties.sheetId != null)
        .map((s) => [s.properties!.title!, s.properties!.sheetId!]),
    );
    return res.data;
  }

  private async sheetId(tab: string): Promise<number> {
    if (!this.sheetIds?.has(tab)) await this.meta();
    const id = this.sheetIds?.get(tab);
    if (id === undefined) throw new Error(`탭이 없음: ${tab}`);
    return id;
  }

  async title() {
    return (await this.meta()).properties?.title ?? "";
  }

  async listTabs() {
    await this.meta();
    return [...this.sheetIds!.keys()];
  }

  async readAll(tab: string) {
    const res = await this.call(() =>
      this.api.spreadsheets.values.get({ spreadsheetId: this.spreadsheetId, range: quoteTab(tab), valueRenderOption: "FORMATTED_VALUE" }),
    );
    return (res.data.values ?? []).map((r) => r.map((v) => (v == null ? "" : String(v))));
  }

  async countRows(tabs: string[]) {
    const out: Record<string, number> = {};
    if (!tabs.length) return out;
    const res = await this.call(() =>
      this.api.spreadsheets.values.batchGet({ spreadsheetId: this.spreadsheetId, ranges: tabs.map((t) => `${quoteTab(t)}!A2:A`) }),
    );
    tabs.forEach((t, i) => {
      out[t] = (res.data.valueRanges?.[i]?.values ?? []).filter((r) => r[0] != null && String(r[0]) !== "").length;
    });
    return out;
  }

  async append(tab: string, rows: string[][]) {
    await this.call(() =>
      this.api.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${quoteTab(tab)}!A1`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: rows },
      }),
    );
  }

  async updateRow(tab: string, row: number, values: string[]) {
    await this.call(() =>
      this.api.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${quoteTab(tab)}!A${row}`,
        valueInputOption: "RAW",
        requestBody: { values: [values] },
      }),
    );
  }

  async deleteRow(tab: string, row: number) {
    const sheetId = await this.sheetId(tab);
    await this.call(() =>
      this.api.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { requests: [{ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: row - 1, endIndex: row } } }] },
      }),
    );
  }

  async clearBelowHeader(tab: string) {
    await this.call(() =>
      this.api.spreadsheets.values.clear({ spreadsheetId: this.spreadsheetId, range: `${quoteTab(tab)}!A2:ZZ` }),
    );
  }

  async addTab(tab: string, header: string[]) {
    await this.call(() =>
      this.api.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: tab, gridProperties: { frozenRowCount: 1 } } } }] },
      }),
    );
    this.sheetIds = null;
    await this.updateRow(tab, 1, header);
  }

  async deleteTab(tab: string) {
    const sheetId = await this.sheetId(tab);
    await this.call(() =>
      this.api.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { requests: [{ deleteSheet: { sheetId } }] },
      }),
    );
    this.sheetIds = null;
  }
}
