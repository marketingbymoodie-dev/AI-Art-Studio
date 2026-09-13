/**
 * Admin GraphQL publish can succeed while Ajax `/cart/add.js` still 422s
 * for 10–30s+ (storefront replica lag). Keep client + theme waits aligned.
 *
 * Theme `appai-art-embed.js` cannot import this module — keep the duplicated
 * constants / parseRetryAfterMs / classifyCartAddFailure in lockstep.
 */
export const ATC_STOREFRONT_PROPAGATION_WAITS_MS = [
  1000, 1500, 2000, 2500, 3000, 4000, 5000, 7000, 9000,
] as const;

/** Honest retry — the shadow is published in Admin; storefront has not caught up. */
export const ATC_SHADOW_STILL_PREPARING =
  "This design is still being prepared for the store. Keep this page open and tap Add to cart again in a moment.";

/**
 * Resolve never returned a shadow (no https mockup, or resolve-design-variant
 * came back empty). Distinct from replica-lag copy so field logs split the two.
 */
export const ATC_SHADOW_PREVIEW_NOT_READY =
  "Your preview is still uploading. Keep this page open and tap Add to cart again in a moment.";

export const ATC_MAX_CART_ADD_CALLS_PER_TAP = 10;
export const ATC_RETRY_AFTER_MIN_MS = 1_000;
export const ATC_RETRY_AFTER_MAX_MS = 30_000;
export const ATC_RETRY_AFTER_DEFAULT_MS = 5_000;
export const ATC_RATE_LIMIT_UNTIL_KEY = "appai:atcRateLimitUntil";

export type CartAddFailureKind =
  | "not_found"
  | "sold_out"
  | "rate_limited"
  | "ambiguous"
  | "fatal";

export type CartAddFailureClass = {
  kind: CartAddFailureKind;
  retryable: boolean;
  /** Skip the next /cart.js dedup only after a clean 422 not-found. */
  skipCartJsOnNext: boolean;
};

function clampRetryAfterMs(ms: number, fallbackMs: number): number {
  const raw = Number.isFinite(ms) ? ms : fallbackMs;
  return Math.min(
    ATC_RETRY_AFTER_MAX_MS,
    Math.max(ATC_RETRY_AFTER_MIN_MS, Math.round(raw)),
  );
}

/** Parse Shopify `Retry-After` (delta-seconds or HTTP-date). Clamped 1–30s. */
export function parseRetryAfterMs(
  header: string | null | undefined,
  fallbackMs = ATC_RETRY_AFTER_DEFAULT_MS,
): number {
  const raw = String(header || "").trim();
  if (!raw) return clampRetryAfterMs(fallbackMs, ATC_RETRY_AFTER_DEFAULT_MS);
  if (/^\d+(\.\d+)?$/.test(raw)) {
    return clampRetryAfterMs(parseFloat(raw) * 1000, fallbackMs);
  }
  const when = Date.parse(raw);
  if (!Number.isFinite(when)) {
    return clampRetryAfterMs(fallbackMs, ATC_RETRY_AFTER_DEFAULT_MS);
  }
  return clampRetryAfterMs(when - Date.now(), fallbackMs);
}

export function classifyCartAddFailure(opts: {
  status?: number;
  message?: string;
  networkError?: boolean;
  timeout?: boolean;
}): CartAddFailureClass {
  if (opts.timeout || opts.networkError) {
    return { kind: "ambiguous", retryable: true, skipCartJsOnNext: false };
  }
  const status = Number(opts.status) || 0;
  const lower = String(opts.message || "").toLowerCase();
  if (status === 429) {
    return { kind: "rate_limited", retryable: true, skipCartJsOnNext: false };
  }
  if (
    status === 422 &&
    (lower.includes("cannot find") || lower.includes("not found"))
  ) {
    return { kind: "not_found", retryable: true, skipCartJsOnNext: true };
  }
  if (
    status === 422 &&
    (lower.includes("sold out") ||
      lower.includes("cannot add more") ||
      lower.includes("purchase is not allowed") ||
      lower.includes("still appearing in the store"))
  ) {
    return { kind: "sold_out", retryable: true, skipCartJsOnNext: false };
  }
  if (status >= 500 || status === 408) {
    return { kind: "ambiguous", retryable: true, skipCartJsOnNext: false };
  }
  return { kind: "fatal", retryable: false, skipCartJsOnNext: false };
}

export function readAtcRateLimitRemainingMs(now = Date.now()): number {
  try {
    const until = Number(sessionStorage.getItem(ATC_RATE_LIMIT_UNTIL_KEY) || 0);
    if (!Number.isFinite(until) || until <= now) return 0;
    return until - now;
  } catch {
    return 0;
  }
}

export function writeAtcRateLimitCooldown(waitMs: number, now = Date.now()): number {
  const ms = clampRetryAfterMs(waitMs, ATC_RETRY_AFTER_DEFAULT_MS);
  const until = now + ms;
  try {
    sessionStorage.setItem(ATC_RATE_LIMIT_UNTIL_KEY, String(until));
  } catch {
    /* private mode / iframe storage blocked */
  }
  return until;
}

export function clearAtcRateLimitCooldown(): void {
  try {
    sessionStorage.removeItem(ATC_RATE_LIMIT_UNTIL_KEY);
  } catch {
    /* ignore */
  }
}

export function atcCustomerSafeError(raw?: string | null): string {
  const text = String(raw || "");
  if (/preview is still uploading/i.test(text)) return ATC_SHADOW_PREVIEW_NOT_READY;
  return ATC_SHADOW_STILL_PREPARING;
}
