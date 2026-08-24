/**
 * Phase 4 Slice A — DB-backed size-aware coverage lookup.
 * Pure matching lives in shared/shipping-size-coverage.ts.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { shippingRates, variantShipping } from "@shared/schema";
import {
  evaluateSizeCountryCoverage,
  listSizeCoverageFromMatrix,
  pickRateForCountry,
  type ShipsToSize,
  type SizeColorMapping,
  type SizeCoverageRate,
  type SizeCoverageVerdict,
} from "@shared/shipping-size-coverage";

const LOG = "[shipping-coverage]";

export type LookupSizeCountryCoverageParams = {
  productTypeId: number;
  size: string | null | undefined;
  color?: string | null;
  country: string;
};

function logFailClosed(verdict: SizeCoverageVerdict, extra: Record<string, unknown>): void {
  console.error(LOG, "FAIL CLOSED", {
    reason: verdict.reason,
    country: verdict.country,
    productTypeId: extra.productTypeId,
    size: extra.size,
    color: extra.color,
    sizeId: verdict.sizeId,
    colorId: verdict.colorId,
    variantGroup: verdict.variantGroup,
    matchedZone: verdict.matchedZone,
    mappingCount: extra.mappingCount,
    rateCount: extra.rateCount,
  });
}

async function loadProductShippingMatrix(productTypeId: number): Promise<{
  mappings: SizeColorMapping[];
  rates: SizeCoverageRate[];
}> {
  const mappingRows = await db
    .select({
      sizeColorKey: variantShipping.sizeColorKey,
      variantGroup: variantShipping.variantGroup,
      shippingClassId: variantShipping.shippingClassId,
    })
    .from(variantShipping)
    .where(eq(variantShipping.productTypeId, productTypeId));

  const mappings: SizeColorMapping[] = mappingRows.map((r) => ({
    sizeColorKey: r.sizeColorKey,
    variantGroup: r.variantGroup,
  }));

  if (mappings.length === 0) return { mappings, rates: [] };

  const classId = mappingRows[0].shippingClassId;
  const rateRows = await db
    .select({
      countryCode: shippingRates.countryCode,
      variantGroup: shippingRates.variantGroup,
      firstItemCents: shippingRates.firstItemCents,
      additionalCents: shippingRates.additionalCents,
      shippable: shippingRates.shippable,
      tier: shippingRates.tier,
    })
    .from(shippingRates)
    .where(eq(shippingRates.shippingClassId, classId));

  const rates: SizeCoverageRate[] = rateRows.map((r) => ({
    countryCode: r.countryCode,
    variantGroup: r.variantGroup,
    firstItemCents: r.firstItemCents,
    additionalCents: r.additionalCents,
    shippable: r.shippable,
    tier: r.tier,
  }));
  return { mappings, rates };
}

/** Per-size cells for the creator dropdown / downsell / warned badge. */
export async function listSizeCoverageForProduct(
  productTypeId: number,
  countryRaw: string,
): Promise<ShipsToSize[]> {
  const country = String(countryRaw || "").trim().toUpperCase() || "US";
  if (!Number.isFinite(productTypeId) || productTypeId <= 0) return [];
  const { mappings, rates } = await loadProductShippingMatrix(productTypeId);
  return listSizeCoverageFromMatrix({ mappings, rates, country });
}

export async function lookupSizeCountryCoverage(
  params: LookupSizeCountryCoverageParams,
): Promise<SizeCoverageVerdict> {
  const productTypeId = Number(params.productTypeId);
  const country = String(params.country || "").trim().toUpperCase();
  const size = params.size;
  const color = params.color ?? null;

  if (!Number.isFinite(productTypeId) || productTypeId <= 0) {
    const verdict = evaluateSizeCountryCoverage({
      mappings: [],
      rates: [],
      size,
      color,
      country: country || "US",
    });
    logFailClosed(verdict, { productTypeId, size, color, mappingCount: 0, rateCount: 0 });
    return verdict;
  }

  const { mappings, rates } = await loadProductShippingMatrix(productTypeId);

  if (mappings.length === 0) {
    const verdict = evaluateSizeCountryCoverage({
      mappings: [],
      rates: [],
      size,
      color,
      country: country || "US",
    });
    logFailClosed(verdict, { productTypeId, size, color, mappingCount: 0, rateCount: 0 });
    return verdict;
  }

  const verdict = evaluateSizeCountryCoverage({
    mappings,
    rates,
    size,
    color,
    country: country || "US",
  });

  if (!verdict.allowed) {
    logFailClosed(verdict, {
      productTypeId,
      size,
      color,
      mappingCount: mappings.length,
      rateCount: rates.length,
    });
  }
  return verdict;
}

/**
 * Listing filter: keep products with no matrix (generate still fail-closes)
 * and products with at least one shippable size. Hide only when every mapped
 * size is excluded for this country.
 */
export async function productTypeIdsHiddenForCountry(
  countryRaw: string,
  productTypeIds: number[],
): Promise<Set<number>> {
  const country = String(countryRaw || "").trim().toUpperCase();
  const ids = productTypeIds.filter((n) => Number.isFinite(n) && n > 0);
  const hidden = new Set<number>();
  if (!country || ids.length === 0) return hidden;

  const mappingRows = await db
    .select({
      productTypeId: variantShipping.productTypeId,
      variantGroup: variantShipping.variantGroup,
      shippingClassId: variantShipping.shippingClassId,
    })
    .from(variantShipping)
    .where(inArray(variantShipping.productTypeId, ids));

  if (mappingRows.length === 0) return hidden;

  const classIds = [...new Set(mappingRows.map((r) => r.shippingClassId))];
  const rateRows = await db
    .select({
      shippingClassId: shippingRates.shippingClassId,
      countryCode: shippingRates.countryCode,
      variantGroup: shippingRates.variantGroup,
      firstItemCents: shippingRates.firstItemCents,
      additionalCents: shippingRates.additionalCents,
      shippable: shippingRates.shippable,
      tier: shippingRates.tier,
    })
    .from(shippingRates)
    .where(inArray(shippingRates.shippingClassId, classIds));

  const ratesByClass = new Map<number, SizeCoverageRate[]>();
  for (const r of rateRows) {
    const list = ratesByClass.get(r.shippingClassId) || [];
    list.push({
      countryCode: r.countryCode,
      variantGroup: r.variantGroup,
      firstItemCents: r.firstItemCents,
      additionalCents: r.additionalCents,
      shippable: r.shippable,
      tier: r.tier,
    });
    ratesByClass.set(r.shippingClassId, list);
  }

  const groupsByProduct = new Map<number, { classId: number; groups: Set<string> }>();
  for (const m of mappingRows) {
    const slot = groupsByProduct.get(m.productTypeId) || {
      classId: m.shippingClassId,
      groups: new Set<string>(),
    };
    slot.groups.add(m.variantGroup);
    groupsByProduct.set(m.productTypeId, slot);
  }

  for (const [productTypeId, slot] of groupsByProduct) {
    const rates = ratesByClass.get(slot.classId) || [];
    let anyShippable = false;
    for (const group of slot.groups) {
      const rate = pickRateForCountry(rates, country, group);
      if (rate && rate.shippable && rate.tier !== "excluded") {
        anyShippable = true;
        break;
      }
    }
    if (!anyShippable) hidden.add(productTypeId);
  }
  return hidden;
}
