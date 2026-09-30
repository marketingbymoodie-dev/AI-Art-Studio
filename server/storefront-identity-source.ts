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

export type VerifiedIdentity<C> =
  | { ok: true; kind: "customer"; via: "token" | "shopify"; customer: C }
  | { ok: true; kind: "anonymous"; customer: C; anonSessionId: string }
  | {
      ok: false;
      status: 401 | 403;
      error: "IDENTITY_REQUIRED" | "IDENTITY_MISMATCH" | "SESSION_BELONGS_TO_ACCOUNT";
    };

/**
 * The one storefront identity rule. Returns the proven customer (token for this
 * shop, or proxy-signed Shopify customer), else the browser's anonymous-session
 * customer (never a signed-in account), else an explicit failure. A claimed
 * customer id is only ever a consistency check against the result.
 */
export async function resolveVerifiedIdentity<C extends { id: string; userId?: string | null }>(
  deps: IdentityDeps<C>,
  inputs: IdentityProofInputs,
  opts: { allowAnonymous?: boolean; claimedCustomerId?: string | null } = {},
): Promise<VerifiedIdentity<C>> {
  const allowAnonymous = opts.allowAnonymous !== false;
  let result: VerifiedIdentity<C> | null = null;
  for (const src of identitySources(inputs)) {
    if (src.kind === "token") {
      const existing = await deps.getCustomer(src.customerId);
      if (existing) {
        result = { ok: true, kind: "customer", via: "token", customer: existing };
        break;
      }
    } else if (src.kind === "shopify") {
      result = { ok: true, kind: "customer", via: "shopify", customer: await deps.resolveShopifyCustomer(src.shopifyCustomerId) };
      break;
    } else if (src.kind === "anon" && allowAnonymous) {
      const c = await deps.resolveAnonCustomer(src.anonSessionId);
      if (isAuthenticatedAccount({ userId: c.userId, aliasTypes: await deps.aliasTypes(c.id) })) {
        // This browser session was merged into a signed-in account: the session
        // alone never stands in for that account (sign in again; rotate session).
        return { ok: false, status: 401, error: "SESSION_BELONGS_TO_ACCOUNT" };
      }
      result = { ok: true, kind: "anonymous", customer: c, anonSessionId: src.anonSessionId };
      break;
    }
  }
  if (!result) return { ok: false, status: 401, error: "IDENTITY_REQUIRED" };
  const claimed = typeof opts.claimedCustomerId === "string" ? opts.claimedCustomerId.trim() : "";
  if (claimed && result.ok && claimed !== result.customer.id) {
    const shopifyClaimOk = result.ok && result.kind === "customer" && result.via === "shopify" && claimed === verifiedShopifyCustomerId(inputs);
    if (!shopifyClaimOk) return { ok: false, status: 403, error: "IDENTITY_MISMATCH" };
  }
  return result;
}

/** First provable identity, or null (bootstrap/generate helper over resolveVerifiedIdentity). */
export async function resolveProvenCustomer<C extends { id: string; userId?: string | null }>(
  deps: IdentityDeps<C>,
  inputs: IdentityProofInputs,
): Promise<{ customer: C; source: IdentitySource["kind"] } | null> {
  const r = await resolveVerifiedIdentity(deps, inputs);
  if (!r.ok) return null;
  return { customer: r.customer, source: r.kind === "anonymous" ? "anon" : r.via };
}

/**
 * Merge an anonymous browser session into a proven account? Pure decision so
 * the rules are testable. Nothing is merged unless this returns ok.
 */
export function decideSessionMerge(args: {
  /** Customer currently holding this session's anon alias (null = none yet). */
  anonCustomer: { id: string; authenticated: boolean } | null;
  targetCustomerId: string;
  /** Pre-login anonymous token's customer when the caller sent one ("invalid" if it didn't verify). */
  anonTokenCustomerId: string | null;
}):
  | { ok: true; linkWallet: boolean; alreadyMerged: boolean }
  | { ok: false; status: 403; error: "SESSION_OWNED_BY_ANOTHER_ACCOUNT" | "SESSION_TOKEN_MISMATCH" } {
  const { anonCustomer, targetCustomerId, anonTokenCustomerId } = args;
  if (anonCustomer && anonCustomer.id === targetCustomerId) {
    return { ok: true, linkWallet: false, alreadyMerged: true }; // idempotent re-merge
  }
  if (anonCustomer?.authenticated) {
    return { ok: false, status: 403, error: "SESSION_OWNED_BY_ANOTHER_ACCOUNT" };
  }
  if (anonTokenCustomerId != null && anonCustomer && anonTokenCustomerId !== anonCustomer.id) {
    return { ok: false, status: 403, error: "SESSION_TOKEN_MISMATCH" };
  }
  return { ok: true, linkWallet: !!anonCustomer, alreadyMerged: false };
}
