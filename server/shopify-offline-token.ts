/**
 * Shopify expiring offline access tokens.
 *
 * Public apps (incl. staging after switching to public distribution) must use
 * expiring offline tokens. Legacy installs may still hold a non-expiring token;
 * we migrate those via token exchange when possible. If the stored offline
 * token is already dead, we recover by exchanging the live App Bridge session
 * token (id_token) for a fresh expiring offline token — no reinstall needed.
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

/** Exchange App Bridge session token (id_token) for a fresh expiring offline token. */
export async function exchangeSessionTokenForOffline(
  shop: string,
  sessionToken: string,
): Promise<{ ok: true; fields: OfflineTokenPersist } | { ok: false; status: number; error: string }> {
  const result = await postTokenForm(shop, {
    client_id: SHOPIFY_API_KEY,
    client_secret: SHOPIFY_API_SECRET,
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: sessionToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
    requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
    expiring: "1",
  });
  if (!result.ok) return result;
  return { ok: true, fields: offlineTokenFieldsFromPayload(result.data) };
}

function coerceExpiryDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function needsAccessRefresh(installation: ShopifyInstallation): boolean {
  const expiresAt = coerceExpiryDate(installation.accessTokenExpiresAt);
  if (!expiresAt) return false;
  return expiresAt.getTime() <= Date.now() + REFRESH_SKEW_MS;
}

function hasRefreshToken(installation: ShopifyInstallation): boolean {
  return !!(installation.refreshToken && installation.refreshToken.length > 0);
}

function isInvalidSubjectTokenError(error: string): boolean {
  return /invalid_subject_token/i.test(error);
}

async function persistOfflineToken(
  installationId: number,
  fields: OfflineTokenPersist,
): Promise<ShopifyInstallation | undefined> {
  return storage.updateShopifyInstallation(installationId, {
    accessToken: fields.accessToken,
    refreshToken: fields.refreshToken,
    accessTokenExpiresAt: fields.accessTokenExpiresAt,
    refreshTokenExpiresAt: fields.refreshTokenExpiresAt,
    ...(fields.scope != null ? { scope: fields.scope } : {}),
    status: "active",
  });
}

export type EnsureOfflineTokenResult =
  | { ok: true; accessToken: string; installation: ShopifyInstallation }
  | { ok: false; needsReinstall: boolean; error: string };

export type EnsureOfflineTokenOptions = {
  /** Live App Bridge session JWT from Authorization: Bearer … */
  sessionToken?: string | null;
  /** Skip the "token looks unexpired" short-circuit (e.g. after a Shopify 401). */
  forceRefresh?: boolean;
};

/**
 * Ensure the installation has a usable offline access token for Admin API calls.
 * Migrates legacy non-expiring tokens, refreshes expired expiring tokens, and
 * falls back to session-token exchange when the stored offline token is dead.
 */
