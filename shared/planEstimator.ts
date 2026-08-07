/**
 * Plan & generation estimator — sandbox math for operator plan design
 * and merchant Profit Insights suggestions.
 *
 * Primary plan-fit uses a multi-step customizer funnel (engagement → free gens →
 * Reward Ladder spend → purchase). Cost is computed on credits SPENT, never granted.
 */

import { STOREFRONT_FREE_GENERATION_DEFAULT } from "./storefront-credits";
import { extractDimensionalKey } from "./productVariantOptions";

/** Base platform cost per AI generation before vectorize pass (USD). Operator-only. */
export const DEFAULT_BASE_COST_PER_GEN_USD = 0.04;

/** Share of gens that get the +$0.01 vectorize pass. Operator-only. */
export const DEFAULT_VECTORIZE_SHARE = 0.5;

export const VECTORIZE_COST_PER_GEN_USD = 0.01;

/** @deprecated Prefer blendedCostPerGenUsd(); kept for older call sites. */
export const DEFAULT_PLATFORM_COST_PER_GEN_USD = 0.05;

/** Provisional guess: average gens burned toward a sale (advanced cross-check only). */
export const DEFAULT_GENS_PER_SALE = 4;

export const FREE_GENS_PER_VISITOR = STOREFRONT_FREE_GENERATION_DEFAULT;

/** Default unique customizer-page visitors / month. */
export const DEFAULT_MONTHLY_VISITORS = 100;

/** % of visitors who open the customizer at all (default 25%). */
export const DEFAULT_CUSTOMIZER_ENGAGEMENT_RATE = 0.25;

/** Of the free allotment, average gens actually used (default 1.5 of 2). */
export const DEFAULT_AVG_FREE_GENS_USED = 1.5;

/** % of engaged visitors who hit the limit and sign up (email rung). */
export const DEFAULT_EMAIL_RUNG_TAKE_RATE = 0.12;

/** Avg email-rung credits spent when take rate fires (clamped to grant). */
export const DEFAULT_AVG_EMAIL_GENS_USED = 2.2;

/** % of engaged visitors who complete a verified share. */
export const DEFAULT_SHARE_RUNG_TAKE_RATE = 0.03;

/** Avg share-rung credits spent when take rate fires (clamped to grant). */
export const DEFAULT_AVG_SHARE_GENS_USED = 3.0;

/**
 * % of engaged visitors who purchase (engaged convert better than raw traffic).
 * Replaces the old raw-visitor conversion default.
 */
export const DEFAULT_PURCHASE_CONVERSION_RATE = 0.05;

/** % of purchase-reward credits that are ever spent (breakage). */
export const DEFAULT_PURCHASE_REWARD_REDEEM_RATE = 0.4;

/** @deprecated Use DEFAULT_PURCHASE_CONVERSION_RATE (engaged-based). */
export const DEFAULT_CONVERSION_RATE = DEFAULT_PURCHASE_CONVERSION_RATE;

export type FunnelRewardGrants = {
  freeGensPerVisitor: number;
  emailCredits: number;
  shareCredits: number;
  purchaseCredits: number;
  emailEnabled: boolean;
  shareEnabled: boolean;
  purchaseEnabled: boolean;
};

/** Sandbox grants when Settings / Reward Ladder are not wired (operator PI). */
export const DEFAULT_FUNNEL_REWARD_GRANTS: FunnelRewardGrants = {
  freeGensPerVisitor: FREE_GENS_PER_VISITOR,
  emailCredits: 1,
  shareCredits: 1,
  purchaseCredits: 1,
  emailEnabled: true,
  shareEnabled: true,
  purchaseEnabled: true,
};

