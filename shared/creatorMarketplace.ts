/**
 * Creator Marketplace / Creator Beta — shared constants and helpers.
 * Feature is env-gated via CREATOR_MARKETPLACE_ENABLED (see server/creator-config.ts).
 */

/** Platform accounting cost per completed AI generation (USD). Admin-overridable via platform_config. */
export const DEFAULT_AI_GENERATION_COST_USD = 0.05;

export const PLATFORM_CONFIG_KEYS = {
  AI_GENERATION_COST_USD: "AI_GENERATION_COST_USD",
  CREATOR_TRANSACTION_FEE_PCT: "CREATOR_TRANSACTION_FEE_PCT",
  CREATOR_TRANSACTION_FEE_FIXED_CENTS: "CREATOR_TRANSACTION_FEE_FIXED_CENTS",
} as const;

/** Default free gens each unique customer gets on a creator storefront. */
export const DEFAULT_CREATOR_FREE_GENS_PER_CUSTOMER = 2;

/** Default monthly generation budget for a new creator beta. */
export const DEFAULT_CREATOR_MONTHLY_GENERATION_ALLOWANCE = 250;

export const CREATOR_STATUSES = [
  "application",
  "under_review",
  "accepted",
  "rejected",
  "waitlisted",
  "onboarding",
  "active_beta",
  "beta_completed",
  "partner",
  "paused",
  "suspended",
  "archived",
] as const;
export type CreatorStatus = (typeof CREATOR_STATUSES)[number];

export const CREATOR_APPLICATION_STATUSES = [
  "submitted",
  "under_review",
  "accepted",
  "rejected",
  "waitlisted",
] as const;
export type CreatorApplicationStatus = (typeof CREATOR_APPLICATION_STATUSES)[number];

export const CREATOR_TYPES = ["creator", "shopify_merchant"] as const;
export type CreatorType = (typeof CREATOR_TYPES)[number];

export const CREATOR_SHARE_BASES = ["product_profit", "net_contribution"] as const;
export type CreatorShareBasis = (typeof CREATOR_SHARE_BASES)[number];

export const SOCIAL_PLATFORMS = [
  "instagram",
  "tiktok",
  "youtube",
  "x",
  "facebook",
  "twitch",
  "other",
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/** Reserved subdomains that must never map to a creator. */
export const RESERVED_CREATOR_SUBDOMAINS = new Set([
  "www",
  "app",
  "api",
  "admin",
  "staging",
  "prod",
  "production",
  "cdn",
  "static",
  "assets",
  "mail",
  "email",
  "support",
  "help",
  "status",
  "docs",
  "blog",
  "shop",
  "store",
  "creators",
  "beta",
  "creator",
  "dashboard",
  "login",
  "auth",
  "s",
  "apps",
  "c",
]);

const USERNAME_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/;

/** Normalize + validate a creator username / subdomain. */
export function normalizeCreatorUsername(raw: string): string | null {
  const u = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!u || u.length < 2 || u.length > 32) return null;
  if (!USERNAME_RE.test(u)) return null;
  if (RESERVED_CREATOR_SUBDOMAINS.has(u)) return null;
  return u;
}

export function clampFreeGensPerCustomer(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_CREATOR_FREE_GENS_PER_CUSTOMER;
  return Math.min(10, Math.max(0, Math.floor(n)));
}

export function clampMonthlyGenerationAllowance(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_CREATOR_MONTHLY_GENERATION_ALLOWANCE;
  return Math.min(1_000_000, Math.max(0, Math.floor(n)));
}

/** Parse creator subdomain from Host header (max.aiartstudio.app → max). */
export function extractSubdomainFromHost(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  const host = hostHeader.split(":")[0]?.toLowerCase() || "";
  if (!host || host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;

  if (host.endsWith(".aiartstudio.app")) {
    const sub = host.slice(0, -".aiartstudio.app".length);
    if (!sub || sub.includes(".")) return null;
    return sub;
  }

  if (host.endsWith(".staging.aiartstudio.app")) {
    const sub = host.slice(0, -".staging.aiartstudio.app".length);
    if (!sub || sub.includes(".")) return null;
    return sub;
  }

  return null;
}

/** Parse /c/:username path fallback. */
export function extractUsernameFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/c\/([a-z0-9-]+)(?:\/|$)/i);
  if (!m) return null;
  return normalizeCreatorUsername(m[1]!);
}
