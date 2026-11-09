// 공개 제출 경로의 간단한 속도 제한(서버 인스턴스 하나 안에서만 셈).
// 주 방어선은 Vercel Firewall 규칙이고, 이것은 규칙이 빠졌을 때 구글 시트 한도를 한꺼번에 소진하지 않게 하는 보조 장치임.
// 행사장에서 같은 와이파이로 수십 명이 동시에 내는 정상 상황은 막지 않도록 넉넉하게 잡음.

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** 허용하면 true(기록함), 넘치면 false */
  allow(key: string): boolean {
    const t = this.now();
    const from = t - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((x) => x > from);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return false;
    }
    list.push(t);
    this.hits.set(key, list);
    // 오래된 키 정리(메모리 무한 증가 방지)
    if (this.hits.size > 1000) {
      for (const [k, v] of this.hits) if (!v.some((x) => x > from)) this.hits.delete(k);
    }
    return true;
  }
}

/** 설문 하나당 1분 240건, 전체 1분 600건 */
export const submitLimiters = {
  perSurvey: new SlidingWindowLimiter(240, 60_000),
  global: new SlidingWindowLimiter(600, 60_000),
};
