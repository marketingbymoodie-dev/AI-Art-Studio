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

/** Default Shopify Payments-style fee (percent of charged amount). */
export const DEFAULT_CREATOR_TRANSACTION_FEE_PCT = 2.9;

/** Default fixed fee per order (cents), e.g. Shopify Payments $0.30. */
export const DEFAULT_CREATOR_TRANSACTION_FEE_FIXED_CENTS = 30;

/** Attribution event types (Phase 4). */
export const CREATOR_EVENT_TYPES = [
  "page_view",
  "customizer_open",
  "generation",
  "atc",
  "checkout_started",
] as const;
export type CreatorEventType = (typeof CREATOR_EVENT_TYPES)[number];

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

/** Pure P&L helpers (Phase 5) — unit-tested; no DB. */
export type CreatorOrderPnlInput = {
  grossCents: number;
  discountCents: number;
  fulfilmentCostCents: number;
  transactionFeeCents: number;
  aiGenCostCents: number;
  refundCents?: number;
  shareBasis: CreatorShareBasis;
  revenueShareCreatorPct: number;
  revenueShareAasPct: number;
};

export type CreatorOrderPnlResult = {
  productProfitCents: number;
  netContributionCents: number;
  creatorShareCents: number;
  aasShareCents: number;
};

export function computeTransactionFeeCents(params: {
  amountCents: number;
  feePct?: number;
  feeFixedCents?: number;
}): number {
  const amount = Math.max(0, Math.round(params.amountCents || 0));
  const pct =
    params.feePct != null && Number.isFinite(params.feePct)
      ? Math.max(0, params.feePct)
      : DEFAULT_CREATOR_TRANSACTION_FEE_PCT;
  const fixed =
    params.feeFixedCents != null && Number.isFinite(params.feeFixedCents)
      ? Math.max(0, Math.round(params.feeFixedCents))
      : DEFAULT_CREATOR_TRANSACTION_FEE_FIXED_CENTS;
  if (amount <= 0) return 0;
  return Math.round((amount * pct) / 100) + fixed;
}

/**
 * Product Profit = gross − discounts − fulfilment/COGS − txn fees − refunds.
 * Net Creator Contribution = Product Profit − AI generation costs.
 * Shares apply to the chosen basis (`product_profit` | `net_contribution`).
 */
export function computeCreatorOrderPnl(input: CreatorOrderPnlInput): CreatorOrderPnlResult {
  const gross = Math.max(0, Math.round(input.grossCents || 0));
  const discount = Math.max(0, Math.round(input.discountCents || 0));
  const fulfilment = Math.max(0, Math.round(input.fulfilmentCostCents || 0));
  const fee = Math.max(0, Math.round(input.transactionFeeCents || 0));
  const ai = Math.max(0, Math.round(input.aiGenCostCents || 0));
  const refund = Math.max(0, Math.round(input.refundCents || 0));

  const productProfitCents = gross - discount - fulfilment - fee - refund;
  const netContributionCents = productProfitCents - ai;

  const creatorPct = Math.min(
    100,
    Math.max(0, Math.round(input.revenueShareCreatorPct || 0)),
  );
  const aasPct = Math.min(
    100,
    Math.max(0, Math.round(input.revenueShareAasPct || 0)),
  );
  const basis =
    input.shareBasis === "product_profit" ? productProfitCents : netContributionCents;
  const creatorShareCents = Math.round((basis * creatorPct) / 100);
  const aasShareCents =
    aasPct > 0 && creatorPct + aasPct === 100
      ? basis - creatorShareCents
      : Math.round((basis * aasPct) / 100);

  return {
    productProfitCents,
    netContributionCents,
    creatorShareCents,
    aasShareCents,
  };
}

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
