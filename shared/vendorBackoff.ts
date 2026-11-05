/** Delay before another try. Null means the status is final. */
export const VENDOR_RETRY_BACKOFF_MS = [5_000, 15_000, 45_000, 90_000] as const;
const MAX_RETRY_AFTER_MS = 120_000;

export function vendorRetryDelayMs(
  status: number,
  retryAfter: string | null,
  attempt: number,
  throttled = false,
): number | null {
  const retryable = throttled || status === 429 || status >= 500;
  if (!retryable) return null;
  if (attempt >= VENDOR_RETRY_BACKOFF_MS.length) return null;
  const seconds = Number(retryAfter);
  if (retryAfter != null && retryAfter.trim() !== "" && Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.max(seconds * 1000, 1_000), MAX_RETRY_AFTER_MS);
  }
  return VENDOR_RETRY_BACKOFF_MS[attempt];
}
