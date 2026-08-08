/**
 * Customizer plan definitions — single source of truth for client + server.
 *
 * Workstream B number-flip (fees / gens / caps / $0.10 overage) is held for a
 * separate go-live. This module consolidates today's live numbers and exposes
 * a tiered-ready overage lookup so billing can pass volume without a rewrite.
 */

export const PLAN_PAGE_LIMITS: Record<string, number> = {
  trial: 1,
  starter: 2,
  dabbler: 5,
  pro: 15,
  pro_plus: 30,
};

/**
 * Max ACTIVE permanent "design products" (merchant-published standalone product
 * listings from My Designs) allowed per plan. Trial gets none.
 */
export const PLAN_DESIGN_PRODUCT_LIMITS: Record<string, number> = {
  trial: 0,
  starter: 1,
  dabbler: 5,
  pro: 15,
  pro_plus: 30,
};

/** Monthly free AI-generation allotment per plan. */
export const PLAN_GENERATION_QUOTAS: Record<string, number> = {
  trial: 20,
  starter: 250,
  dabbler: 600,
  pro: 1500,
  pro_plus: 3000,
};

/**
 * One overage price tier. `upToInclusive` is the 1-based overage unit index
 * (the Nth overage gen in the billing bucket). `null` = open-ended.
 */
export type OveragePriceTier = {
  upToInclusive: number | null;
  priceUsd: number;
};

/**
 * Flat schedule today ($0.08). Swap in multi-tier rows later (e.g. 10c → 8c → 6c)
 * without changing the emit call site — pass `overageSeq` as volume.
 */
export const OVERAGE_PRICE_SCHEDULE: readonly OveragePriceTier[] = [
  { upToInclusive: null, priceUsd: 0.08 },
];

/** Headline / first-tier overage price (display + single-tier billing). */
export const OVERAGE_PRICE_USD = OVERAGE_PRICE_SCHEDULE[0]!.priceUsd;

/** Max extra (overage) generations allowed per calendar month, per paid plan. */
export const PLAN_OVERAGE_CAPS: Record<string, number> = {
  starter: 200,
  dabbler: 300,
  pro: 500,
  pro_plus: 1000,
};

/** Monthly price in USD. */
export const PLAN_PRICES_USD: Record<string, number> = {
  starter: 29,
  dabbler: 49,
  pro: 99,
  pro_plus: 199,
};

export const PLAN_DISPLAY_NAMES: Record<string, string> = {
  trial: "Trial",
  starter: "Starter",
  dabbler: "Dabbler",
  pro: "Pro",
  pro_plus: "Pro Plus",
};

export const PAID_PLANS = ["starter", "dabbler", "pro", "pro_plus"] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

export type PlanDefinition = {
  planName: string;
  displayName: string;
  priceUsd: number;
  pageLimit: number;
  generationQuota: number;
  overageCap: number;
  designProductLimit: number;
};

/** Paid plan rows for pickers / estimators — always derived from the Records above. */
export const PAID_PLAN_DEFINITIONS: PlanDefinition[] = PAID_PLANS.map((planName) => ({
  planName,
  displayName: PLAN_DISPLAY_NAMES[planName] ?? planName,
  priceUsd: PLAN_PRICES_USD[planName] ?? 0,
  pageLimit: PLAN_PAGE_LIMITS[planName] ?? 0,
  generationQuota: PLAN_GENERATION_QUOTAS[planName] ?? 0,
  overageCap: PLAN_OVERAGE_CAPS[planName] ?? 0,
  designProductLimit: PLAN_DESIGN_PRODUCT_LIMITS[planName] ?? 0,
}));

/**
 * Resolve per-overage-unit price.
 *
 * @param volume 1-based overage sequence in the current bucket (the unit just
 *   consumed). Omit for the headline / first-tier rate used in UI copy.
 * @param schedule injectable for tests / future multi-tier rollout
 */
export function resolveOveragePriceUsd(
  volume?: number,
  schedule: readonly OveragePriceTier[] = OVERAGE_PRICE_SCHEDULE,
): number {
  if (!schedule.length) return 0;
  if (volume == null || !Number.isFinite(volume)) {
    return schedule[0]!.priceUsd;
  }
  const v = Math.max(1, Math.floor(volume));
  for (const tier of schedule) {
    if (tier.upToInclusive == null || v <= tier.upToInclusive) {
      return tier.priceUsd;
    }
  }
  return schedule[schedule.length - 1]!.priceUsd;
}

/** Sum of per-unit prices for the first `units` overage gens (tier-aware). */
export function overageCostForUnitsUsd(
  units: number,
  schedule: readonly OveragePriceTier[] = OVERAGE_PRICE_SCHEDULE,
): number {
  const n = Math.max(0, Math.floor(units));
  let total = 0;
  for (let i = 1; i <= n; i++) {
    total += resolveOveragePriceUsd(i, schedule);
  }
  return Math.round(total * 100) / 100;
}

/**
 * Shopify usage-line `cappedAmount` for a plan = cost of charging every
 * overage unit up to the plan cap (tier-aware).
 */
export function getPlanOverageCappedAmountUsd(planName: string | null | undefined): number {
  if (!planName) return 0;
  const cap = PLAN_OVERAGE_CAPS[planName] ?? 0;
  return overageCostForUnitsUsd(cap);
}

/** Human-readable terms shown on the metered (usage) pricing line at approval. */
export const OVERAGE_USAGE_TERMS = `$${OVERAGE_PRICE_USD.toFixed(2)} USD per additional AI generation beyond your monthly included allotment (pay-as-you-go; requires in-app opt-in; not a prepaid pack)`;

export function getPageLimit(planName: string | null | undefined): number {
  if (!planName) return 0;
  return PLAN_PAGE_LIMITS[planName] ?? 0;
}

export function getDesignProductLimit(planName: string | null | undefined): number {
  if (!planName) return 0;
  return PLAN_DESIGN_PRODUCT_LIMITS[planName] ?? 0;
}

/**
 * Pricing catalogue version for grandfathering.
 * `null` on an installation = pre-versioned / current SSOT (no flip applied yet).
 * B number-flip go-live will bump CURRENT_PRICING_VERSION and stamp new subs.
 */
export const CURRENT_PRICING_VERSION = 0;
