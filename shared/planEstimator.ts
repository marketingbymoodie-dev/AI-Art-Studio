/**
 * Plan & generation estimator — sandbox math for operator plan design
 * and merchant Profit Insights suggestions.
 *
 * Gens-per-sale is a provisional guess until live analytics exist.
 */

import { STOREFRONT_FREE_GENERATION_LIMIT } from "./storefront-credits";

/** Working average platform cost per AI generation (USD). */
export const DEFAULT_PLATFORM_COST_PER_GEN_USD = 0.05;

/** Provisional guess: average gens burned toward a sale (of the visitor free allotment). */
export const DEFAULT_GENS_PER_SALE = 4;

export const FREE_GENS_PER_VISITOR = STOREFRONT_FREE_GENERATION_LIMIT;

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

function printAreaLabel(key: string): string {
  if (key === "both") return "front+back";
  if (key === "front") return "front";
  return key;
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
    const size = String(row.size || "").trim() || "One size";
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

    // If colours disagree on COGS, still one row (max) — label stays size+area only.
    const area = printAreaLabel(b.printAreaKey);
    out.push({
      key: `${b.size}::${b.printAreaKey}`,
      label: `${b.size} — ${area}`,
      size: b.size,
      printAreaKey: b.printAreaKey,
      cogsCents: pick.baseCogsCents ?? null,
      shippingCents: pick.shippingFirstItemUsCents ?? null,
      supplierVariantId: String(pick.supplierVariantId),
    });
  }

  const areaOrder = (key: string) => (key === "front" ? 0 : key === "both" ? 1 : 2);
  return out.sort((a, b) => {
    const areaCmp = areaOrder(a.printAreaKey) - areaOrder(b.printAreaKey);
    if (areaCmp !== 0) return areaCmp;
    return a.size.localeCompare(b.size, undefined, { numeric: true });
  });
}

/** Collapse blank titles like "M / Black" → size-only when colours share the same title prefix. */
export function collapseBlankTitlesToSizes(
  variants: Array<{ id: string; title: string }>,
): PriceDriverVariant[] {
  const bySize = new Map<string, { id: string; title: string }>();
  for (const v of variants) {
    const title = String(v.title || "").trim();
    const sizePart = title.includes(" / ") ? title.split(" / ")[0]!.trim() : title;
    const size = sizePart || title || v.id;
    if (!bySize.has(size.toLowerCase())) {
      bySize.set(size.toLowerCase(), v);
    }
  }
  return [...bySize.entries()]
    .map(([, v]) => {
      const title = String(v.title || "").trim();
      const size = title.includes(" / ") ? title.split(" / ")[0]!.trim() : title;
      return {
        key: v.id,
        label: `${size || title} — front`,
        size: size || title,
        printAreaKey: "front",
        cogsCents: null as number | null,
        shippingCents: null as number | null,
      };
    })
    .sort((a, b) => a.size.localeCompare(b.size, undefined, { numeric: true }));
}
