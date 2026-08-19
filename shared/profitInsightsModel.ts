/**
 * Profit Insights calculator model (Workstream A).
 *
 * Pure math — no React. Plans come from shared/customizerPlans SSOT.
 * Take/redeem rates are internal defaults (not merchant-editable/visible).
 * Page count is modelled calculator rows (not live customizer-pages API) — see
 * docs/profit-insights-model.md.
 */

import {
  OVERAGE_PRICE_USD,
  PAID_PLAN_DEFINITIONS,
  type PlanDefinition,
} from "./customizerPlans";
import { planOverageEstimate } from "./planEstimator";

/** Internal take/redeem defaults — operator cost assumptions only. */
export const INTERNAL_FUNNEL_RATES = {
  /** Partial use of free allowance (second unit reuses design). */
  freeGensPer: 1.5,
  emailTakePct: 5,
  emailGensPer: 1,
  shareTakePct: 1.5,
  shareGensPer: 1,
  purchaseRedeemPct: 40,
  purchaseGensPer: 3,
} as const;

/** Grant amounts typically loaded from Settings; these are fallbacks. */
export type ProfitInsightsGrants = {
  freeGensPerVisitor: number;
  emailCredits: number;
  shareCredits: number;
  purchaseCredits: number;
  emailEnabled: boolean;
  shareEnabled: boolean;
  purchaseEnabled: boolean;
};

export type ModelledPage = {
  id: string;
  /** Catalogue product label (display). */
  label: string;
  cogsUsd: number;
  orders: number;
  unitsPerOrder: number;
  /** Cross/up-sell % for this page (0–100). */
  crossSellPct: number;
};

export type FunnelInputs = {
  visitors: number;
  engagementPct: number;
  conversionPct: number;
};

export function totalOrdersFromFunnel(f: FunnelInputs): number {
  const eng = Math.min(100, Math.max(0, f.engagementPct)) / 100;
  const conv = Math.min(100, Math.max(0, f.conversionPct)) / 100;
  return Math.round(Math.max(0, f.visitors) * eng * conv);
}

export function engagedFromFunnel(f: FunnelInputs): number {
  const eng = Math.min(100, Math.max(0, f.engagementPct)) / 100;
  return Math.round(Math.max(0, f.visitors) * eng);
}

/** Rescale page orders to hit targetTotal while preserving shares. */
export function rescalePageOrders<T extends { orders: number }>(
  pages: T[],
  targetTotal: number,
): T[] {
  const target = Math.max(0, Math.round(targetTotal));
  if (pages.length === 0) return pages;
  const cur = pages.reduce((s, p) => s + Math.max(0, p.orders), 0);
  if (cur <= 0) {
    const each = Math.floor(target / pages.length);
    let rem = target - each * pages.length;
    return pages.map((p, i) => ({
      ...p,
      orders: each + (i === 0 ? rem : 0),
    }));
  }
  let assigned = 0;
  return pages.map((p, i) => {
    if (i === pages.length - 1) {
      return { ...p, orders: Math.max(0, target - assigned) };
    }
    const o = Math.round(target * (Math.max(0, p.orders) / cur));
    assigned += o;
    return { ...p, orders: o };
  });
}

/** Re-derive visitors from total orders + funnel rates. */
export function visitorsFromOrders(
  totalOrders: number,
  engagementPct: number,
  conversionPct: number,
): number {
  const eng = Math.min(100, Math.max(0, engagementPct)) / 100;
  const conv = Math.min(100, Math.max(0, conversionPct)) / 100;
  const denom = eng * conv;
  if (denom <= 0) return 0;
  return Math.round(Math.max(0, totalOrders) / denom);
}

export function retailAtMarginUsd(cogsUsd: number, marginPct: number): number {
  const m = Math.min(99, Math.max(1, marginPct)) / 100;
  if (cogsUsd <= 0) return 0;
  return Math.round((cogsUsd / (1 - m)) * 100) / 100;
}

export type PageMetrics = ModelledPage & {
  share: number;
  engaged: number;
  retailUsd: number;
  unitMarginUsd: number;
  gens: number;
  gFree: number;
  gEmail: number;
  gShare: number;
  gPurchase: number;
  leads: number;
  baseProfitUsd: number;
  simUnitProfitUsd: number;
};

