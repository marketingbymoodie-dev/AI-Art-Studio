/**
 * In-memory shop + offline access token for resolve-design-variant.
 * The request's own signature / session check is never cached.
 * A hit skips the installation row read and ensureValidOfflineAccessToken.
 * Tokens inside the refresh skew are not stored, so a near-expiry token
 * still goes through the Shopify refresh.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
/** Match shopify-offline-token REFRESH_SKEW_MS. Do not serve a token that needs a refresh. */
const REFRESH_SKEW_MS = 2 * 60 * 1000;

export type CachedShopInstallation = {
  accessToken?: string | null;
  accessTokenExpiresAt?: Date | string | null;
  status?: string | null;
  [key: string]: unknown;
};

type CacheEntry = {
  installation: CachedShopInstallation;
  accessToken: string;
  expiresAtMs: number;
};

const cache = new Map<string, CacheEntry>();

function shopKeys(shop: string): string[] {
  const s = String(shop || "").trim().toLowerCase();
  if (!s) return [];
  const keys = [s];
  if (s.endsWith(".myshopify.com")) keys.push(s.slice(0, -".myshopify.com".length));
  else if (/^[a-z0-9][a-z0-9-]*$/.test(s)) keys.push(`${s}.myshopify.com`);
  return keys;
}

function expiryMs(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  const ms = parsed.getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function rememberAuthorizedShop(
  shop: string,
  installation: CachedShopInstallation,
  accessToken: string,
): void {
  const token = String(accessToken || "").trim();
  const keys = shopKeys(shop);
  if (!token || keys.length === 0) return;
  if (installation.status && installation.status !== "active") return;
  const now = Date.now();
  let expiresAtMs = now + CACHE_TTL_MS;
  const tokenExpires = expiryMs(installation.accessTokenExpiresAt);
  if (tokenExpires != null) expiresAtMs = Math.min(expiresAtMs, tokenExpires - REFRESH_SKEW_MS);
  if (expiresAtMs <= now) return;
  const entry: CacheEntry = {
    installation: { ...installation, accessToken: token },
    accessToken: token,
    expiresAtMs,
  };
  for (const key of keys) cache.set(key, entry);
}

export function takeAuthorizedShop(
  shop: string,
): { installation: any; accessToken: string } | null {
  const keys = shopKeys(shop);
  const entry = keys.map((key) => cache.get(key)).find(Boolean);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAtMs) {
    forgetAuthorizedShop(shop);
    return null;
  }
  return {
    installation: { ...entry.installation },
    accessToken: entry.accessToken,
  };
}

export function forgetAuthorizedShop(shop: string): void {
  for (const key of shopKeys(shop)) cache.delete(key);
}

/** Test-only. */
export function clearAuthorizedShopCache(): void {
  cache.clear();
}
