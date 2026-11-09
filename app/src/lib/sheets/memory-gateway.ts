import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SheetsGateway } from "./gateway";

// 시험과 로컬 개발용 게이트웨이. filePath 를 주면 JSON 파일에 저장해 서버를 다시 켜도 유지됨.
// 구글 시트처럼 행 끝의 빈 칸을 잘라 돌려줌(저장소 코드가 짧은 행을 다루는지 시험하기 위함).
// 파일을 쓸 때는 작업마다 파일에서 다시 읽음: 개발 서버는 화면·서버 동작마다 이 객체를 따로 만들 수 있어,
// 메모리에만 두면 서로 다른 내용을 보고 오래된 내용으로 덮어쓰게 됨.

interface State {
  title: string;
  tabs: Record<string, string[][]>;
}

export class MemoryGateway implements SheetsGateway {
  private _state: State;

  constructor(
    private readonly filePath?: string,
    title = "[더미] 로컬 개발 DB",
  ) {
    this._state = { title, tabs: {} };
  }

  private get state(): State {
    if (this.filePath && existsSync(this.filePath)) {
      this._state = JSON.parse(readFileSync(this.filePath, "utf8")) as State;
    }
    return this._state;
  }

  private save() {
    if (!this.filePath) return;
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + ".tmp";
    writeFileSync(tmp, JSON.stringify(this._state));
    renameSync(tmp, this.filePath);
  }

  private tab(name: string): string[][] {
    const t = this.state.tabs[name];
    if (!t) throw new Error(`탭이 없음: ${name}`);
    return t;
  }

  async title() {
    return this.state.title;
  }

  async listTabs() {
    return Object.keys(this.state.tabs);
  }

  async readAll(tab: string) {
    return this.tab(tab).map((r) => {
      const row = r.map(String);
      while (row.length && row[row.length - 1] === "") row.pop();
      return row;
    });
  }

  async countRows(tabs: string[]) {
    const out: Record<string, number> = {};
    for (const t of tabs) out[t] = this.tab(t).slice(1).filter((r) => (r[0] ?? "") !== "").length;
    return out;
  }

  async append(tab: string, rows: string[][]) {
    this.tab(tab).push(...rows.map((r) => r.map(String)));
    this.save();
  }

  async updateRow(tab: string, row: number, values: string[]) {
    const t = this.tab(tab);
    if (row < 1 || row > t.length) throw new Error(`행 범위 밖: ${tab}!${row}`);
    t[row - 1] = values.map(String);
    this.save();
  }

  async deleteRow(tab: string, row: number) {
    const t = this.tab(tab);
    if (row < 1 || row > t.length) throw new Error(`행 범위 밖: ${tab}!${row}`);
    t.splice(row - 1, 1);
    this.save();
  }

  async clearBelowHeader(tab: string) {
    this.tab(tab).splice(1);
    this.save();
  }

  async addTab(tab: string, header: string[]) {
    if (this.state.tabs[tab]) throw new Error(`이미 있는 탭: ${tab}`);
    this.state.tabs[tab] = [header.map(String)];
    this.save();
  }

  async deleteTab(tab: string) {
    this.tab(tab);
    delete this.state.tabs[tab];
    this.save();
  }

  /** 시험용: 탭 원본 그대로 */
  raw(tab: string): string[][] {
    return this.tab(tab);
  }
}
