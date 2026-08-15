/**
 * Resolve creator storefronts from Host subdomain or /c/:username path.
 * Also exposes public API validation for generate / analytics / cart (Phase 10).
 */
import { eq, inArray, or } from "drizzle-orm";
import type { Request } from "express";
import { db } from "./db";
import { creatorApplications, creators, type Creator } from "@shared/schema";
import {
  applicationStatusForCreatorStatus,
  CREATOR_HANDLE_HOLDING_APPLICATION_STATUSES,
  CREATOR_HANDLE_INVALID_MESSAGE,
  CREATOR_HANDLE_NUMBERED_VARIANT_MESSAGE,
  CREATOR_HANDLE_TAKEN_MESSAGE,
  RESERVED_CREATOR_SUBDOMAINS,
  creatorPublicName,
  creatorStorefrontHomeUrl,
  extractSubdomainFromHost,
  extractUsernameFromPath,
  findConflictingHandle,
  normalizeCreatorUsername,
  sanitizeCreatorReturnUrl,
  parseCreatorSocials,
  sanitizeCreatorShopName,
  shopNameToHandle,
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
  socials: Array<{ platform: string; username: string; url: string | null }>;
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
    socials: parseCreatorSocials(creator.socials, {
      platform: creator.socialPlatform,
      username: creator.socialUsername,
      url: creator.socialUrl,
    }),
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

export type CreatorHandleAvailability =
  | { ok: true; handle: string; shopName: string }
  | {
      ok: false;
      status: number;
      error: string;
      code: "CREATOR_HANDLE_INVALID" | "CREATOR_HANDLE_TAKEN" | "CREATOR_HANDLE_NUMBERED_VARIANT";
      handle: string | null;
      takenHandle?: string;
    };

/**
 * Shop-name → unique URL handle. Never appends digits; numbered variants of a
 * taken name are treated as the same shop.
 */
export async function resolveCreatorHandleAvailability(opts: {
  rawName: string;
  excludeApplicationId?: string | null;
  excludeCreatorId?: string | null;
}): Promise<CreatorHandleAvailability> {
  const shopName = sanitizeCreatorShopName(opts.rawName);
  const handle = shopName ? shopNameToHandle(shopName) : null;
  if (!shopName || !handle) {
    return {
      ok: false,
      status: 400,
      error: CREATOR_HANDLE_INVALID_MESSAGE,
      code: "CREATOR_HANDLE_INVALID",
      handle,
    };
  }

  const [creatorRows, applicationRows] = await Promise.all([
    db
      .select({
        id: creators.id,
        username: creators.username,
        subdomain: creators.subdomain,
      })
      .from(creators),
    db
      .select({
        id: creatorApplications.id,
        assignedUsername: creatorApplications.assignedUsername,
        shopName: creatorApplications.shopName,
        status: creatorApplications.status,
      })
      .from(creatorApplications),
  ]);

  const taken: string[] = [];
  for (const row of creatorRows) {
    if (opts.excludeCreatorId && row.id === opts.excludeCreatorId) continue;
    if (row.username) taken.push(row.username);
    if (row.subdomain) taken.push(row.subdomain);
  }
  const holding = new Set<string>(CREATOR_HANDLE_HOLDING_APPLICATION_STATUSES);
  for (const row of applicationRows) {
    if (opts.excludeApplicationId && row.id === opts.excludeApplicationId) continue;
    if (!holding.has(row.status)) continue;
    if (row.assignedUsername) taken.push(row.assignedUsername);
    if (row.shopName) taken.push(row.shopName);
  }

  const conflict = findConflictingHandle(handle, taken);
  if (conflict) {
    const numbered = conflict !== handle;
    return {
      ok: false,
      status: 409,
      error: numbered ? CREATOR_HANDLE_NUMBERED_VARIANT_MESSAGE : CREATOR_HANDLE_TAKEN_MESSAGE,
      code: numbered ? "CREATOR_HANDLE_NUMBERED_VARIANT" : "CREATOR_HANDLE_TAKEN",
      handle,
      takenHandle: conflict,
    };
  }

  return { ok: true, handle, shopName };
}

/** Rename a live creator URL handle + subdomain and keep the linked application in sync. */
export async function renameCreatorHandle(opts: {
  creatorId: string;
  currentUsername: string;
  nextHandle: string;
  applicationId?: string | null;
}): Promise<void> {
  const next = normalizeCreatorUsername(opts.nextHandle);
  if (!next || next === opts.currentUsername) return;

  await db
    .update(creators)
    .set({
      username: next,
      subdomain: next,
      updatedAt: new Date(),
    })
    .where(eq(creators.id, opts.creatorId));

  if (opts.applicationId) {
    await db
      .update(creatorApplications)
      .set({ assignedUsername: next, updatedAt: new Date() })
      .where(eq(creatorApplications.id, opts.applicationId));
  } else {
    await db
      .update(creatorApplications)
      .set({ assignedUsername: next, updatedAt: new Date() })
      .where(eq(creatorApplications.creatorId, opts.creatorId));
  }

  invalidateCreatorHostCache(opts.currentUsername);
  invalidateCreatorHostCache(next);
}

/**
 * Keep the application queue in sync with a live creator.
 * Waitlisted / under-review rows for the same handle flip to accepted and get linked.
 */
export async function syncLinkedApplicationFromCreator(creator: {
  id: string;
  applicationId?: string | null;
  username?: string | null;
  subdomain?: string | null;
  status: string;
}): Promise<void> {
  const nextStatus = applicationStatusForCreatorStatus(creator.status);
  if (!nextStatus) return;

  const handle =
    normalizeCreatorUsername(creator.username || "") ||
    normalizeCreatorUsername(creator.subdomain || "");

  const rows = await db
    .select({
      id: creatorApplications.id,
      status: creatorApplications.status,
      creatorId: creatorApplications.creatorId,
      assignedUsername: creatorApplications.assignedUsername,
      shopName: creatorApplications.shopName,
    })
    .from(creatorApplications);

  const ids: string[] = [];
  for (const row of rows) {
    const directlyLinked =
      row.creatorId === creator.id ||
      (!!creator.applicationId && row.id === creator.applicationId);
    const sameHandle =
      !!handle &&
      (shopNameToHandle(row.assignedUsername || "") === handle ||
        shopNameToHandle(row.shopName || "") === handle);
    if (!directlyLinked && !sameHandle) continue;
    if (row.status === "rejected" && !directlyLinked) continue;
    if (row.status === nextStatus && row.creatorId === creator.id) continue;
    ids.push(row.id);
  }

  if (ids.length === 0) return;

  await db
    .update(creatorApplications)
    .set({
      status: nextStatus,
      creatorId: creator.id,
      ...(handle ? { assignedUsername: handle } : {}),
      updatedAt: new Date(),
    })
    .where(inArray(creatorApplications.id, ids));
}

/** Heal every live creator's application row (used when the admin queue loads). */
export async function healApplicationStatusesFromCreators(): Promise<void> {
  const [creatorRows, appRows] = await Promise.all([
    db
      .select({
        id: creators.id,
        applicationId: creators.applicationId,
        username: creators.username,
        subdomain: creators.subdomain,
        status: creators.status,
      })
      .from(creators),
    db
      .select({
        id: creatorApplications.id,
        status: creatorApplications.status,
        creatorId: creatorApplications.creatorId,
        assignedUsername: creatorApplications.assignedUsername,
        shopName: creatorApplications.shopName,
      })
      .from(creatorApplications),
  ]);

  const live = creatorRows.filter(
    (row) => applicationStatusForCreatorStatus(row.status) === "accepted",
  );
  if (live.length === 0 || appRows.length === 0) return;

  const byId = new Map(live.map((c) => [c.id, c]));
  const byAppId = new Map<string, (typeof live)[0]>();
  const byHandle = new Map<string, (typeof live)[0]>();
  for (const c of live) {
    if (c.applicationId) byAppId.set(c.applicationId, c);
    const handle =
      normalizeCreatorUsername(c.username || "") ||
      normalizeCreatorUsername(c.subdomain || "");
    if (handle) byHandle.set(handle, c);
  }

  const idsByCreator = new Map<string, { handle: string | null; ids: string[] }>();
  for (const row of appRows) {
    const creator =
      (row.creatorId ? byId.get(row.creatorId) : undefined) ||
      byAppId.get(row.id) ||
      byHandle.get(shopNameToHandle(row.assignedUsername || "") || "") ||
      byHandle.get(shopNameToHandle(row.shopName || "") || "");
    if (!creator) continue;
    const directlyLinked = row.creatorId === creator.id || creator.applicationId === row.id;
    if (row.status === "rejected" && !directlyLinked) continue;
    if (row.status === "accepted" && row.creatorId === creator.id) continue;
    const handle =
      normalizeCreatorUsername(creator.username || "") ||
      normalizeCreatorUsername(creator.subdomain || "");
    const bucket = idsByCreator.get(creator.id) || { handle, ids: [] };
    bucket.ids.push(row.id);
    idsByCreator.set(creator.id, bucket);
  }

  for (const [creatorId, bucket] of idsByCreator) {
    if (bucket.ids.length === 0) continue;
    await db
      .update(creatorApplications)
      .set({
        status: "accepted",
        creatorId,
        ...(bucket.handle ? { assignedUsername: bucket.handle } : {}),
        updatedAt: new Date(),
      })
      .where(inArray(creatorApplications.id, bucket.ids));
  }
}

function appOrigins(): string[] {
  return [process.env.PUBLIC_APP_URL, process.env.APP_URL]
    .map((v) => String(v || "").trim().replace(/\/$/, ""))
    .filter(Boolean);
}

/** Line + cart attributes so checkout can send the shopper back to this creator. */
export function creatorReturnCheckoutAttributes(
  creator: Creator,
  rawReturnUrl?: string | null,
): Array<{ key: string; value: string }> {
  const origin = appOrigins()[0] || "https://aiartstudio.app";
  const fallback = creatorStorefrontHomeUrl({ username: creator.username, origin });
  const returnUrl = sanitizeCreatorReturnUrl(rawReturnUrl, fallback, appOrigins());
  const shopName = creatorPublicName({
    username: creator.username,
    branding: (creator.branding as Record<string, unknown> | null) ?? null,
  });
  return [
    { key: "_creator_return_url", value: returnUrl.slice(0, 255) },
    { key: "_creator_shop_name", value: shopName.slice(0, 120) },
    // Checkout UI `useAttributeValues` often omits underscore keys. Public
    // aliases keep “Back to shop” visible under the native header.
    { key: "creator_return_url", value: returnUrl.slice(0, 255) },
    { key: "creator_shop_name", value: shopName.slice(0, 120) },
  ];
}