export function blendedCostPerGenUsd(
  baseCostPerGenUsd: number = DEFAULT_BASE_COST_PER_GEN_USD,
  vectorizeShare: number = DEFAULT_VECTORIZE_SHARE,
): number {
  const base = Number.isFinite(baseCostPerGenUsd) ? Math.max(0, baseCostPerGenUsd) : DEFAULT_BASE_COST_PER_GEN_USD;
  const share = Number.isFinite(vectorizeShare)
    ? Math.min(1, Math.max(0, vectorizeShare))
    : DEFAULT_VECTORIZE_SHARE;
  return Math.round((base + share * VECTORIZE_COST_PER_GEN_USD) * 1000) / 1000;
}

export type FunnelEstimateInput = {
  monthlyVisitors: number;
  engagementRate?: number;
  avgFreeGensUsed?: number;
  emailTakeRate?: number;
  avgEmailGensUsed?: number;
  shareTakeRate?: number;
  avgShareGensUsed?: number;
  purchaseConversionRate?: number;
  purchaseRedeemRate?: number;
  vectorizeShare?: number;
  baseCostPerGenUsd?: number;
  grants?: FunnelRewardGrants;
};

export type FunnelEstimate = {
  engaged: number;
  totalGensSpent: number;
  freeGensSpent: number;
  emailGensSpent: number;
  shareGensSpent: number;
  purchaseGensSpent: number;
  orders: number;
  leadsCaptured: number;
  blendedCostPerGen: number;
  aiCostUsd: number;
  costPerLeadUsd: number | null;
  grants: FunnelRewardGrants;
};

function clampRate(n: number | undefined, fallback: number): number {
  if (!Number.isFinite(n as number)) return fallback;
  return Math.min(1, Math.max(0, n as number));
}

function clampNonNeg(n: number | undefined, fallback: number): number {
  if (!Number.isFinite(n as number)) return fallback;
  return Math.max(0, n as number);
}

/**
 * Funnel plan-fit estimate. Counts credits SPENT only (granted-but-unused cost nothing).
 * Earned/ladder spend burns merchant quota — pack credits are out of scope here.
 */
export function estimateCustomizerFunnel(args: FunnelEstimateInput): FunnelEstimate {
  const grants = args.grants ?? DEFAULT_FUNNEL_REWARD_GRANTS;
  const visitors = clampNonNeg(args.monthlyVisitors, 0);
  const engagement = clampRate(args.engagementRate, DEFAULT_CUSTOMIZER_ENGAGEMENT_RATE);
  const engaged = visitors * engagement;

  const freeCap = Math.max(0, grants.freeGensPerVisitor);
  const avgFree = Math.min(
    clampNonNeg(args.avgFreeGensUsed, DEFAULT_AVG_FREE_GENS_USED),
    freeCap,
  );

  const emailCredits = grants.emailEnabled ? Math.max(0, grants.emailCredits) : 0;
  const shareCredits = grants.shareEnabled ? Math.max(0, grants.shareCredits) : 0;
  const purchaseCredits = grants.purchaseEnabled ? Math.max(0, grants.purchaseCredits) : 0;

  const emailTake = emailCredits > 0 ? clampRate(args.emailTakeRate, DEFAULT_EMAIL_RUNG_TAKE_RATE) : 0;
  const shareTake = shareCredits > 0 ? clampRate(args.shareTakeRate, DEFAULT_SHARE_RUNG_TAKE_RATE) : 0;
  const purchaseConv = clampRate(args.purchaseConversionRate, DEFAULT_PURCHASE_CONVERSION_RATE);
  const purchaseRedeem =
    purchaseCredits > 0
      ? clampRate(args.purchaseRedeemRate, DEFAULT_PURCHASE_REWARD_REDEEM_RATE)
      : 0;

  const avgEmail = Math.min(
    clampNonNeg(args.avgEmailGensUsed, Math.min(DEFAULT_AVG_EMAIL_GENS_USED, emailCredits || DEFAULT_AVG_EMAIL_GENS_USED)),
    emailCredits,
  );
  const avgShare = Math.min(
    clampNonNeg(args.avgShareGensUsed, Math.min(DEFAULT_AVG_SHARE_GENS_USED, shareCredits || DEFAULT_AVG_SHARE_GENS_USED)),
    shareCredits,
  );

  const freeGensSpent = engaged * avgFree;
  const emailGensSpent = engaged * emailTake * avgEmail;
  const shareGensSpent = engaged * shareTake * avgShare;
  const purchaseGensSpent = engaged * purchaseConv * purchaseCredits * purchaseRedeem;
  const totalGensSpentRaw = freeGensSpent + emailGensSpent + shareGensSpent + purchaseGensSpent;
  // Ceil for plan-quota sizing; AI cost uses the same integer so UI numbers match.
  const totalGensSpent = Math.ceil(totalGensSpentRaw);

  const blended = blendedCostPerGenUsd(args.baseCostPerGenUsd, args.vectorizeShare);
  const aiCostUsd = Math.round(totalGensSpent * blended * 100) / 100;
  const orders = Math.floor(engaged * purchaseConv);
  const leadsCaptured = Math.floor(engaged * emailTake);
  const costPerLeadUsd =
    leadsCaptured > 0 ? Math.round((aiCostUsd / leadsCaptured) * 100) / 100 : null;

  return {
    engaged: Math.round(engaged * 100) / 100,
    totalGensSpent,
    freeGensSpent: Math.round(freeGensSpent * 100) / 100,
    emailGensSpent: Math.round(emailGensSpent * 100) / 100,
    shareGensSpent: Math.round(shareGensSpent * 100) / 100,
    purchaseGensSpent: Math.round(purchaseGensSpent * 100) / 100,
    orders,
    leadsCaptured,
    blendedCostPerGen: blended,
    aiCostUsd,
    costPerLeadUsd,
    grants,
  };
}

