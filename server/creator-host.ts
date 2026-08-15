/**
 * Resolve creator storefronts from Host subdomain or /c/:username path.
 * Also exposes public API validation for generate / analytics / cart (Phase 10).
 */
import { eq, or } from "drizzle-orm";
import type { Request } from "express";
import { db } from "./db";
import { creators, type Creator } from "@shared/schema";
import {
  RESERVED_CREATOR_SUBDOMAINS,
  creatorPublicName,
  extractSubdomainFromHost,
  extractUsernameFromPath,
  normalizeCreatorUsername,
} from "@shared/creatorMarketplace";
import {
  getCreatorPlatformShopDomain,
  isCreatorMarketplaceEnabled,
} from "./creator-config";

export { extractSubdomainFromHost, extractUsernameFromPath };

/** HTML storefront can show these (paused shows a paused page). */
export const STOREFRONT_VISIBLE_STATUSES = new Set([
  "onboarding",
  "active_beta",
  "partner",
  "paused",
]);

/** Generate / cart / pack — must be actively selling. */
export const CREATOR_API_ACTIVE_STATUSES = new Set([
  "onboarding",
  "active_beta",
  "partner",
]);

function normalizeShopDomain(shop: string | null | undefined): string {
  return String(shop || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
}

export function isCreatorPlatformShop(shop: string | null | undefined): boolean {
  const platform = normalizeShopDomain(getCreatorPlatformShopDomain());
  if (!platform) return false;
  const s = normalizeShopDomain(shop);
  return s === platform || s === platform.replace(/\.myshopify\.com$/, "");
}

/**
 * Validate creator identity for public APIs (generate, analytics, cart).
 * Enforces platform shop (optional), status allowlist, and id/username match.
 */
export async function assertPublicCreatorApiContext(params: {
  shop?: string | null;
  creatorId?: string | null;
  creatorUsername?: string | null;
  requirePlatformShop?: boolean;
  allowedStatuses?: Set<string>;
}): Promise<
  | { ok: true; creator: Creator }
  | { ok: false; status: number; error: string; code?: string }
> {
  if (!isCreatorMarketplaceEnabled()) {
    return { ok: false, status: 404, error: "Creator Marketplace is not enabled." };
  }

  const requirePlatform = params.requirePlatformShop !== false;
  if (requirePlatform) {
    const platform = getCreatorPlatformShopDomain();
    if (!platform) {
      return {
        ok: false,
        status: 503,
        error: "CREATOR_PLATFORM_SHOP_DOMAIN is not configured.",
        code: "CREATOR_PLATFORM_SHOP_MISSING",
      };
    }
    if (!isCreatorPlatformShop(params.shop)) {
      return {
        ok: false,
        status: 403,
        error: "Creator context is only valid on the platform shop.",
        code: "CREATOR_WRONG_SHOP",
      };
    }
  }

  const rawId = params.creatorId ? String(params.creatorId).trim() : "";
  const username = normalizeCreatorUsername(String(params.creatorUsername || ""));
  if (!rawId && !username) {
    return { ok: false, status: 400, error: "creatorId or creatorUsername is required." };
  }

  let byId: Creator | null = null;
  let byUsername: Creator | null = null;

  if (rawId) {
    const [row] = await db.select().from(creators).where(eq(creators.id, rawId)).limit(1);
    byId = row ?? null;
  }
  if (username) {
    byUsername = await lookupCreatorByUsername(username);
  }

  if (rawId && username) {
    if (!byId || !byUsername || byId.id !== byUsername.id) {
      return {
        ok: false,
        status: 400,
        error: "creatorId and creatorUsername do not match.",
        code: "CREATOR_ID_MISMATCH",
      };
    }
  }

  const creator = byId || byUsername;
  if (!creator) {
    return { ok: false, status: 404, error: "Creator not found." };
  }

  const allowed = params.allowedStatuses || CREATOR_API_ACTIVE_STATUSES;
  if (!allowed.has(creator.status)) {
    const paused = ["paused", "suspended", "archived"].includes(creator.status);
    return {
      ok: false,
      status: paused ? 403 : 404,
      error: paused
        ? "This creator shop is temporarily unavailable."
        : "Creator storefront not available.",
      code: paused ? "CREATOR_STORE_PAUSED" : "CREATOR_NOT_AVAILABLE",
    };
  }

  return { ok: true, creator };
}

/** Strip sensitive fields before returning creators to admin UI. */
export function sanitizeCreatorForAdmin<T extends Record<string, unknown> | Creator>(
  row: T,
): Omit<T, "otpCode" | "otpExpiresAt"> {
  const { otpCode: _o, otpExpiresAt: _e, ...rest } = row as T & {
    otpCode?: unknown;
    otpExpiresAt?: unknown;
  };
  return rest as Omit<T, "otpCode" | "otpExpiresAt">;
}

type CacheEntry = { at: number; creator: Creator | null };
const cache = new Map<string, CacheEntry>();
const CACHE_MS = 30_000;

export type CreatorStorefrontBoot = {
  id: string;
  username: string;
  subdomain: string;
  /** Shop handle shown to customers — never the legal / application name. */
  publicName: string;
  niche: string | null;
  bio: string | null;
  profileImageUrl: string | null;
  socialPlatform: string | null;
  socialUsername: string | null;
  socialUrl: string | null;
  status: string;
  branding: Record<string, unknown> | null;
  storefrontUrlPath: string;
  paused: boolean;
};

export async function lookupCreatorByUsername(username: string): Promise<Creator | null> {
  const key = username.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.creator;

  const [row] = await db
    .select()
    .from(creators)
    .where(or(eq(creators.username, key), eq(creators.subdomain, key)))
    .limit(1);

  const creator = row ?? null;
  cache.set(key, { at: Date.now(), creator });
  return creator;
}

export function invalidateCreatorHostCache(username?: string): void {
  if (!username) {
    cache.clear();
    return;
  }
  cache.delete(username.toLowerCase());
}

export function toStorefrontBoot(creator: Creator): CreatorStorefrontBoot {
  const paused = creator.status === "paused" || creator.status === "suspended";
  const branding = (creator.branding as Record<string, unknown> | null) ?? null;
  return {
    id: creator.id,
    username: creator.username,
    subdomain: creator.subdomain,
    publicName: creatorPublicName({ username: creator.username, branding }),
    niche: creator.niche,
    bio: creator.bio,
    profileImageUrl: creator.profileImageUrl,
    socialPlatform: creator.socialPlatform,
    socialUsername: creator.socialUsername,
    socialUrl: creator.socialUrl,
    status: creator.status,
    branding,
    storefrontUrlPath: `/c/${creator.username}`,
    paused,
  };
}

export async function resolveCreatorForRequest(
  req: Request,
): Promise<CreatorStorefrontBoot | null | "reserved" | "not_found" | "disabled"> {
  if (!isCreatorMarketplaceEnabled()) return "disabled";

  const hostSub = extractSubdomainFromHost(req.headers.host);
  const pathUser = extractUsernameFromPath(req.path || req.url?.split("?")[0] || "");
  const raw = hostSub || pathUser;
  if (!raw) return null;

  if (RESERVED_CREATOR_SUBDOMAINS.has(raw)) return "reserved";

  const username = normalizeCreatorUsername(raw);
  if (!username) return "not_found";

  const creator = await lookupCreatorByUsername(username);
  if (!creator) return "not_found";
  if (!STOREFRONT_VISIBLE_STATUSES.has(creator.status)) return "not_found";

  return toStorefrontBoot(creator);
}

export async function getCreatorStorefrontByUsername(
  rawUsername: string,
): Promise<CreatorStorefrontBoot | null> {
  if (!isCreatorMarketplaceEnabled()) return null;
  const username = normalizeCreatorUsername(rawUsername);
  if (!username) return null;
  const creator = await lookupCreatorByUsername(username);
  if (!creator || !STOREFRONT_VISIBLE_STATUSES.has(creator.status)) return null;
  return toStorefrontBoot(creator);
}
