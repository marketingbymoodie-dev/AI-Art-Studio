/**
 * Shopify app identities this backend can speak for.
 *
 * Railway production normally has the public App Store app
 * (SHOPIFY_API_KEY / SHOPIFY_API_SECRET). The creator checkout shop uses a
 * separate custom-distribution clone (CREATOR_SHOPIFY_API_KEY / SECRET) so
 * we can install without App Store review. Same code, two client IDs.
 */
import crypto from "crypto";

export type ShopifyAppLabel = "primary" | "creators";

export type ShopifyAppCredentials = {
  label: ShopifyAppLabel;
  apiKey: string;
  apiSecret: string;
};

function trimEnv(...names: string[]): string {
  for (const name of names) {
    const v = (process.env[name] || "").trim();
    if (v) return v;
  }
  return "";
}

export function listShopifyAppCredentials(): ShopifyAppCredentials[] {
  const out: ShopifyAppCredentials[] = [];
  const primaryKey = trimEnv("SHOPIFY_API_KEY");
  const primarySecret = trimEnv("SHOPIFY_API_SECRET", "SHOPIFY_API_SECRET_KEY");
  if (primaryKey && primarySecret) {
    out.push({ label: "primary", apiKey: primaryKey, apiSecret: primarySecret });
  }

  const creatorKey = trimEnv("CREATOR_SHOPIFY_API_KEY");
  const creatorSecret = trimEnv("CREATOR_SHOPIFY_API_SECRET");
  if (creatorKey && creatorSecret && creatorKey !== primaryKey) {
    out.push({ label: "creators", apiKey: creatorKey, apiSecret: creatorSecret });
  }
  return out;
}

export function hasShopifyAppCredentials(): boolean {
  return listShopifyAppCredentials().length > 0;
}

export function getPrimaryShopifyCredentials(): ShopifyAppCredentials | null {
  const all = listShopifyAppCredentials();
  return all.find((c) => c.label === "primary") ?? all[0] ?? null;
}

export function getCreatorsShopifyCredentials(): ShopifyAppCredentials | null {
  return listShopifyAppCredentials().find((c) => c.label === "creators") ?? null;
}

/** `/shopify/install?app=creators` → clone client id. */
export function credentialsForInstallHint(hint?: string | null): ShopifyAppCredentials | null {
  const h = String(hint || "").trim().toLowerCase();
  if (h === "creators" || h === "creator" || h === "clone") {
    return getCreatorsShopifyCredentials() || getPrimaryShopifyCredentials();
  }
  return getPrimaryShopifyCredentials();
}

export function timingSafeEqualString(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export function hmacHexMatchesAnySecret(message: string, hmacHex: string): boolean {
  const expected = String(hmacHex || "");
  for (const c of listShopifyAppCredentials()) {
    const digest = crypto.createHmac("sha256", c.apiSecret).update(message).digest("hex");
    if (timingSafeEqualString(digest, expected)) return true;
  }
  return false;
}

export function hmacBase64MatchesAnySecret(payload: Buffer | string, hmacB64: string): boolean {
  const expected = String(hmacB64 || "");
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8");
  for (const c of listShopifyAppCredentials()) {
    const digest = crypto.createHmac("sha256", c.apiSecret).update(buf).digest("base64");
    if (timingSafeEqualString(digest, expected)) return true;
  }
  return false;
}

/** Shopify OAuth callback query HMAC (hex). */
export function verifyOAuthQueryHmac(query: Record<string, unknown>): boolean {
  const hmac = query.hmac;
  if (hmac == null || hmac === "") return false;
  const params = { ...query };
  delete params.hmac;
  delete params.signature;
  const message = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return hmacHexMatchesAnySecret(message, String(hmac));
}

/** App proxy signature (hex of concatenated sorted params, no `&`). */
export function verifyAppProxySignature(query: Record<string, string>): boolean {
  const { signature, ...rest } = query;
  if (!signature) return false;
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join("");
  return hmacHexMatchesAnySecret(message, signature);
}

export function reinstallKeyForShop(shop: string): string | null {
  const primary = getPrimaryShopifyCredentials();
  if (!primary) return null;
  return crypto.createHmac("sha256", primary.apiSecret).update(shop).digest("hex");
}

export function verifyReinstallKey(shop: string, key: string | undefined): boolean {
  const provided = key || "";
  for (const c of listShopifyAppCredentials()) {
    const expected = crypto.createHmac("sha256", c.apiSecret).update(shop).digest("hex");
    if (timingSafeEqualString(expected, provided)) return true;
  }
  return false;
}
