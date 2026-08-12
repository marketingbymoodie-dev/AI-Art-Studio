/**
 * Lightweight in-memory rate limits for Creator Marketplace public endpoints (Phase 10).
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function checkCreatorRateLimit(params: {
  key: string;
  limit: number;
  windowMs: number;
}): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  let b = buckets.get(params.key);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + params.windowMs };
    buckets.set(params.key, b);
  }
  if (b.count >= params.limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }
  b.count += 1;
  return { ok: true };
}

/** Best-effort client IP for rate keys. */
export function clientIpFromReq(req: { ip?: string; headers?: Record<string, unknown> }): string {
  const xf = req.headers?.["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) {
    return xf.split(",")[0].trim().slice(0, 64);
  }
  return String(req.ip || "unknown").slice(0, 64);
}
