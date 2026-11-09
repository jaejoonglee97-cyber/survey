// 구글 API 의 일시적 오류(분당 한도 초과 429, 서버 오류 5xx)에 대한 재시도.
// 행사 현장에서 응답이 몰려 쓰기 한도(서비스 계정 기준 분당 약 60건)를 넘을 때를 대비함.

export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export function isRetryable(err: unknown): boolean {
  const e = err as { code?: unknown; status?: unknown; response?: { status?: unknown } };
  const status = Number(e?.code ?? e?.status ?? e?.response?.status);
  return status === 429 || (status >= 500 && status <= 599);
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 5;
  const baseMs = opts.baseMs ?? 500;
  const maxMs = opts.maxMs ?? 8000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts || !isRetryable(err)) throw err;
      // 지수 백오프 + 무작위 지연(동시에 몰린 요청이 같은 순간에 다시 몰리지 않게)
      const wait = Math.min(maxMs, baseMs * 2 ** (i - 1)) * (0.5 + random() / 2);
      await sleep(wait);
    }
  }
}
