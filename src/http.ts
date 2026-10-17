import { backoffMs, isRetryable } from "./core.js";

export class HttpError extends Error {
  constructor(public status: number, public body: unknown, public url: string) { super(`HTTP ${status} from ${url}`); }
}

export interface RetryOptions { maxAttempts: number; baseMs: number; sleep?: (ms: number) => Promise<void>; onRetry?: (info: { attempt: number; status: number; waitMs: number; url: string }) => void }

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** JSON request that retries on 429/5xx and network errors; 4xx (other than 429) fail immediately. */
export async function requestJson<T = any>(url: string, init: RequestInit, opt: RetryOptions, fetchImpl: typeof fetch = fetch): Promise<T> {
  const sleep = opt.sleep ?? realSleep;
  for (let attempt = 1; ; attempt++) {
    let status = 0, body: unknown, retryAfter: string | null = null;
    try {
      const res = await fetchImpl(url, init);
      status = res.status;
      retryAfter = res.headers.get("retry-after");
      const text = await res.text();
      body = text ? safeJson(text) : undefined;
      if (res.ok) return body as T;
    } catch (e) {
      body = String((e as Error).message);
    }
    const retryable = status === 0 || isRetryable(status);
    if (!retryable || attempt >= opt.maxAttempts) throw new HttpError(status, body, url);
    const waitMs = backoffMs(attempt, opt.baseMs, retryAfter);
    opt.onRetry?.({ attempt, status, waitMs, url });
    await sleep(waitMs);
  }
}

function safeJson(t: string): unknown { try { return JSON.parse(t); } catch { return t; } }
