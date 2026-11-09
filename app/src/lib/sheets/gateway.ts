// 스프레드시트 접근의 최소 단위. 저장소(store)는 이 인터페이스만 알고,
// 실제 구글 시트(google-gateway)와 로컬 개발·시험용(memory-gateway)이 같은 동작을 구현함.
// 행 번호는 시트와 같이 1부터 셈(1행 = 머리글).

export interface SheetsGateway {
  /** 스프레드시트 제목(더미 여부 확인용) */
  title(): Promise<string>;
  listTabs(): Promise<string[]>;
  /** 탭 전체 값(머리글 포함). 각 행 끝의 빈 칸은 잘려 있을 수 있음 */
  readAll(tab: string): Promise<string[][]>;
  /** 여러 탭의 데이터 행 수(머리글 제외, 첫 칸이 빈 행 제외)를 한 번에 셈 */
  countRows(tabs: string[]): Promise<Record<string, number>>;
  /** 맨 아래에 행 추가. 값은 수식으로 해석하지 않음(RAW) */
  append(tab: string, rows: string[][]): Promise<void>;
  /** 지정한 행을 덮어씀 */
  updateRow(tab: string, row: number, values: string[]): Promise<void>;
  deleteRow(tab: string, row: number): Promise<void>;
  /** 머리글(1행)만 남기고 모두 지움 */
  clearBelowHeader(tab: string): Promise<void>;
  /** 새 탭을 만들고 머리글을 씀 */
  addTab(tab: string, header: string[]): Promise<void>;
  deleteTab(tab: string): Promise<void>;
}

/** 시트 범위 표기용 탭 이름 따옴표 처리 */
export function quoteTab(tab: string): string {
  return `'${tab.replace(/'/g, "''")}'`;
}
