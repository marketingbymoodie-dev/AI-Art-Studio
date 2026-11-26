/**
 * Shopify app identities this backend can speak for.
 *
 * Railway normally has the public App Store app
 * (SHOPIFY_API_KEY / SHOPIFY_API_SECRET). Optional extra apps are added only
 * when their own env pair is set:
 *   creators     — CREATOR_SHOPIFY_API_KEY / CREATOR_SHOPIFY_API_SECRET
 *   petposterous — PETPOSTEROUS_SHOPIFY_API_KEY / PETPOSTEROUS_SHOPIFY_API_SECRET
 * A missing pair leaves that slot out of the list. Primary and creators keep
 * today's behaviour when the petposterous pair is absent.
 */
import crypto from "crypto";

export type ShopifyAppLabel = "primary" | "creators" | "petposterous";

export type ShopifyAppCredentials = {
  label: ShopifyAppLabel;
  apiKey: string;
  apiSecret: string;
};

const APP_ENV: Array<{ label: ShopifyAppLabel; key: string; secrets: string[] }> = [
  { label: "primary", key: "SHOPIFY_API_KEY", secrets: ["SHOPIFY_API_SECRET", "SHOPIFY_API_SECRET_KEY"] },
  { label: "creators", key: "CREATOR_SHOPIFY_API_KEY", secrets: ["CREATOR_SHOPIFY_API_SECRET"] },
  { label: "petposterous", key: "PETPOSTEROUS_SHOPIFY_API_KEY", secrets: ["PETPOSTEROUS_SHOPIFY_API_SECRET"] },
];

function trimEnv(...names: string[]): string {
  for (const name of names) {
    const v = (process.env[name] || "").trim();
    if (v) return v;
  }
  return "";
}

export function listShopifyAppCredentials(): ShopifyAppCredentials[] {
  const out: ShopifyAppCredentials[] = [];
  const seenKeys = new Set<string>();
  for (const spec of APP_ENV) {
    const apiKey = trimEnv(spec.key);
    const apiSecret = trimEnv(...spec.secrets);
    if (!apiKey || !apiSecret || seenKeys.has(apiKey)) continue;
    seenKeys.add(apiKey);
    out.push({ label: spec.label, apiKey, apiSecret });
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

export function credentialsForAppLabel(label: string | null | undefined): ShopifyAppCredentials | null {
  if (!label) return null;
  return listShopifyAppCredentials().find((c) => c.label === label) ?? null;
}

/**
 * `/shopify/install?app=creators` → clone client id (falls back to primary when
 * the clone env is unset, as before). `?app=petposterous` is the Petposterous
 * custom app and does not fall back: an unset pair disables that install.
 */
export function credentialsForInstallHint(hint?: string | null): ShopifyAppCredentials | null {
  const h = String(hint || "").trim().toLowerCase();
  if (h === "creators" || h === "creator" || h === "clone") {
    return getCreatorsShopifyCredentials() || getPrimaryShopifyCredentials();
  }
  if (h === "petposterous" || h === "pet") {
    return credentialsForAppLabel("petposterous");
  }
  return getPrimaryShopifyCredentials();
}

/** A shop with no recorded app still accepts any configured secret (today). A bound shop accepts only its own. */
export function shopAcceptsApp(boundLabel: string | null | undefined, matchedLabel: string): boolean {
  if (!boundLabel) return true;
  return boundLabel === matchedLabel;
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

export function matchAppByBase64Hmac(payload: Buffer | string, hmacB64: string): ShopifyAppCredentials | null {
  const expected = String(hmacB64 || "");
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8");
  for (const c of listShopifyAppCredentials()) {
    const digest = crypto.createHmac("sha256", c.apiSecret).update(buf).digest("base64");
    if (timingSafeEqualString(digest, expected)) return c;
  }
  return null;
}

export function hmacBase64MatchesAnySecret(payload: Buffer | string, hmacB64: string): boolean {
  return matchAppByBase64Hmac(payload, hmacB64) != null;
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
