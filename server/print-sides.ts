/**
 * Server side of the Print sides option on customizer base products.
 *
 * Gate: PRINT_SIDES_OPTION_ENABLED=true AND the product type has front+back
 * costs (operator can switch a type off). Off → every builder, counter and
 * check behaves exactly as before (Size × Color only).
 */
import {
  PRINT_SIDES_BOTH,
  PRINT_SIDES_FRONT,
  PRINT_SIDES_OPTION_NAME,
  catalogHasPrintSides,
  printSidesEnabledForProductType,
  printSidesOfVariant,
  printSidesVariantFactor,
  sizeColorOptionValues,
} from "@shared/printSides";
import {
  bothRetailAboveFront,
  estimateBothRetailFromFront,
  resolveDesignerVariantPricesBoth,
  resolveBothRetailDollarsFromMap,
} from "@shared/variantPricesBoth";

export function printSidesOptionLive(): boolean {
  return process.env.PRINT_SIDES_OPTION_ENABLED === "true";
}

/** Will a (re)created base product for this type carry Print sides? */
export function printSidesActiveForProductType(pt: any): boolean {
  if (!pt || !printSidesOptionLive()) return false;
  return printSidesEnabledForProductType({
    printSidesEnabled: pt.printSidesEnabled ?? null,
    printifyCosts: pt.printifyCosts,
    variantPricesBoth: pt.variantPricesBoth,
    isAllOverPrint: pt.isAllOverPrint,
  });
}

export function printSidesFactorForProductType(pt: any): 1 | 2 {
  return printSidesVariantFactor(printSidesActiveForProductType(pt));
}

type RestVariant = {
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
  price: string;
  sku?: string;
  [k: string]: unknown;
};
type RestOption = { name: string; values: string[] };

/**
 * Both-tier retail for one blank: saved map → synthesized from both-side costs
 * → estimate above front. Always strictly above the Front price.
 */
export function bothTierRetailForBlank(
  pt: any,
  args: { sizeName?: string; colorName?: string; printifyVariantId?: string | number | null; frontPrice: string },
): string {
  const front = parseFloat(args.frontPrice) || 0;
  const map = resolveDesignerVariantPricesBoth(pt.variantPricesBoth, pt.printifyCosts, pt.defaultMarkupPercent, {
    variantMap: pt.variantMap,
    shopifyVariantIds: pt.shopifyVariantIds,
    sizes: pt.sizes,
    frameColors: pt.frameColors,
  });
  const raw = resolveBothRetailDollarsFromMap(map, {
    sizeName: args.sizeName,
    colorName: args.colorName,
    printifyVariantId: args.printifyVariantId != null ? String(args.printifyVariantId) : null,
  });
  const both = (raw != null ? bothRetailAboveFront(raw, front) : null) ?? estimateBothRetailFromFront(front);
  return both != null && both > 0 ? both.toFixed(2) : "0.00";
}

type LiveVariant = {
  id: number | string;
  title?: string | null;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
  price?: string | number | null;
};

function parseList(raw: unknown): Array<{ id: string; name: string }> {
  if (Array.isArray(raw)) return raw as any;
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw || "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseObj(raw: unknown): Record<string, any> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, any>;
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw || "{}");
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Prices for every live Front + Back variant: the both-tier retail for its
 * blank, kept above that blank's (possibly just-updated) Front price.
 * Returns only ids whose price changes. Empty for products without Print sides.
 */
export function bothTierPriceUpdates(args: {
  productType: any;
  liveVariants: LiveVariant[];
  /** Front prices about to be written (variant id → "29.95"). */
  pendingFrontPrices?: Map<number, string>;
  /** Explicit both-tier map from the request; else the saved product type map. */
  variantPricesBoth?: Record<string, string> | null;
}): Map<number, string> {
  const out = new Map<number, string>();
  const live = args.liveVariants ?? [];
  if (!catalogHasPrintSides(live)) return out;

  const pt = args.variantPricesBoth && Object.keys(args.variantPricesBoth).length > 0
    ? { ...args.productType, variantPricesBoth: args.variantPricesBoth }
    : args.productType;
  const sizes = parseList(pt?.sizes);
  const colors = parseList(pt?.frameColors);
  const variantMap = parseObj(pt?.variantMap);

  const blankKey = (v: LiveVariant) => sizeColorOptionValues(v).join("|").toLowerCase();
  const frontPriceByBlank = new Map<string, string>();
  for (const v of live) {
    if (printSidesOfVariant(v) !== "front") continue;
    const id = Number(v.id);
    const p = args.pendingFrontPrices?.get(id) ?? (v.price != null ? String(v.price) : "");
    if (parseFloat(p) > 0) frontPriceByBlank.set(blankKey(v), p);
  }

  for (const v of live) {
    if (printSidesOfVariant(v) !== "both") continue;
    const id = Number(v.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    const frontPrice = frontPriceByBlank.get(blankKey(v));
    if (!frontPrice) continue; // never price Front + Back without its Front twin
    const [sizeName, colorName] = sizeColorOptionValues(v);
    const size = sizes.find((s) => s.name === sizeName);
    const color = colorName ? colors.find((c) => c.name === colorName) : undefined;
    const entry = size ? variantMap[`${size.id}:${color ? color.id : "default"}`] : undefined;
    const price = bothTierRetailForBlank(pt, {
      sizeName,
      colorName,
      printifyVariantId: entry?.printifyVariantId ?? null,
      frontPrice,
    });
    if (!(parseFloat(price) > 0)) continue;
    const current = parseFloat(String(v.price ?? "0")) || 0;
    if (Math.abs(current - parseFloat(price)) < 0.005) continue;
    out.set(id, price);
  }
  return out;
}

/**
 * Add the Print sides option (Front / Front + Back) to a REST-shaped product
 * body in place: one Front + Back twin per variant, value at the next option
 * position. No-op when inactive. Returns the final variant count.
 */
export function applyPrintSidesToRestProduct(
  pt: any,
  variants: RestVariant[],
  options: RestOption[],
  lookup?: (v: RestVariant) => { printifyVariantId?: string | number | null },
): number {
  if (!printSidesActiveForProductType(pt) || variants.length === 0) return variants.length;
  if (options.some((o) => o.name === PRINT_SIDES_OPTION_NAME)) return variants.length;
  const slot = options.length; // 0-based → option{slot+1}
  if (slot > 2) return variants.length; // Shopify allows 3 options
  const key = (`option${slot + 1}`) as "option1" | "option2" | "option3";
  const twins: RestVariant[] = [];
  for (const v of variants) {
    v[key] = PRINT_SIDES_FRONT;
    twins.push({
      ...v,
      [key]: PRINT_SIDES_BOTH,
      price: bothTierRetailForBlank(pt, {
        sizeName: v.option1 ?? undefined,
        colorName: slot >= 2 ? (v.option2 ?? undefined) : undefined,
        printifyVariantId: lookup?.(v)?.printifyVariantId ?? null,
        frontPrice: v.price,
      }),
      ...(v.sku ? { sku: `${v.sku}-FB` } : {}),
    });
  }
  variants.push(...twins);
  options.push({ name: PRINT_SIDES_OPTION_NAME, values: [PRINT_SIDES_FRONT, PRINT_SIDES_BOTH] });
  return variants.length;
}
