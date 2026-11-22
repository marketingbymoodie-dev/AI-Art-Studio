/**
 * fetch with a hard timeout for the shadow / ATC resolve path. Node's fetch
 * (undici) otherwise waits up to 300s on a stalled upstream, far past the
 * storefront client's 30s abort.
 */
export const SHADOW_FETCH_TIMEOUT_MS = 8_000;
/** Create / image-by-src: Shopify downloads the mockup inline, so allow longer. */
export const SHADOW_CREATE_FETCH_TIMEOUT_MS = 25_000;

/** Timed-out / dropped upstream — transient, never evidence the shadow is unsellable. */
export function isFetchTimeoutError(e: unknown): boolean {
  const err = e as { name?: string; message?: string } | null;
  if (!err) return false;
  if (err.name === "TimeoutError" || err.name === "AbortError") return true;
  return err.name === "TypeError" && /fetch failed/i.test(String(err.message || ""));
}

export function shadowFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = SHADOW_FETCH_TIMEOUT_MS,
): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}
