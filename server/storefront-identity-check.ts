/**
 * Saved-design ownership rule: the request's verified identity token must be
 * for the customer being read/changed, and for this shop when the token names
 * one. Signed-in and anonymous visitors hold the same kind of token (identity
 * bootstrap), so both are covered; there is no token-less path.
 */
export type IdentityCheck = { ok: true } | { ok: false; status: 401 | 403; error: "IDENTITY_REQUIRED" | "IDENTITY_MISMATCH" };

export function normalizeShopForIdentity(shop: string): string {
  const s = shop.trim().toLowerCase().replace(/^https?:\/\//, "");
  return s.endsWith(".myshopify.com") ? s : `${s}.myshopify.com`;
}

export function identityMatches(
  token: { customerId: string; shop?: string } | null,
  customerId: string,
  shop: string,
): IdentityCheck {
  if (!token) return { ok: false, status: 401, error: "IDENTITY_REQUIRED" };
  if (token.customerId !== customerId) return { ok: false, status: 403, error: "IDENTITY_MISMATCH" };
  if (token.shop && normalizeShopForIdentity(token.shop) !== normalizeShopForIdentity(shop)) {
    return { ok: false, status: 403, error: "IDENTITY_MISMATCH" };
  }
  return { ok: true };
}
