/**
 * Customizer Page Plan Limits
 *
 * Maps plan name → max customizer pages allowed.
 * The plan state lives on shopifyInstallations.planName / planStatus.
 *
 * Numeric plan table (fees, gens, pages, overage) lives in
 * `@shared/customizerPlans` — import from there (or re-exports below).
 */

export {
  PLAN_PAGE_LIMITS,
  PLAN_DESIGN_PRODUCT_LIMITS,
  PLAN_GENERATION_QUOTAS,
  OVERAGE_PRICE_SCHEDULE,
  OVERAGE_PRICE_USD,
  PLAN_OVERAGE_CAPS,
  PLAN_PRICES_USD,
  PLAN_DISPLAY_NAMES,
  PAID_PLANS,
  PAID_PLAN_DEFINITIONS,
  CURRENT_PRICING_VERSION,
  OVERAGE_USAGE_TERMS,
  getPageLimit,
  getDesignProductLimit,
  getPlanOverageCappedAmountUsd,
  resolveOveragePriceUsd,
  overageCostForUnitsUsd,
  type PaidPlan,
  type PlanDefinition,
  type OveragePriceTier,
} from "@shared/customizerPlans";

import {
  PAID_PLANS,
  PLAN_PAGE_LIMITS,
  PLAN_GENERATION_QUOTAS,
  PLAN_OVERAGE_CAPS,
  PLAN_DISPLAY_NAMES,
  getPageLimit,
  getDesignProductLimit,
  resolveOveragePriceUsd,
} from "@shared/customizerPlans";

/** Merchant My Designs save/library — Starter and above only (not trial / inactive). */
export function canSaveMerchantDesigns(
  planName: string | null | undefined,
  planStatus: string | null | undefined,
): boolean {
  const isActive = planStatus === "trialing" || planStatus === "active";
  return isActive && !!planName && (PAID_PLANS as readonly string[]).includes(planName);
}

/**
 * Derive the effective plan status for an installation.
 * Returns a normalized object the UI and server can act on.
 *
 * If OWNER_SHOP_DOMAIN env var is set and shopDomain matches, unconditionally
 * returns Pro Plus active — bypasses all billing/DB state for the developer's store.
 */
