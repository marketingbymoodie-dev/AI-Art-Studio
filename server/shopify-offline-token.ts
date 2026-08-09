/**
 * Shopify expiring offline access tokens.
 *
 * Public apps (incl. staging after switching to public distribution) must use
 * expiring offline tokens. Legacy installs may still hold a non-expiring token;
 * we migrate those via token exchange when possible.
 *
 * Docs: https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/offline-access-tokens
 */
import type { ShopifyInstallation } from "@shared/schema";
import { storage } from "./storage";

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || "";
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || "";

/** Refresh ~2 minutes before expiry to avoid mid-request 401s. */
const REFRESH_SKEW_MS = 2 * 60 * 1000;

export type ShopifyOfflineTokenPayload = {
  access_token: string;
  scope?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
};

export type OfflineTokenPersist = {
  accessToken: string;
  scope?: string;
  refreshToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
};

export function offlineTokenFieldsFromPayload(
  tokenData: ShopifyOfflineTokenPayload,
): OfflineTokenPersist {
  const now = Date.now();
  const expiresIn = typeof tokenData.expires_in === "number" ? tokenData.expires_in : null;
  const refreshExpiresIn =
    typeof tokenData.refresh_token_expires_in === "number"
      ? tokenData.refresh_token_expires_in
      : null;

  return {
    accessToken: tokenData.access_token,
    scope: tokenData.scope,
    refreshToken: tokenData.refresh_token ?? null,
    accessTokenExpiresAt:
      expiresIn != null ? new Date(now + expiresIn * 1000) : null,
    refreshTokenExpiresAt:
      refreshExpiresIn != null ? new Date(now + refreshExpiresIn * 1000) : null,
  };
}

function tokenUrl(shop: string): string {
  return `https://${shop}/admin/oauth/access_token`;
}

async function postTokenForm(
  shop: string,
  body: Record<string, string>,
): Promise<{ ok: true; data: ShopifyOfflineTokenPayload } | { ok: false; status: number; error: string }> {
  const response = await fetch(tokenUrl(shop), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(body).toString(),
  });

  const text = await response.text();
  if (!response.ok) {
    return { ok: false, status: response.status, error: text.slice(0, 500) };
  }

  try {
    const data = JSON.parse(text) as ShopifyOfflineTokenPayload;
    if (!data?.access_token) {
      return { ok: false, status: response.status, error: "Token response missing access_token" };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, status: response.status, error: `Invalid JSON token response: ${text.slice(0, 200)}` };
  }
}

export async function exchangeAuthorizationCode(
  shop: string,
  code: string,
): Promise<{ ok: true; fields: OfflineTokenPersist } | { ok: false; status: number; error: string }> {
  const result = await postTokenForm(shop, {
    client_id: SHOPIFY_API_KEY,
    client_secret: SHOPIFY_API_SECRET,
    code,
    expiring: "1",
  });
  if (!result.ok) return result;
  return { ok: true, fields: offlineTokenFieldsFromPayload(result.data) };
}

