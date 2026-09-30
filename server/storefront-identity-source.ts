/**
 * Which storefront identity a request may act as. A customer identity is only
 * ever taken from proof:
 *   1. a valid identity token issued for THIS shop (refresh/rotate), or
 *   2. a Shopify customer id that matches the App Proxy's signed
 *      `logged_in_customer_id` for this shop, or
 *   3. the browser's anonymous session id (anonymous customers only).
 * A bare customer id in the request body is never sufficient.
 */
import { normalizeShopForIdentity } from "./storefront-identity-check";

export type IdentityProofInputs = {
  shop: string;
  /** Verified identity JWT (null when missing, invalid or expired). */
  token: { customerId: string; shop?: string } | null;
  /** App Proxy request whose HMAC verified (Shopify signed the query). */
  proxy: { verified: boolean; shop?: string | null; loggedInCustomerId?: string | null };
  /** Client-claimed Shopify customer id (untrusted unless it matches the proxy). */
  claimedShopifyCustomerId?: string | null;
  anonSessionId?: string | null;
};

export type IdentitySource =
  | { kind: "token"; customerId: string }
  | { kind: "shopify"; shopifyCustomerId: string }
  | { kind: "anon"; anonSessionId: string }
  | { kind: "none" };

function sameShop(a: string | null | undefined, b: string): boolean {
  return !!a && normalizeShopForIdentity(a) === normalizeShopForIdentity(b);
}

/** Proxy-signed Shopify customer id for this shop, or null. */
export function verifiedShopifyCustomerId(i: IdentityProofInputs): string | null {
  if (!i.proxy.verified || !sameShop(i.proxy.shop, i.shop)) return null;
  const signed = String(i.proxy.loggedInCustomerId || "").replace(/[^\d]/g, "");
  const claimed = String(i.claimedShopifyCustomerId || "").replace(/[^\d]/g, "");
  return signed && claimed === signed ? signed : null;
}

/** Ordered candidates: the caller tries each until one resolves to a customer. */
export function identitySources(i: IdentityProofInputs): IdentitySource[] {
  const out: IdentitySource[] = [];
  if (i.token && sameShop(i.token.shop, i.shop)) out.push({ kind: "token", customerId: i.token.customerId });
  const shopifyId = verifiedShopifyCustomerId(i);
  if (shopifyId) out.push({ kind: "shopify", shopifyCustomerId: shopifyId });
  const anon = typeof i.anonSessionId === "string" ? i.anonSessionId.trim() : "";
  if (anon) out.push({ kind: "anon", anonSessionId: anon });
  return out.length ? out : [{ kind: "none" }];
}

/**
 * Signed-in account (AppAI email/OTP or Google). The anonymous path must never
 * resolve to one of these; only a token or a fresh sign-in may.
 */
export function isAuthenticatedAccount(c: {
  userId?: string | null;
  aliasTypes: string[];
}): boolean {
  return (
    c.aliasTypes.includes("otp_email") ||
    c.aliasTypes.includes("google") ||
    (typeof c.userId === "string" && c.userId.startsWith("email:"))
  );
}

export type IdentityDeps<C extends { id: string; userId?: string | null }> = {
  getCustomer(id: string): Promise<C | undefined>;
  resolveShopifyCustomer(shopifyCustomerId: string): Promise<C>;
  resolveAnonCustomer(anonSessionId: string): Promise<C>;
  aliasTypes(customerId: string): Promise<string[]>;
};

/** First provable identity, or null. The anonymous path never yields a signed-in account. */
export async function resolveProvenCustomer<C extends { id: string; userId?: string | null }>(
  deps: IdentityDeps<C>,
  inputs: IdentityProofInputs,
): Promise<{ customer: C; source: IdentitySource["kind"] } | null> {
  for (const src of identitySources(inputs)) {
    if (src.kind === "token") {
      const existing = await deps.getCustomer(src.customerId);
      if (existing) return { customer: existing, source: "token" };
    } else if (src.kind === "shopify") {
      return { customer: await deps.resolveShopifyCustomer(src.shopifyCustomerId), source: "shopify" };
    } else if (src.kind === "anon") {
      const c = await deps.resolveAnonCustomer(src.anonSessionId);
      if (isAuthenticatedAccount({ userId: c.userId, aliasTypes: await deps.aliasTypes(c.id) })) return null;
      return { customer: c, source: "anon" };
    }
  }
  return null;
}