export function computePageMetrics(args: {
  pages: ModelledPage[];
  funnel: FunnelInputs;
  marginTargetPct: number;
  grants: ProfitInsightsGrants;
  rates?: typeof INTERNAL_FUNNEL_RATES;
}): PageMetrics[] {
  const rates = args.rates ?? INTERNAL_FUNNEL_RATES;
  const totalOrders = args.pages.reduce((s, p) => s + Math.max(0, p.orders), 0);
  const engagedTotal = engagedFromFunnel(args.funnel);
  const freePer =
    args.grants.freeGensPerVisitor > 0
      ? Math.min(rates.freeGensPer, args.grants.freeGensPerVisitor)
      : rates.freeGensPer;
  const emailGensPer = args.grants.emailEnabled
    ? Math.min(rates.emailGensPer, Math.max(0, args.grants.emailCredits))
    : 0;
  const shareGensPer = args.grants.shareEnabled
    ? Math.min(rates.shareGensPer, Math.max(0, args.grants.shareCredits))
    : 0;
  const purchaseGensPer = args.grants.purchaseEnabled
    ? Math.min(rates.purchaseGensPer, Math.max(0, args.grants.purchaseCredits))
    : 0;

  return args.pages.map((p) => {
    const orders = Math.max(0, p.orders);
    const share = totalOrders > 0 ? orders / totalOrders : 1 / Math.max(1, args.pages.length);
    const engaged = engagedTotal * share;
    const retailUsd = retailAtMarginUsd(p.cogsUsd, args.marginTargetPct);
    const unitMarginUsd = Math.max(0, retailUsd - p.cogsUsd);
    const gFree = engaged * freePer;
    const gEmail = engaged * (rates.emailTakePct / 100) * emailGensPer;
    const gShare = engaged * (rates.shareTakePct / 100) * shareGensPer;
    const gPurchase = orders * (rates.purchaseRedeemPct / 100) * purchaseGensPer;
    const gens = gFree + gShare + gPurchase;
    const leads = engaged * (rates.emailTakePct / 100);
    const baseProfitUsd = orders * unitMarginUsd;
    const simUnitProfitUsd = orders * unitMarginUsd * Math.max(1, p.unitsPerOrder);
    return {
      ...p,
      share,
      engaged,
      retailUsd,
      unitMarginUsd,
      gens,
      gFree,
      gEmail,
      gShare,
      gPurchase,
      leads,
      baseProfitUsd,
      simUnitProfitUsd,
    };
  });
}

export type StoreProfitSummary = {
  totalOrders: number;
  gensDemand: number;
  leadsTotal: number;
  pagesNeeded: number;
  baseMonthlyProfitUsd: number;
  simMonthlyProfitUsd: number;
  upliftUsd: number;
  aovChanged: boolean;
  baseAovUsd: number;
  simAovUsd: number;
  blendedCrossSellPct: number;
  crossSellProfitUsd: number;
};

export function computeStoreProfit(
  pageMetrics: PageMetrics[],
  marginTargetPct: number,
): StoreProfitSummary {
  const totalOrders = pageMetrics.reduce((s, m) => s + Math.max(0, m.orders), 0);
  const gensDemand = Math.round(pageMetrics.reduce((s, m) => s + m.gens, 0));
  const leadsTotal = Math.round(pageMetrics.reduce((s, m) => s + m.leads, 0));
  const pagesNeeded = pageMetrics.length;
  const storeMarginFrac = Math.min(99, Math.max(1, marginTargetPct)) / 100;
  const blendedCrossSellPct =
    totalOrders > 0
      ? pageMetrics.reduce((s, m) => s + m.crossSellPct * m.orders, 0) / totalOrders
      : 0;
  const avgRetail =
    totalOrders > 0
      ? pageMetrics.reduce((s, m) => s + m.retailUsd * m.orders, 0) / totalOrders
      : 0;
  const crossSellProfitUsd =
    totalOrders * (blendedCrossSellPct / 100) * (avgRetail * storeMarginFrac);
  const baseMonthlyProfitUsd = pageMetrics.reduce((s, m) => s + m.baseProfitUsd, 0);
  const simUnitsProfit = pageMetrics.reduce((s, m) => s + m.simUnitProfitUsd, 0);
  const simMonthlyProfitUsd = simUnitsProfit + crossSellProfitUsd;
  const aovChanged =
    pageMetrics.some((p) => p.unitsPerOrder !== 1) || blendedCrossSellPct > 0;
  const baseAovUsd = avgRetail;
  const simAovUsd =
    totalOrders > 0
      ? (pageMetrics.reduce((s, m) => s + m.retailUsd * m.unitsPerOrder * m.orders, 0) +
          crossSellProfitUsd / Math.max(storeMarginFrac, 0.0001)) /
        totalOrders
      : 0;

  return {
    totalOrders,
    gensDemand,
    leadsTotal,
    pagesNeeded,
    baseMonthlyProfitUsd,
    simMonthlyProfitUsd,
    upliftUsd: simMonthlyProfitUsd - baseMonthlyProfitUsd,
    aovChanged,
    baseAovUsd,
    simAovUsd,
    blendedCrossSellPct,
    crossSellProfitUsd,
  };
}