async function refreshOfflineToken(
  shop: string,
  refreshToken: string,
): Promise<{ ok: true; fields: OfflineTokenPersist } | { ok: false; status: number; error: string }> {
  const result = await postTokenForm(shop, {
    client_id: SHOPIFY_API_KEY,
    client_secret: SHOPIFY_API_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  if (!result.ok) return result;
  return { ok: true, fields: offlineTokenFieldsFromPayload(result.data) };
}

/** One-way migrate non-expiring offline token → expiring (revokes the old token). */
async function migrateToExpiringOfflineToken(
  shop: string,
  nonExpiringAccessToken: string,
): Promise<{ ok: true; fields: OfflineTokenPersist } | { ok: false; status: number; error: string }> {
  const result = await postTokenForm(shop, {
    client_id: SHOPIFY_API_KEY,
    client_secret: SHOPIFY_API_SECRET,
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: nonExpiringAccessToken,
    subject_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
    requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
    expiring: "1",
  });
  if (!result.ok) return result;
  return { ok: true, fields: offlineTokenFieldsFromPayload(result.data) };
}

function needsAccessRefresh(installation: ShopifyInstallation): boolean {
  const expiresAt = installation.accessTokenExpiresAt;
  if (!expiresAt) return false;
  return expiresAt.getTime() <= Date.now() + REFRESH_SKEW_MS;
}

function hasRefreshToken(installation: ShopifyInstallation): boolean {
  return !!(installation.refreshToken && installation.refreshToken.length > 0);
}

export type EnsureOfflineTokenResult =
  | { ok: true; accessToken: string; installation: ShopifyInstallation }
  | { ok: false; needsReinstall: boolean; error: string };

/**
 * Ensure the installation has a usable offline access token for Admin API calls.
 * Migrates legacy non-expiring tokens and refreshes expired expiring tokens.
 */
export async function ensureValidOfflineAccessToken(
  installation: ShopifyInstallation,
): Promise<EnsureOfflineTokenResult> {
  const shop = installation.shopDomain;
  if (!installation.accessToken || installation.accessToken === "NEEDS_RECONNECT") {
    return { ok: false, needsReinstall: true, error: "No access token stored for shop" };
  }
  if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
    return { ok: false, needsReinstall: false, error: "Shopify API credentials not configured" };
  }

  let current = installation;

  // Legacy non-expiring install (no refresh token) → migrate in place.
  if (!hasRefreshToken(current)) {
    console.log(`[shopify-token] Migrating ${shop} to expiring offline token`);
    const migrated = await migrateToExpiringOfflineToken(shop, current.accessToken);
    if (!migrated.ok) {
      console.error(`[shopify-token] Migration failed for ${shop}:`, migrated.status, migrated.error);
      return {
        ok: false,
        needsReinstall: migrated.status === 401 || migrated.status === 403,
        error: `Failed to migrate to expiring offline token (${migrated.status}): ${migrated.error}`,
      };
    }
    const updated = await storage.updateShopifyInstallation(current.id, {
      accessToken: migrated.fields.accessToken,
      refreshToken: migrated.fields.refreshToken,
      accessTokenExpiresAt: migrated.fields.accessTokenExpiresAt,
      refreshTokenExpiresAt: migrated.fields.refreshTokenExpiresAt,
      ...(migrated.fields.scope != null ? { scope: migrated.fields.scope } : {}),
      status: "active",
    });
    if (!updated) {
      return { ok: false, needsReinstall: false, error: "Failed to persist migrated token" };
    }
    current = updated;
    console.log(`[shopify-token] Migrated ${shop} to expiring offline token`);
  }

  if (needsAccessRefresh(current) && hasRefreshToken(current)) {
    console.log(`[shopify-token] Refreshing offline token for ${shop}`);
    const refreshed = await refreshOfflineToken(shop, current.refreshToken!);
    if (!refreshed.ok) {
      console.error(`[shopify-token] Refresh failed for ${shop}:`, refreshed.status, refreshed.error);
      return {
        ok: false,
        needsReinstall: refreshed.status === 401 || refreshed.status === 403,
        error: `Failed to refresh offline token (${refreshed.status}): ${refreshed.error}`,
      };
    }
    const updated = await storage.updateShopifyInstallation(current.id, {
      accessToken: refreshed.fields.accessToken,
      refreshToken: refreshed.fields.refreshToken,
      accessTokenExpiresAt: refreshed.fields.accessTokenExpiresAt,
      refreshTokenExpiresAt: refreshed.fields.refreshTokenExpiresAt,
      ...(refreshed.fields.scope != null ? { scope: refreshed.fields.scope } : {}),
      status: "active",
    });
    if (!updated) {
      return { ok: false, needsReinstall: false, error: "Failed to persist refreshed token" };
    }
    current = updated;
  }

  return { ok: true, accessToken: current.accessToken, installation: current };
}
