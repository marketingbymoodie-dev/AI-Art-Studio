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
  SEED_PRICING_VERSION,
  PLATFORM_AI_COST_PER_GEN_USD,
  OVERAGE_USAGE_TERMS,
  getPageLimit,
  getDesignProductLimit,
  getPlanOverageCappedAmountUsd,
  resolveOveragePriceUsd,
  overageCostForUnitsUsd,
  buildSeedCatalogueSnapshot,
  planDefinitionsFromCatalogue,
  findCataloguePlan,
  priceFromMarginOverAiCost,
  aiCostAtFullAllowanceUsd,
  type PaidPlan,
  type PlanDefinition,
  type OveragePriceTier,
  type PricingCatalogueSnapshot,
  type CataloguePlanRow,
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
  type PricingCatalogueSnapshot,
  findCataloguePlan,
} from "@shared/customizerPlans";
import { isOwnerShopDomain } from "./platformAdmin";

/** Merchant My Designs save/library — Starter and above only (not trial / inactive). */
export function canSaveMerchantDesigns(
  planName: string | null | undefined,
  planStatus: string | null | undefined,
): boolean {
  const isActive = planStatus === "trialing" || planStatus === "active";
  return isActive && !!planName && (PAID_PLANS as readonly string[]).includes(planName);
}

/**
 * When false/0/off/no, OWNER_SHOP_DOMAIN still grants platform-admin access but
 * does **not** force Pro Plus / unlimited metering / skip-Shopify billing.
 * Default (unset): bypass on. Staging QA: set OWNER_BYPASS_QUOTA=false.
 */
export function isOwnerQuotaBypassEnabled(): boolean {
  const v = (process.env.OWNER_BYPASS_QUOTA ?? "true").toLowerCase().trim();
  return v !== "false" && v !== "0" && v !== "off" && v !== "no";
}

/** True when shopDomain matches an owner shop (env + built-in demo). */
export function shopMatchesOwnerDomain(shopDomain?: string | null): boolean {
  return isOwnerShopDomain(shopDomain);
}

/**
 * Owner shop with quota bypass enabled — unlimited metering / forced Pro Plus.
 * Platform admin still uses OWNER_SHOP_DOMAIN alone (see platformAdmin.ts).
 */
export function isOwnerQuotaBypassShop(shopDomain?: string | null): boolean {
  return isOwnerQuotaBypassEnabled() && shopMatchesOwnerDomain(shopDomain);
}

/**
 * Derive the effective plan status for an installation.
 * Returns a normalized object the UI and server can act on.
 *
 * If OWNER_SHOP_DOMAIN matches and OWNER_BYPASS_QUOTA is enabled (default),
 * returns Pro Plus active — bypasses billing/DB plan state for the developer store.
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
  if (isOwnerQuotaBypassShop(shopDomain)) {
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
   * `resolveOveragePriceUsd(overageSeq, overageSchedule)` so volume can select a tier.
   */
  overagePriceUsd: number;
  /** Catalogue schedule for volume-aware emit (optional; defaults to seed). */
  overageSchedule?: import("@shared/customizerPlans").OveragePriceTier[];
  /** Catalogue id this quota was resolved from. */
  pricingVersion?: number;
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
  now: Date = new Date(),
  catalogue?: PricingCatalogueSnapshot | null,
): GenerationQuotaConfig {
  const catPlan = catalogue ? findCataloguePlan(catalogue, planName) : null;
  const isPaidActive = catalogue
    ? !!(
        isActive &&
        catPlan &&
        catPlan.planKey !== "trial" &&
        (catPlan.priceUsd > 0 || catPlan.generationQuota > 0)
      )
    : isActive && !!planName && (PAID_PLANS as readonly string[]).includes(planName);

  const schedule = catalogue?.overageSchedule;
  const pricingVersion = catalogue?.id;

  if (isPaidActive) {
    const freeQuota = catPlan?.generationQuota ?? PLAN_GENERATION_QUOTAS[planName!] ?? 0;
    const overageCap = catPlan?.overageCapUnits ?? PLAN_OVERAGE_CAPS[planName!] ?? 0;
    return {
      effectivePlan: planName!,
      freeQuota,
      overageCap,
      hardCap: freeQuota + overageCap,
      overagePriceUsd: overageCap > 0 ? resolveOveragePriceUsd(undefined, schedule) : 0,
      overageSchedule: schedule ? schedule.map((t) => ({ ...t })) : undefined,
      pricingVersion,
      bucketKey: generationMonthKey(now),
      monthly: true,
    };
  }

  // Trial / no plan / inactive → cumulative free, no overage.
  const trialPlan = catalogue ? findCataloguePlan(catalogue, "trial") : null;
  const freeQuota = trialPlan?.generationQuota ?? PLAN_GENERATION_QUOTAS["trial"] ?? 20;
  return {
    effectivePlan: "trial",
    freeQuota,
    overageCap: 0,
    hardCap: freeQuota,
    overagePriceUsd: 0,
    overageSchedule: schedule ? schedule.map((t) => ({ ...t })) : undefined,
    pricingVersion,
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
