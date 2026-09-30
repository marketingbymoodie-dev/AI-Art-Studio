/**
 * THE storefront identity rule for every route that reads, writes, credits or
 * assigns customer-owned data: customer ids are identifiers, not proof.
 *
 * resolveVerifiedStorefrontIdentity returns the proven customer (identity token
 * for this shop, or the App Proxy's signed Shopify customer), else this
 * browser's anonymous-session customer (never a signed-in account), else an
 * explicit failure. Claimed ids are only consistency checks.
 * Rules and tests: server/storefront-identity-source.ts.
 */
import type { Request } from "express";
import { storage } from "./storage";
import { verifyAppProxySignature } from "./shopify-app-credentials";
import { verifyStorefrontIdentityHeader } from "./storefront-identity-token";
import { resolveVerifiedIdentity, type VerifiedIdentity } from "./storefront-identity-source";

export type StorefrontCustomerRow = NonNullable<Awaited<ReturnType<typeof storage.getCustomer>>>;

export function resolveStorefrontAliasCustomer(shop: string, alias: { shopifyCustomerId?: string; anonSessionId?: string }) {
  if (alias.shopifyCustomerId) {
    return storage.resolveOrCreateCustomerAlias({
      aliasType: "shopify",
      aliasValue: String(alias.shopifyCustomerId),
      shop,
      legacyUserId: `shopify:${shop}:${alias.shopifyCustomerId}`,
    } as any);
  }
  return storage.resolveOrCreateCustomerAlias({
    aliasType: "anon_session",
    aliasValue: String(alias.anonSessionId),
    shop,
    legacyUserId: `anon:${shop}:${alias.anonSessionId}`,
  } as any);
}

export async function resolveVerifiedStorefrontIdentity(
  req: Request,
  shop: string,
  claims: { shopifyCustomerId?: string | null; anonSessionId?: string | null; customerId?: string | null } = {},
  opts: { allowAnonymous?: boolean } = {},
): Promise<VerifiedIdentity<StorefrontCustomerRow>> {
  const q = req.query as Record<string, string>;
  const proxyVerified = typeof q.signature === "string" && verifyAppProxySignature(q);
  return resolveVerifiedIdentity<StorefrontCustomerRow>(
    {
      getCustomer: async (id) => {
        const c = await storage.getCustomer(id);
        if (c) await storage.ensureCustomerBalance(c.id);
        return c;
      },
      resolveShopifyCustomer: (shopifyCustomerId) => resolveStorefrontAliasCustomer(shop, { shopifyCustomerId }),
      resolveAnonCustomer: (anonSessionId) => resolveStorefrontAliasCustomer(shop, { anonSessionId }),
      aliasTypes: async (id) => (await storage.getCustomerAliases(id).catch(() => [])).map((a) => a.aliasType),
    },
    {
      shop,
      token: verifyStorefrontIdentityHeader(req.headers.authorization),
      proxy: { verified: proxyVerified, shop: q.shop, loggedInCustomerId: q.logged_in_customer_id },
      claimedShopifyCustomerId: claims.shopifyCustomerId,
      anonSessionId: claims.anonSessionId,
    },
    { allowAnonymous: opts.allowAnonymous, claimedCustomerId: claims.customerId },
  );
}

/**
 * A body customerId (internal UUID or Shopify id) as a consistency check on the
 * proven caller: the result is the caller's own customer, never the claim.
 */
export function resolveClaimedStorefrontCustomer(req: Request, shop: string, claimedCustomerId: unknown) {
  const claimed = String(claimedCustomerId ?? "").trim();
  return resolveVerifiedStorefrontIdentity(
    req,
    shop,
    { customerId: claimed || null, shopifyCustomerId: claimed && !isInternalCustomerId(claimed) ? claimed : null },
    { allowAnonymous: false },
  );
}

/**
 * Creator-storefront visitor (recent / delete artwork). The browser's creator
 * session id is its own possession; a customerId adds the customer's designs
 * only when proven. Proof for someone else → 403; no proof → session only.
 */
export async function resolveCreatorVisitorCustomer(
  req: Request,
  platformShop: string | null,
  claimedCustomerId: string,
): Promise<{ ok: true; customerId: string | null } | { ok: false; status: 403; error: "IDENTITY_MISMATCH" }> {
  if (!claimedCustomerId || !platformShop) return { ok: true, customerId: null };
  const verified = await resolveClaimedStorefrontCustomer(req, platformShop, claimedCustomerId);
  if (verified.ok) return { ok: true, customerId: verified.customer.id };
  if (verified.error === "IDENTITY_MISMATCH") return { ok: false, status: 403, error: verified.error };
  return { ok: true, customerId: null };
}

/** Internal customer UUID (vs. a numeric Shopify customer id). */
export function isInternalCustomerId(v: unknown): boolean {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
