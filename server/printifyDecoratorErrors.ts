/** Printify shop create often returns code 6002 when the decorator can't fulfill this blueprint. */
export function isPrintifyDecoratorUnavailableError(message: string): boolean {
  const m = String(message || "").toLowerCase();
  return (
    (m.includes("decorator") && m.includes("not available")) ||
    m.includes("code\":6002") ||
    m.includes("code\": 6002") ||
    m.includes('"code":6002')
  );
}

/**
 * The API token itself was rejected. A 401 on one `/shops/{id}/` route is not this:
 * Printify uses that for a stale shop id while the same token still owns other shops.
 */
export function isPrintifyAuthError(message: string): boolean {
  const m = String(message || "").toLowerCase();
  if (m.includes("unauthenticated")) return true;
  if (/\/shops\/\d+\//.test(m)) return false;
  return /printify 401\b/.test(m) || /printify 403\b/.test(m);
}

/** This shop id cannot create products. Try the next shop on the same token. */
export function isPrintifyShopAccessError(message: string): boolean {
  const m = String(message || "").toLowerCase();
  if (m.includes("unauthenticated")) return false;
  return /printify (401|403)\b/.test(m) && /\/shops\/\d+\//.test(m);
}