export type EstimatorPlan = {
  planName: string;
  displayName: string;
  priceUsd: number;
  pageLimit: number;
  generationQuota: number;
};

/** Paid plans mirrored from server/customizer-plans.ts for client-side estimators. */
export const ESTIMATOR_PAID_PLANS: EstimatorPlan[] = [
  { planName: "starter", displayName: "Starter", priceUsd: 29, pageLimit: 1, generationQuota: 250 },
  { planName: "dabbler", displayName: "Dabbler", priceUsd: 49, pageLimit: 5, generationQuota: 600 },
  { planName: "pro", displayName: "Pro", priceUsd: 99, pageLimit: 15, generationQuota: 1500 },
  { planName: "pro_plus", displayName: "Pro Plus", priceUsd: 199, pageLimit: 30, generationQuota: 3000 },
];

export type MixLine = {
  id: string;
  label: string;
  monthlyUnits: number;
};

export function totalMonthlyUnits(lines: MixLine[]): number {
  return lines.reduce((sum, line) => {
    const n = Number(line.monthlyUnits);
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
}

/**
 * Reverse funnel: sales = floor(visitors × engagement × conversion)
 * → visitors = ceil(sales / (engagement × conversion)).
 * Returns null when rates are zero (cannot back-solve).
 */
export function backsolveVisitorsFromSales(args: {
  sales: number;
  engagementRate: number;
  conversionRate: number;
}): number | null {
  const sales = Math.max(0, Math.floor(Number(args.sales) || 0));
  const eng = clampRate(args.engagementRate, 0);
  const conv = clampRate(args.conversionRate, 0);
  if (sales === 0) return 0;
  if (eng <= 0 || conv <= 0) return null;
  return Math.ceil(sales / (eng * conv));
}

/**
 * Scale monthlyUnits across items so their sum equals targetTotal (integer).
 * Uses largest-remainder so the total is exact. If current total is 0, puts
 * all units on the first item.
 */
export function scaleUnitsToTotal<T extends { monthlyUnits: number }>(
  items: T[],
  targetTotal: number,
): T[] {
  if (items.length === 0) return items;
  const target = Math.max(0, Math.floor(Number(targetTotal) || 0));
  if (target === 0) {
    return items.map((item) => ({ ...item, monthlyUnits: 0 }));
  }

  const weights = items.map((item) => {
    const n = Number(item.monthlyUnits);
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
  const current = weights.reduce((sum, n) => sum + n, 0);

  if (current <= 0) {
    return items.map((item, idx) => ({
      ...item,
      monthlyUnits: idx === 0 ? target : 0,
    }));
  }

  const raw = weights.map((w) => (w / current) * target);
  const floors = raw.map((r) => Math.floor(r));
  let remainder = target - floors.reduce((sum, n) => sum + n, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  const result = floors.slice();
  for (let k = 0; k < remainder; k++) {
    result[order[k % order.length]!.i] += 1;
  }
  return items.map((item, i) => ({ ...item, monthlyUnits: result[i]! }));
}

/** Forward sales from traffic: floor(visitors × engagement × conversion). */
export function expectedSalesFromFunnel(args: {
  monthlyVisitors: number;
  engagementRate: number;
  conversionRate: number;
}): number {
  const visitors = clampNonNeg(args.monthlyVisitors, 0);
  const eng = clampRate(args.engagementRate, DEFAULT_CUSTOMIZER_ENGAGEMENT_RATE);
  const conv = clampRate(args.conversionRate, DEFAULT_PURCHASE_CONVERSION_RATE);
  return Math.floor(visitors * eng * conv);
}

export function pagesNeededFromMix(lines: MixLine[]): number {
  return lines.filter((line) => {
    const n = Number(line.monthlyUnits);
    return line.label.trim() && Number.isFinite(n) && n > 0;
  }).length;
}

export function estimateMonthlyGenerations(args: {
  totalUnits: number;
  gensPerSale?: number;
}): number {
  const gens = args.gensPerSale ?? DEFAULT_GENS_PER_SALE;
  const units = Number.isFinite(args.totalUnits) ? Math.max(0, args.totalUnits) : 0;
  const g = Number.isFinite(gens) && gens > 0 ? gens : DEFAULT_GENS_PER_SALE;
  return Math.ceil(units * g);
}

/**
 * @deprecated Full-allotment model. Prefer estimateCustomizerFunnel().
 * Kept for tests / older call sites: visitors × free gens.
 */
export function estimateVisitorFunnelGens(args: {
  monthlyVisitors: number;
  freeGensPerVisitor?: number;
}): number {
  const visitors = Number.isFinite(args.monthlyVisitors)
    ? Math.max(0, args.monthlyVisitors)
    : 0;
  const free =
    Number.isFinite(args.freeGensPerVisitor) && (args.freeGensPerVisitor as number) >= 0
      ? (args.freeGensPerVisitor as number)
      : FREE_GENS_PER_VISITOR;
  return Math.ceil(visitors * free);
}

/**
 * @deprecated Raw-visitor conversion. Prefer estimateCustomizerFunnel().orders
 * (engaged × purchase conversion).
 */
export function estimateSalesFromVisitors(args: {
  monthlyVisitors: number;
  conversionRate?: number;
}): number {
  const visitors = Number.isFinite(args.monthlyVisitors)
    ? Math.max(0, args.monthlyVisitors)
    : 0;
  const rate = Number.isFinite(args.conversionRate)
    ? Math.min(1, Math.max(0, args.conversionRate as number))
    : DEFAULT_CONVERSION_RATE;
  return Math.floor(visitors * rate);
}

export function platformAiCostUsd(
  estimatedGens: number,
  costPerGenUsd: number = DEFAULT_PLATFORM_COST_PER_GEN_USD,
): number {
  const gens = Number.isFinite(estimatedGens) ? Math.max(0, estimatedGens) : 0;
  const cost = Number.isFinite(costPerGenUsd) ? Math.max(0, costPerGenUsd) : 0;
  return Math.round(gens * cost * 100) / 100;
}

export type PlanRecommendation = {
  planName: string | null;
  displayName: string | null;
  priceUsd: number | null;
  pageLimit: number | null;
  generationQuota: number | null;
  fits: boolean;
  pagesNeeded: number;
  estimatedGens: number;
  reason: string;
  /** First plan that fails pages / gens for comparison tables */
  comparisons: Array<{
    planName: string;
    displayName: string;
    priceUsd: number;
    pageLimit: number;
    generationQuota: number;
    pagesOk: boolean;
    gensOk: boolean;
    fits: boolean;
    genShortfall: number;
  }>;
};

export function recommendPlan(args: {
  pagesNeeded: number;
  estimatedGens: number;
  plans?: EstimatorPlan[];
}): PlanRecommendation {
  const plans = args.plans ?? ESTIMATOR_PAID_PLANS;
  const pagesNeeded = Math.max(0, Math.floor(args.pagesNeeded));
  const estimatedGens = Math.max(0, Math.ceil(args.estimatedGens));

  const comparisons = plans.map((p) => {
    const pagesOk = p.pageLimit >= pagesNeeded;
    const gensOk = p.generationQuota >= estimatedGens;
    return {
      planName: p.planName,
      displayName: p.displayName,
      priceUsd: p.priceUsd,
      pageLimit: p.pageLimit,
      generationQuota: p.generationQuota,
      pagesOk,
      gensOk,
      fits: pagesOk && gensOk,
      genShortfall: Math.max(0, estimatedGens - p.generationQuota),
    };
  });

  const fit = comparisons.find((c) => c.fits);
  if (fit) {
    return {
      planName: fit.planName,
      displayName: fit.displayName,
      priceUsd: fit.priceUsd,
      pageLimit: fit.pageLimit,
      generationQuota: fit.generationQuota,
      fits: true,
      pagesNeeded,
      estimatedGens,
      reason: `${fit.displayName} covers ${pagesNeeded} page(s) and ~${estimatedGens} gens/mo.`,
      comparisons,
    };
  }

  const top = comparisons[comparisons.length - 1];
  return {
    planName: null,
    displayName: null,
    priceUsd: null,
    pageLimit: null,
    generationQuota: null,
    fits: false,
    pagesNeeded,
    estimatedGens,
    reason: top
      ? `Even ${top.displayName} is short (pages ${pagesNeeded}/${top.pageLimit}, gens ~${estimatedGens}/${top.generationQuota}). Raise plan limits or lower the mix / gens-per-sale guess.`
      : "No plans configured.",
    comparisons,
  };
}

export type PriceDriverVariant = {
  key: string;
  label: string;
  size: string;
  printAreaKey: string;
  cogsCents: number | null;
  shippingCents: number | null;
  supplierVariantId?: string;
};

type PiLikeRow = {
  supplierVariantId: string;
  variantName?: string | null;
  size?: string | null;
  color?: string | null;
  printAreaKey: string;
  baseCogsCents?: number | null;
  shippingFirstItemUsCents?: number | null;
};

function normalizePrintAreaKey(raw: string | null | undefined): string {
  const k = String(raw || "front").toLowerCase().trim() || "front";
  if (k === "both" || k === "front+back" || k === "front_back") return "both";
  return k;
}

const APPAREL_SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"] as const;

/** True when a token is a wearable size or a dimension label (not a colour name). */
export function looksLikeSizeToken(raw: string | null | undefined): boolean {
  const t = String(raw || "").trim();
  if (!t) return false;
  if (/^(xxs|xs|s|m|l|xl|2xl|3xl|4xl|5xl|xxl|xxx?l)$/i.test(t)) return true;
  if (/^(one\s*size|onesize|os)$/i.test(t)) return true;
  // Comforter / tapestry dims — same permissive parser as storefront import
  // (handles `104''_x_88"`, `68-x-88`, `88 × 88`, etc.).
  if (extractDimensionalKey(t)) return true;
  // Bare numeric sizes (e.g. phone case models are handled via labels elsewhere)
  if (/^\d+(\.\d+)?\s*("|″|in)?$/i.test(t)) return true;
  return false;
}

export function normalizeApparelSize(raw: string): string {
  const t = String(raw || "").trim();
  const dim = extractDimensionalKey(t);
  if (dim) return dim;
  if (/^(xxl)$/i.test(t)) return "2XL";
  if (/^(xxxl)$/i.test(t)) return "3XL";
  if (/^(xxs|xs|s|m|l|xl|2xl|3xl|4xl|5xl)$/i.test(t)) return t.toUpperCase();
  if (/^(one\s*size|onesize|os)$/i.test(t)) return "One size";
  return t;
}

/** Merchant-facing size names (S→Small, M→Med, L→Lge; 104x88 → 104" x 88"). */
export function formatSizeForDisplay(size: string): string {
  const n = normalizeApparelSize(size);
  const dim = extractDimensionalKey(n);
  if (dim) {
    const [w, h] = dim.split("x");
    return `${w}" x ${h}"`;
  }
  const map: Record<string, string> = {
    S: "Small",
    M: "Med",
    L: "Lge",
  };
  return map[n] || n;
}

export function formatPrintAreaForDisplay(key: string): string {
  const k = normalizePrintAreaKey(key);
  if (k === "both") return "Front/Back";
  if (k === "front") return "Front";
  return k;
}

export function sizeSortRank(size: string): number {
  const n = normalizeApparelSize(size);
  const idx = (APPAREL_SIZE_ORDER as readonly string[]).indexOf(n);
  if (idx >= 0) return idx;
  if (/^one\s*size$/i.test(n)) return 200;
  const dimKey = extractDimensionalKey(n);
  if (dimKey) {
    const [w, h] = dimKey.split("x").map(Number);
    return 1000 + w * 1000 + h;
  }
  const dim = n.match(/(\d+(?:\.\d+)?)/);
  if (dim) return 1000 + parseFloat(dim[1]!);
  return 5000;
}

export function comparePriceDriverVariants(a: PriceDriverVariant, b: PriceDriverVariant): number {
  const areaOrder = (key: string) => (key === "front" ? 0 : key === "both" ? 1 : 2);
  const areaCmp = areaOrder(a.printAreaKey) - areaOrder(b.printAreaKey);
  if (areaCmp !== 0) return areaCmp;
  const rankCmp = sizeSortRank(a.size) - sizeSortRank(b.size);
  if (rankCmp !== 0) return rankCmp;
  return a.size.localeCompare(b.size, undefined, { numeric: true });
}

/** Parse "M / Black" or colour-first "Storm Grey / L" into size + colour. */
export function parseSizeColorFromLabel(label: string): { size: string; color: string | null } {
  const t = String(label || "").trim();
  if (!t) return { size: "", color: null };
  if (t.includes(" / ")) {
    const parts = t.split(" / ").map((p) => p.trim()).filter(Boolean);
    const a = parts[0] || "";
    const b = parts.slice(1).join(" / ");
    if (looksLikeSizeToken(a)) return { size: normalizeApparelSize(a), color: b || null };
    if (looksLikeSizeToken(b)) return { size: normalizeApparelSize(b), color: a || null };
    return { size: "", color: t };
  }
  if (looksLikeSizeToken(t)) return { size: normalizeApparelSize(t), color: null };
  return { size: "", color: t };
}

function resolveRowSize(row: PiLikeRow): string {
  const fromSize = String(row.size || "").trim();
  if (looksLikeSizeToken(fromSize)) return normalizeApparelSize(fromSize);
  const fromColor = String(row.color || "").trim();
  if (looksLikeSizeToken(fromColor)) return normalizeApparelSize(fromColor);
  const fromName = parseSizeColorFromLabel(String(row.variantName || ""));
  if (fromName.size) return fromName.size;
  return "";
}

/**
 * Collapse PI rows to size + print-area price drivers.
 * Drops colour when COGS matches within the same size+area group.
 */
export function collapseToPriceDriverVariants(list: PiLikeRow[]): PriceDriverVariant[] {
  type Bucket = {
    size: string;
    printAreaKey: string;
    rows: PiLikeRow[];
  };
  const buckets = new Map<string, Bucket>();

  for (const row of list) {
    const size = resolveRowSize(row);
    // Skip colour-only / garbage "sizes" (e.g. Storm Grey as its own row).
    if (!size || !looksLikeSizeToken(size)) continue;
    const printAreaKey = normalizePrintAreaKey(row.printAreaKey);
    const bucketKey = `${size.toLowerCase()}::${printAreaKey}`;
    const b = buckets.get(bucketKey) ?? { size, printAreaKey, rows: [] };
    b.rows.push(row);
    buckets.set(bucketKey, b);
  }

  const out: PriceDriverVariant[] = [];
  for (const b of buckets.values()) {
    // Prefer a row with COGS; among those, pick max COGS (conservative).
    const withCogs = b.rows.filter((r) => r.baseCogsCents != null && Number.isFinite(r.baseCogsCents!));
    const pick =
      withCogs.sort((a, c) => (c.baseCogsCents ?? 0) - (a.baseCogsCents ?? 0))[0] || b.rows[0];
    if (!pick) continue;

    const area = formatPrintAreaForDisplay(b.printAreaKey);
    out.push({
      key: `${b.size}::${b.printAreaKey}`,
      label: `${formatSizeForDisplay(b.size)} — ${area}`,
      size: b.size,
      printAreaKey: b.printAreaKey,
      cogsCents: pick.baseCogsCents ?? null,
      shippingCents: pick.shippingFirstItemUsCents ?? null,
      supplierVariantId: String(pick.supplierVariantId),
    });
  }

  return out.sort(comparePriceDriverVariants);
}

/** Collapse blank titles like "M / Black" → size-only when colours share the same title prefix. */
export function collapseBlankTitlesToSizes(
  variants: Array<{ id: string; title: string }>,
): PriceDriverVariant[] {
  const bySize = new Map<string, { id: string; size: string }>();
  for (const v of variants) {
    const parsed = parseSizeColorFromLabel(String(v.title || "").trim());
    if (!parsed.size) continue;
    const key = parsed.size.toLowerCase();
    if (!bySize.has(key)) {
      bySize.set(key, { id: v.id, size: parsed.size });
    }
  }
  return [...bySize.values()]
    .map((v) => ({
      key: `${v.size}::front`,
      label: `${formatSizeForDisplay(v.size)} — ${formatPrintAreaForDisplay("front")}`,
      size: v.size,
      printAreaKey: "front",
      cogsCents: null as number | null,
      shippingCents: null as number | null,
      supplierVariantId: v.id,
    }))
    .sort(comparePriceDriverVariants);
}

/** Strip " — Printify Choice" / similar provider suffixes from product titles. */
export function stripProviderSuffix(name: string): string {
  return String(name || "")
    .replace(/\s*[—–-]\s*(Printify Choice|Monster Digital|Fulfill Engine|Printify|MWW On Demand)\s*$/i, "")
    .trim();
}

function labelForVariantId(
  labels: Record<string, string>,
  vid: string,
): string {
  return (
    labels[vid] ||
    labels[String(Number(vid))] ||
    ""
  );
}

/**
 * Build size × print-area drivers from a Printify costs API payload
 * (includes front + optional front+back).
 * When costs are missing but labels exist, still emits size rows (cogsCents null)
 * so the Insights dropdown is not empty after a failed cost probe.
 * When `supportsBothSides` is true but costsBoth is empty, still emits Front/Back
 * rows (null COGS) so Insights shows the tier and prompts a refresh.
 */
export function priceDriversFromCostsPayload(args: {
  costs?: Record<string, number> | null;
  costsBoth?: Record<string, number> | null;
  printifyVariantLabels?: Record<string, string> | null;
  supportsBothSides?: boolean | null;
}): PriceDriverVariant[] {
  const labels = args.printifyVariantLabels || {};
  const rows: PiLikeRow[] = [];

  for (const [vid, cents] of Object.entries(args.costs || {})) {
    if (!Number.isFinite(cents) || cents <= 0) continue;
    const label = labelForVariantId(labels, vid) || vid;
    const parsed = parseSizeColorFromLabel(label);
    if (!parsed.size) continue;
    rows.push({
      supplierVariantId: vid,
      size: parsed.size,
      color: parsed.color,
      printAreaKey: "front",
      baseCogsCents: cents,
    });
  }
  for (const [vid, cents] of Object.entries(args.costsBoth || {})) {
    if (!Number.isFinite(cents) || cents <= 0) continue;
    const label = labelForVariantId(labels, vid) || vid;
    const parsed = parseSizeColorFromLabel(label);
    if (!parsed.size) continue;
    rows.push({
      supplierVariantId: vid,
      size: parsed.size,
      color: parsed.color,
      printAreaKey: "both",
      baseCogsCents: cents,
    });
  }

  // Union label sizes even when some COGS rows already parsed — otherwise a
  // size with a quirky Printify token (or missing cost) disappears from Insights
  // while smaller sizes with clean labels still show (comforter 104" x 88").
  if (Object.keys(labels).length > 0) {
    const haveFrontSize = new Set(
      rows
        .filter((r) => normalizePrintAreaKey(r.printAreaKey) === "front")
        .map((r) => normalizeApparelSize(String(r.size || "")).toLowerCase())
        .filter(Boolean),
    );
    for (const [vid, label] of Object.entries(labels)) {
      const parsed = parseSizeColorFromLabel(label);
      if (!parsed.size) continue;
      const key = parsed.size.toLowerCase();
      if (haveFrontSize.has(key)) continue;
      haveFrontSize.add(key);
      rows.push({
        supplierVariantId: vid,
        size: parsed.size,
        color: parsed.color,
        printAreaKey: "front",
        baseCogsCents: null,
      });
    }
  }

  // Dual-sided catalogue products: mirror every front size as Front/Back when
  // costsBoth is still empty so the dropdown doesn't look front-only forever.
  if (args.supportsBothSides) {
    const haveBothSize = new Set(
      rows
        .filter((r) => normalizePrintAreaKey(r.printAreaKey) === "both")
        .map((r) => normalizeApparelSize(String(r.size || "")).toLowerCase())
        .filter(Boolean),
    );
    for (const r of [...rows]) {
      if (normalizePrintAreaKey(r.printAreaKey) !== "front") continue;
      const key = normalizeApparelSize(String(r.size || "")).toLowerCase();
      if (!key || haveBothSize.has(key)) continue;
      haveBothSize.add(key);
      rows.push({
        supplierVariantId: r.supplierVariantId,
        size: r.size,
        color: r.color,
        printAreaKey: "both",
        baseCogsCents: null,
      });
    }
  }

  return filterSpuriousOneSize(collapseToPriceDriverVariants(rows));
}

/** Drop synthetic "One size" buckets when real sizes exist for the product. */
export function filterSpuriousOneSize(variants: PriceDriverVariant[]): PriceDriverVariant[] {
  const real = variants.filter((v) => !/^one\s*size$/i.test(v.size));
  return real.length > 0 ? real : variants;
}

/** Prefer costs-derived drivers (front+both), else PI, else blanks; always filter One size noise. */
export function mergePriceDriverSources(args: {
  fromCosts?: PriceDriverVariant[];
  fromPi?: PriceDriverVariant[];
  fromBlanks?: PriceDriverVariant[];
}): PriceDriverVariant[] {
  const costs = args.fromCosts ?? [];
  if (costs.length > 0) return filterSpuriousOneSize(costs);
  const pi = filterSpuriousOneSize(args.fromPi ?? []);
  if (pi.length > 0) return pi;
  return filterSpuriousOneSize(args.fromBlanks ?? []);
}