export type PlanFitStatus = "ok" | "short" | "cap" | "pages";

export type PlanFitRow = {
  plan: PlanDefinition;
  status: PlanFitStatus;
  overageGens: number;
  overageCostUsd: number;
  monthlyCostUsd: number;
  fits: boolean;
};

export function planFitStatus(args: {
  plan: PlanDefinition;
  gensDemand: number;
  pagesNeeded: number;
  previewOverage: boolean;
  overagePriceUsd?: number;
}): PlanFitStatus {
  if (args.pagesNeeded > args.plan.pageLimit) return "pages";
  const est = planOverageEstimate({
    estimatedGens: args.gensDemand,
    generationQuota: args.plan.generationQuota,
    overageCap: args.plan.overageCap,
    includeOverage: args.previewOverage,
    overagePriceUsd: args.overagePriceUsd ?? OVERAGE_PRICE_USD,
  });
  if (!args.previewOverage && est.uncoveredGens > 0) return "short";
  if (args.previewOverage && est.uncoveredGens > 0) return "cap";
  return "ok";
}

export function evaluatePlans(args: {
  gensDemand: number;
  pagesNeeded: number;
  previewOverage: boolean;
  plans?: PlanDefinition[];
  overagePriceUsd?: number;
}): PlanFitRow[] {
  const plans = args.plans ?? PAID_PLAN_DEFINITIONS;
  const price = args.overagePriceUsd ?? OVERAGE_PRICE_USD;
  return plans.map((plan) => {
    const est = planOverageEstimate({
      estimatedGens: args.gensDemand,
      generationQuota: plan.generationQuota,
      overageCap: plan.overageCap,
      includeOverage: args.previewOverage,
      overagePriceUsd: price,
    });
    const status = planFitStatus({
      plan,
      gensDemand: args.gensDemand,
      pagesNeeded: args.pagesNeeded,
      previewOverage: args.previewOverage,
      overagePriceUsd: price,
    });
    const overageCostUsd = args.previewOverage ? est.overageCostUsd : 0;
    return {
      plan,
      status,
      overageGens: est.overageGens,
      overageCostUsd,
      monthlyCostUsd: Math.round((plan.priceUsd + overageCostUsd) * 100) / 100,
      fits: status === "ok",
    };
  });
}

/** Cheapest plan that fits under current overage preview rules. */
export function cheapestFittingPlan(args: {
  gensDemand: number;
  pagesNeeded: number;
  previewOverage: boolean;
  plans?: PlanDefinition[];
  overagePriceUsd?: number;
}): PlanDefinition | null {
  const rows = evaluatePlans(args).filter((r) => r.fits);
  if (rows.length === 0) return null;
  return rows.sort((a, b) => a.plan.priceUsd - b.plan.priceUsd)[0]!.plan;
}

export function headlineNetProfitUsd(args: {
  profit: StoreProfitSummary;
  planFeeUsd: number;
  overageCostUsd: number;
}): number {
  const gross = args.profit.aovChanged
    ? args.profit.simMonthlyProfitUsd
    : args.profit.baseMonthlyProfitUsd;
  return Math.round((gross - args.planFeeUsd - args.overageCostUsd) * 100) / 100;
}