export function getEffectivePlan(
  installation: {
    planName?: string | null;
    planStatus?: string | null;
    trialStartedAt?: Date | null;
    billingCurrentPeriodEnd?: Date | null;
  },
  shopDomain?: string
): {
  planName: string | null;
  planStatus: string | null;
  isActive: boolean;
  requiresPlan: boolean;
  pageLimit: number;
  displayName: string;
} {
  // Owner bypass: env-var-configured shop always gets Pro Plus without payment
  const ownerShop = process.env.OWNER_SHOP_DOMAIN?.toLowerCase().trim();
  if (ownerShop && shopDomain && shopDomain.toLowerCase().replace(/^https?:\/\//, "") === ownerShop) {
    return {
      planName: "pro_plus",
      planStatus: "active",
      isActive: true,
      requiresPlan: false,
      pageLimit: PLAN_PAGE_LIMITS["pro_plus"],
      displayName: "Pro Plus (Owner)",
    };
  }

  const planName = installation.planName ?? null;
  const planStatus = installation.planStatus ?? null;

  // Active if trialing or paid + active
  const isActive = planStatus === "trialing" || planStatus === "active";

  return {
    planName,
    planStatus,
    isActive,
    requiresPlan: !isActive,
    pageLimit: isActive ? getPageLimit(planName) : 0,
    displayName: planName ? (PLAN_DISPLAY_NAMES[planName] ?? planName) : "No plan",
  };
}

/**
 * Resolve the monthly generation quota config for an effective plan.
 *
 * Returns the free allotment, overage cap, overage price, and the counter
 * "bucket key" that the per-merchant monthly counters belong to:
 *   - Paid+active plans bucket per calendar month → key "YYYY-MM" (UTC),
 *     resets automatically when the month changes.
 *   - Trial / no-plan / inactive bucket cumulatively → key "trial" (the 20
 *     free generations are a lifetime total, NOT monthly, and never reset).
 *
 * `now` is injectable for testing.
 */
export interface GenerationQuotaConfig {
  /** The plan the quota is derived from (may differ from raw planName when inactive → trial fallback). */
  effectivePlan: string;
  /** Free generations included in the bucket. */
  freeQuota: number;
  /** Max extra (overage) generations beyond the free allotment in the bucket. */
  overageCap: number;
  /** Hard cap for the bucket = freeQuota + overageCap. */
  hardCap: number;
  /**
   * Headline overage price (first tier). Emit path must call
   * `resolveOveragePriceUsd(overageSeq)` so volume can select a tier.
   */
  overagePriceUsd: number;
  /** Counter bucket key the monthly counters belong to. */
  bucketKey: string;
  /** Whether the bucket resets per calendar month (paid) or is cumulative (trial). */
  monthly: boolean;
}

/** UTC calendar-month key, e.g. "2026-06". */
export function generationMonthKey(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Derive the generation quota config from a plan name + active flag.
 *
 * A merchant on an active PAID plan gets that plan's monthly quota + overage.
 * Anyone else (trial, no plan, expired, cancelled) falls back to the trial
 * allotment: 20 free generations total, no overage, upgrade-to-Starter to continue.
 */
export function resolveGenerationQuota(
  planName: string | null | undefined,
  isActive: boolean,
  now: Date = new Date()
): GenerationQuotaConfig {
  const isPaidActive =
    isActive && !!planName && (PAID_PLANS as readonly string[]).includes(planName);

  if (isPaidActive) {
    const freeQuota = PLAN_GENERATION_QUOTAS[planName!] ?? 0;
    const overageCap = PLAN_OVERAGE_CAPS[planName!] ?? 0;
    return {
      effectivePlan: planName!,
      freeQuota,
      overageCap,
      hardCap: freeQuota + overageCap,
      overagePriceUsd: overageCap > 0 ? resolveOveragePriceUsd() : 0,
      bucketKey: generationMonthKey(now),
      monthly: true,
    };
  }

  // Trial / no plan / inactive → cumulative 20 free, no overage.
  const freeQuota = PLAN_GENERATION_QUOTAS["trial"] ?? 20;
  return {
    effectivePlan: "trial",
    freeQuota,
    overageCap: 0,
    hardCap: freeQuota,
    overagePriceUsd: 0,
    bucketKey: "trial",
    monthly: false,
  };
}

/**
 * Pure decision for consuming one generation against a bucket's quota.
 *
 * Single source of truth for the cap/overage math, shared by the storage-layer
 * atomic consume and unit tests.
 *
 * @param currentUsed total generations already used in the bucket (free + overage)
 * @param freeQuota   free allotment for the bucket
 * @param overageCap  extra allowed beyond the free allotment
 */
export function computeGenerationConsume(
  currentUsed: number,
  freeQuota: number,
  overageCap: number
): { allowed: boolean; isOverage: boolean; hardCap: number } {
  const hardCap = freeQuota + overageCap;
  const allowed = currentUsed < hardCap;
  // The unit being consumed is overage when the free allotment is already spent.
  const isOverage = allowed && currentUsed >= freeQuota;
  return { allowed, isOverage, hardCap };
}

/**
 * Check whether a shop can create another customizer page.
 */
export function canCreatePage(
  planName: string | null | undefined,
  currentCount: number
): { allowed: boolean; limit: number; currentCount: number } {
  const limit = getPageLimit(planName);
  return { allowed: currentCount < limit, limit, currentCount };
}

/** Check whether a shop can activate another permanent design product. */
export function canActivateDesignProduct(
  planName: string | null | undefined,
  currentActiveCount: number
): { allowed: boolean; limit: number; currentCount: number } {
  const limit = getDesignProductLimit(planName);
  return { allowed: currentActiveCount < limit, limit, currentCount: currentActiveCount };
}