export async function ensureValidOfflineAccessToken(
  installation: ShopifyInstallation,
  options: EnsureOfflineTokenOptions = {},
): Promise<EnsureOfflineTokenResult> {
  const shop = installation.shopDomain;
  const sessionToken = options.sessionToken?.trim() || null;

  if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
    return { ok: false, needsReinstall: false, error: "Shopify API credentials not configured" };
  }

  let current = installation;
  const forceRefresh = !!options.forceRefresh;
  const missingOffline =
    !current.accessToken || current.accessToken === "NEEDS_RECONNECT";

  // Legacy non-expiring install (no refresh token) → migrate in place.
  if (!missingOffline && !hasRefreshToken(current)) {
    console.log(`[shopify-token] Migrating ${shop} to expiring offline token`);
    const migrated = await migrateToExpiringOfflineToken(shop, current.accessToken);
    if (migrated.ok) {
      const updated = await persistOfflineToken(current.id, migrated.fields);
      if (!updated) {
        return { ok: false, needsReinstall: false, error: "Failed to persist migrated token" };
      }
      current = updated;
      console.log(`[shopify-token] Migrated ${shop} to expiring offline token`);
    } else {
      console.error(`[shopify-token] Migration failed for ${shop}:`, migrated.status, migrated.error);
      // Fall through to session-token recovery when the subject offline token is dead.
      if (!sessionToken || (!isInvalidSubjectTokenError(migrated.error) && migrated.status !== 401 && migrated.status !== 403 && migrated.status !== 400)) {
        return {
          ok: false,
          needsReinstall: true,
          error: `Failed to migrate to expiring offline token (${migrated.status}): ${migrated.error}`,
        };
      }
    }
  }

  let refreshedThisCall = false;
  if ((forceRefresh || needsAccessRefresh(current)) && hasRefreshToken(current)) {
    console.log(`[shopify-token] Refreshing offline token for ${shop}${forceRefresh ? " (forced)" : ""}`);
    const refreshed = await refreshOfflineToken(shop, current.refreshToken!);
    if (refreshed.ok) {
      const updated = await persistOfflineToken(current.id, refreshed.fields);
      if (!updated) {
        return { ok: false, needsReinstall: false, error: "Failed to persist refreshed token" };
      }
      current = updated;
      refreshedThisCall = true;
    } else {
      console.error(`[shopify-token] Refresh failed for ${shop}:`, refreshed.status, refreshed.error);
      if (!sessionToken) {
        return {
          ok: false,
          needsReinstall: refreshed.status === 401 || refreshed.status === 403,
          error: `Failed to refresh offline token (${refreshed.status}): ${refreshed.error}`,
        };
      }
      // Fall through to session-token recovery.
    }
  }

  // Already have a usable expiring offline token.
  // After a forced refresh that failed, the DB expiry may still look valid —
  // do not return that dead token; recover via session exchange instead.
  if (hasRefreshToken(current) && !needsAccessRefresh(current) && (!forceRefresh || refreshedThisCall)) {
    return { ok: true, accessToken: current.accessToken, installation: current };
  }

  // Recover from dead offline token using the live embedded session token.
  if (sessionToken) {
    console.log(`[shopify-token] Exchanging session token for expiring offline token (${shop})`);
    const exchanged = await exchangeSessionTokenForOffline(shop, sessionToken);
    if (!exchanged.ok) {
      console.error(`[shopify-token] Session exchange failed for ${shop}:`, exchanged.status, exchanged.error);
      return {
        ok: false,
        needsReinstall: true,
        error: `Failed to obtain offline token from session (${exchanged.status}): ${exchanged.error}`,
      };
    }
    const updated = await persistOfflineToken(current.id, exchanged.fields);
    if (!updated) {
      return { ok: false, needsReinstall: false, error: "Failed to persist session-exchanged token" };
    }
    console.log(`[shopify-token] Obtained expiring offline token via session exchange for ${shop}`);
    return { ok: true, accessToken: updated.accessToken, installation: updated };
  }

  if (missingOffline) {
    return { ok: false, needsReinstall: true, error: "No access token stored for shop" };
  }

  return {
    ok: false,
    needsReinstall: true,
    error: "Shopify offline token is invalid. Reopen the app or reinstall to reconnect.",
  };
}

/** Extract Bearer token from an Express-style request Authorization header. */
export function getBearerTokenFromRequest(req: { headers?: Record<string, unknown> }): string | null {
  const header = req.headers?.authorization ?? req.headers?.Authorization;
  if (!header || typeof header !== "string") return null;
  const parts = header.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") return null;
  return parts[1] || null;
}

/**
 * After a Dev Dashboard / App Store install, Shopify often opens the embedded
 * app with a session JWT before (or instead of) our classic /shopify/callback.
 * Exchange that JWT for an offline Admin token and persist the install row so
 * merchants are not asked to "Connect Shopify" again.
 */
export async function recoverOrCreateInstallationFromSession(
  shop: string,
  sessionToken: string | null,
): Promise<EnsureOfflineTokenResult> {
  const existing = await storage.getShopifyInstallationByShop(shop);
  if (existing) {
    return ensureValidOfflineAccessToken(existing, { sessionToken });
  }
  if (!sessionToken) {
    return { ok: false, needsReinstall: true, error: "No installation and no session token" };
  }
  if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
    return { ok: false, needsReinstall: false, error: "Shopify API credentials not configured" };
  }

  console.log(`[shopify-token] Creating installation via session exchange (${shop})`);
  const exchanged = await exchangeSessionTokenForOffline(shop, sessionToken);
  if (!exchanged.ok) {
    console.error(`[shopify-token] Session exchange failed for new shop ${shop}:`, exchanged.status, exchanged.error);
    return {
      ok: false,
      needsReinstall: true,
      error: `Failed to obtain offline token from session (${exchanged.status}): ${exchanged.error}`,
    };
  }

  try {
    const created = await storage.createShopifyInstallation({
      shopDomain: shop,
      accessToken: exchanged.fields.accessToken,
      refreshToken: exchanged.fields.refreshToken,
      accessTokenExpiresAt: exchanged.fields.accessTokenExpiresAt,
      refreshTokenExpiresAt: exchanged.fields.refreshTokenExpiresAt,
      scope: exchanged.fields.scope || "",
      status: "active",
      installedAt: new Date(),
    });
    console.log(`[shopify-token] Created installation via session exchange for ${shop}`);
    return { ok: true, accessToken: created.accessToken, installation: created };
  } catch (err: any) {
    if (err?.code === "23505") {
      const raced = await storage.getShopifyInstallationByShop(shop);
      if (raced) {
        return ensureValidOfflineAccessToken(raced, { sessionToken });
      }
    }
    console.error(`[shopify-token] Failed to persist new installation for ${shop}:`, err?.message ?? err);
    return { ok: false, needsReinstall: false, error: "Failed to persist installation from session exchange" };
  }
}
