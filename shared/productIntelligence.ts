/**
 * Product Intelligence — shared pricing / margin / health primitives.
 * Single source for markup + .95 rounding used by Resync, Product Sync, and future calculators.
 */

export const DEFAULT_MARKUP_PERCENT = 60;

export type PricingStrategy = "maintain_margin" | "maintain_price" | "notify_only";
export type ProductHealth = "healthy" | "needs_review" | "attention_required";
export type VariantAvailabilityStatus = "in_stock" | "out_of_stock" | "removed" | "unknown";

/** Round dollar amount up to the next .95 (e.g. 12.01 → 12.95, 12.95 → 12.95). */
export function roundUpTo95(rawDollars: number): number {
  if (!Number.isFinite(rawDollars) || rawDollars <= 0) return 0;
  return Math.ceil(rawDollars) - 0.05;
}

/**
 * Suggested retail in cents from COGS cents + markup %.
 * Returns null when COGS missing/non-positive or result would be ≤ $0 (zero-price guardrail).
 */
export function suggestedRetailCents(
  cogsCents: number | null | undefined,
  markupPercent: number = DEFAULT_MARKUP_PERCENT,
): number | null {
  if (cogsCents == null || !Number.isFinite(cogsCents) || cogsCents <= 0) return null;
  const pct = Number.isFinite(markupPercent) ? markupPercent : DEFAULT_MARKUP_PERCENT;
  const rawDollars = (cogsCents / 100) * (1 + pct / 100);
  const rounded = roundUpTo95(rawDollars);
  if (!Number.isFinite(rounded) || rounded <= 0) return null;
  return Math.round(rounded * 100);
}

export function suggestedRetailDollarsString(
  cogsCents: number | null | undefined,
  markupPercent: number = DEFAULT_MARKUP_PERCENT,
): string | null {
  const cents = suggestedRetailCents(cogsCents, markupPercent);
  if (cents == null) return null;
  return (cents / 100).toFixed(2);
}

/** True when a retail string would sync as free / invalid. */
export function isNonPositiveRetailPrice(value: string | number | null | undefined): boolean {
  if (value == null) return true;
  if (typeof value === "number") return !Number.isFinite(value) || value <= 0;
  const trimmed = String(value).trim();
  if (!trimmed) return true;
  const num = parseFloat(trimmed);
  return !Number.isFinite(num) || num <= 0;
}

export function merchantProfitCents(
  retailCents: number | null | undefined,
  cogsCents: number | null | undefined,
): number | null {
  if (
    retailCents == null ||
    cogsCents == null ||
    !Number.isFinite(retailCents) ||
    !Number.isFinite(cogsCents) ||
    retailCents <= 0
  ) {
    return null;
  }
  return Math.round(retailCents - cogsCents);
}

export function merchantMarginPercent(
  retailCents: number | null | undefined,
  cogsCents: number | null | undefined,
): number | null {
  if (
    retailCents == null ||
    cogsCents == null ||
    !Number.isFinite(retailCents) ||
    !Number.isFinite(cogsCents) ||
    retailCents <= 0
  ) {
    return null;
  }
  return ((retailCents - cogsCents) / retailCents) * 100;
}

/** Effective strategy: notify_only until markup is known (safe default). */
export function resolveEffectivePricingStrategy(
  strategy: string | null | undefined,
  defaultMarkupPercent: number | null | undefined,
): PricingStrategy {
  const s = String(strategy || "notify_only");
  if (s === "maintain_margin" || s === "maintain_price" || s === "notify_only") {
    if (s === "maintain_margin" && (defaultMarkupPercent == null || !Number.isFinite(defaultMarkupPercent))) {
      return "notify_only";
    }
    return s;
  }
  return "notify_only";
}

export type HealthSignals = {
  syncFailed?: boolean;
  fullyOos?: boolean;
  priceChanged?: boolean;
  availabilityChanged?: boolean;
  newOrRemovedVariants?: boolean;
  marginBelowThreshold?: boolean;
  retailAutoUpdateFailed?: boolean;
  partialOos?: boolean;
};

export function computeProductHealth(signals: HealthSignals): ProductHealth {
  if (
    signals.syncFailed ||
    signals.fullyOos ||
    signals.marginBelowThreshold ||
    signals.retailAutoUpdateFailed
  ) {
    return "attention_required";
  }
  if (
    signals.priceChanged ||
    signals.availabilityChanged ||
    signals.newOrRemovedVariants ||
    signals.partialOos
  ) {
    return "needs_review";
  }
  return "healthy";
}

export function costChecksum(args: {
  cogsCents: number | null | undefined;
  shippingUsCents: number | null | undefined;
  available: boolean;
}): string {
  return `${args.cogsCents ?? "x"}|${args.shippingUsCents ?? "x"}|${args.available ? 1 : 0}`;
}

export type VariantAvailabilityMap = Record<string, VariantAvailabilityStatus>;

export function parseVariantAvailabilityMap(raw: string | null | undefined): VariantAvailabilityMap {
  try {
    const parsed = JSON.parse(raw || "{}") as Record<string, unknown>;
    const out: VariantAvailabilityMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (
        v === "in_stock" ||
        v === "out_of_stock" ||
        v === "removed" ||
        v === "unknown"
      ) {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Keys that are out of stock or removed (storefront should disable). */
export function unavailableVariantKeys(map: VariantAvailabilityMap): string[] {
  return Object.entries(map)
    .filter(([, status]) => status === "out_of_stock" || status === "removed")
    .map(([k]) => k);
}

export function isVariantKeyAvailable(
  map: VariantAvailabilityMap,
  sizeId: string,
  colorId: string,
): boolean {
  const key = `${sizeId}:${colorId}`;
  const status = map[key];
  if (!status) return true; // unknown → allow (pre-sync)
  return status === "in_stock";
}

/** Units needed to cover a monthly subscription fee from per-sale profit. */
export function subscriptionBreakEvenUnits(
  monthlyPlanUsd: number,
  profitPerSaleCents: number | null | undefined,
): number | null {
  if (!Number.isFinite(monthlyPlanUsd) || monthlyPlanUsd <= 0) return 0;
  if (profitPerSaleCents == null || !Number.isFinite(profitPerSaleCents) || profitPerSaleCents <= 0) {
    return null;
  }
  return Math.ceil((monthlyPlanUsd * 100) / profitPerSaleCents);
}

export function monthlyNetProfitCents(args: {
  profitPerSaleCents: number | null | undefined;
  monthlySales: number;
  subscriptionUsd: number;
}): number | null {
  if (args.profitPerSaleCents == null || !Number.isFinite(args.profitPerSaleCents)) return null;
  const sales = Number.isFinite(args.monthlySales) ? Math.max(0, args.monthlySales) : 0;
  const subCents = Math.round((Number(args.subscriptionUsd) || 0) * 100);
  return Math.round(args.profitPerSaleCents * sales - subCents);
}
