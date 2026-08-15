import type { Request } from "express";
import { normalizeMyshopifyShopDomain } from "./shopDomain";

/**
 * Extra owner/demo shops that always get operator UI (in addition to env).
 * AI Art Studio (`aiartstudio-gizsmzs2`) is the current demo store.
 */
const BUILTIN_OWNER_SHOP_DOMAINS = [
  "aiartstudio-gizsmzs2.myshopify.com",
] as const;

function addShopDomains(into: Set<string>, raw?: string | null) {
  for (const part of String(raw || "").split(",")) {
    const t = normalizeMyshopifyShopDomain(part);
    if (t.endsWith(".myshopify.com")) into.add(t);
  }
}

/** OWNER_SHOP_DOMAIN (comma-ok) plus built-in demo owner shops. */
export function collectOwnerShopDomains(): Set<string> {
  const domains = new Set<string>();
  addShopDomains(domains, process.env.OWNER_SHOP_DOMAIN);
  for (const d of BUILTIN_OWNER_SHOP_DOMAINS) addShopDomains(domains, d);
  return domains;
}

/** Owner shops plus PLATFORM_ADMIN_SHOP_DOMAINS. */
export function collectPlatformAdminShopDomains(): Set<string> {
  const domains = collectOwnerShopDomains();
  addShopDomains(domains, process.env.PLATFORM_ADMIN_SHOP_DOMAINS);
  return domains;
}

export function isOwnerShopDomain(shopDomain?: string | null): boolean {
  const shop = normalizeMyshopifyShopDomain(shopDomain);
  if (!shop) return false;
  return collectOwnerShopDomains().has(shop);
}

/**
 * Platform-operator access (AppAI owner), not merchant admin.
 *
 * Production: shop domain must match OWNER_SHOP_DOMAIN, a built-in owner shop,
 * or PLATFORM_ADMIN_SHOP_DOMAINS.
 * Development: always allowed so local calibration tools work without Shopify JWT.
 */
export function isPlatformAdminRequest(req: Pick<Request, "shopDomain">): boolean {
  if (process.env.NODE_ENV !== "production") return true;

  const shop = normalizeMyshopifyShopDomain((req as any).shopDomain);
  if (!shop) return false;

  const domains = collectPlatformAdminShopDomains();
  if (domains.size === 0) return false;

  return domains.has(shop);
}

export function requirePlatformAdmin(req: Pick<Request, "shopDomain">, res: any): boolean {
  if (isPlatformAdminRequest(req)) return true;
  res.status(403).json({
    error: "Platform operator access required",
    code: "PLATFORM_ADMIN_REQUIRED",
  });
  return false;
}
