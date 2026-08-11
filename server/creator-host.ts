/**
 * Resolve creator storefronts from Host subdomain or /c/:username path.
 */
import { eq, or } from "drizzle-orm";
import type { Request } from "express";
import { db } from "./db";
import { creators, type Creator } from "@shared/schema";
import {
  RESERVED_CREATOR_SUBDOMAINS,
  extractSubdomainFromHost,
  extractUsernameFromPath,
  normalizeCreatorUsername,
} from "@shared/creatorMarketplace";
import { isCreatorMarketplaceEnabled } from "./creator-config";

export { extractSubdomainFromHost, extractUsernameFromPath };

const STOREFRONT_VISIBLE_STATUSES = new Set([
  "onboarding",
  "active_beta",
  "partner",
  "paused",
]);

type CacheEntry = { at: number; creator: Creator | null };
const cache = new Map<string, CacheEntry>();
const CACHE_MS = 30_000;

export type CreatorStorefrontBoot = {
  id: string;
  username: string;
  subdomain: string;
  displayName: string;
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

async function lookupCreatorByUsername(username: string): Promise<Creator | null> {
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
  return {
    id: creator.id,
    username: creator.username,
    subdomain: creator.subdomain,
    displayName: creator.displayName,
    niche: creator.niche,
    bio: creator.bio,
    profileImageUrl: creator.profileImageUrl,
    socialPlatform: creator.socialPlatform,
    socialUsername: creator.socialUsername,
    socialUrl: creator.socialUrl,
    status: creator.status,
    branding: (creator.branding as Record<string, unknown> | null) ?? null,
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
