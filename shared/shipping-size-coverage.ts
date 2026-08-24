/**
 * Phase 4 Slice A — size-aware coverage lookup (pure).
 *
 * ONE size-label → variantGroup normalizer, shared by generate, dropdown,
 * and downsell. Acts on the Phase 1/3 rate matrix; no new pricing.
 *
 * Fail closed: missing matrix, size with no mapping, size present but colour
 * not in the map, or no country/ROW rate row.
 */
import { extractDimensionalKey } from "./productVariantOptions";
import { normalizeApparelSizeId } from "./variantMapResolve";

export type SizeColorMapping = {
  sizeColorKey: string;
  variantGroup: string;
};

export type SizeCoverageRate = {
  countryCode: string;
  variantGroup: string;
  firstItemCents: number;
  additionalCents?: number | null;
  shippable: boolean;
  tier: string;
};

export type SizeCoverageFailReason =
  | "no_matrix"
  | "size_unmapped"
  | "color_unmapped"
  | "ambiguous_group"
  | "no_rate"
  | "excluded";

export type ShipsToSize = {
  sizeId: string;
  variantGroup: string;
  tier: string;
  firstItemCents: number | null;
  shippable: boolean;
  matchedZone?: string | null;
};

export type SizeCoverageVerdict = {
  allowed: boolean;
  country: string;
  sizeId: string;
  colorId: string | null;
  variantGroup: string | null;
  matchedZone: string | null;
  tier: string | null;
  firstItemCents: number | null;
  additionalCents: number | null;
  reason: SizeCoverageFailReason | null;
  shipsToSizes: ShipsToSize[];
  suggestedSizeId: string | null;
};

export type ResolveVariantGroupResult =
  | { ok: true; variantGroup: string; sizeId: string; colorId: string | null }
  | {
      ok: false;
      reason: Extract<
        SizeCoverageFailReason,
        "no_matrix" | "size_unmapped" | "color_unmapped" | "ambiguous_group"
      >;
      sizeId: string;
      colorId: string | null;
      sizePresent: boolean;
    };

function splitSizeColorKey(key: string): { size: string; color: string } {
  const raw = String(key || "").trim();
  const idx = raw.indexOf(":");
  if (idx < 0) return { size: raw, color: "default" };
  return { size: raw.slice(0, idx), color: raw.slice(idx + 1) || "default" };
}

function canonicalColorToken(raw: string | null | undefined): string {
  return String(raw || "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "") || "default";
}

/** Dimensional sizes collapse to `11x8`; apparel uses the apparel slug (`xl`). */
export function canonicalSizeToken(raw: string | null | undefined): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  const dim = extractDimensionalKey(s);
  if (dim) return dim;
  return normalizeApparelSizeId(s);
}

export function sizeTokensMatch(a: string, b: string): boolean {
  const ca = canonicalSizeToken(a);
  const cb = canonicalSizeToken(b);
  return !!ca && !!cb && ca === cb;
}

function colorTokensMatch(a: string, b: string): boolean {
  return canonicalColorToken(a) === canonicalColorToken(b);
}

function requestedColor(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  return s ? s : null;
}

/**
 * Size label (+ optional colour) → variantGroup.
 * Colour omitted: all rows for that size must share one group.
 * Size present, colour not in map → color_unmapped (fail closed).
 */
export function resolveVariantGroupForSelection(params: {
  mappings: SizeColorMapping[];
  size: string | null | undefined;
  color?: string | null;
}): ResolveVariantGroupResult {
  const sizeRaw = String(params.size || "").trim();
  const colorRaw = requestedColor(params.color);
  const sizeId = sizeRaw ? (splitSizeColorKey(sizeRaw).size || sizeRaw) : "";
  const colorId = colorRaw;

  if (!params.mappings.length) {
    return { ok: false, reason: "no_matrix", sizeId: sizeId || String(params.size || ""), colorId, sizePresent: false };
  }
  if (!sizeId) {
    return { ok: false, reason: "size_unmapped", sizeId: "", colorId, sizePresent: false };
  }

  const sizeHits = params.mappings.filter((m) => sizeTokensMatch(splitSizeColorKey(m.sizeColorKey).size, sizeId));
  if (sizeHits.length === 0) {
    return { ok: false, reason: "size_unmapped", sizeId, colorId, sizePresent: false };
  }

  const catalogSizeId = splitSizeColorKey(sizeHits[0].sizeColorKey).size;

  if (colorRaw) {
    const colorHits = sizeHits.filter((m) =>
      colorTokensMatch(splitSizeColorKey(m.sizeColorKey).color, colorRaw),
    );
    if (colorHits.length === 0) {
      return { ok: false, reason: "color_unmapped", sizeId: catalogSizeId, colorId, sizePresent: true };
    }
    const groups = new Set(colorHits.map((m) => m.variantGroup));
    if (groups.size !== 1) {
      return { ok: false, reason: "ambiguous_group", sizeId: catalogSizeId, colorId, sizePresent: true };
    }
    return { ok: true, variantGroup: colorHits[0].variantGroup, sizeId: catalogSizeId, colorId };
  }

  const groups = new Set(sizeHits.map((m) => m.variantGroup));
  if (groups.size !== 1) {
    return { ok: false, reason: "ambiguous_group", sizeId: catalogSizeId, colorId: null, sizePresent: true };
  }
  return { ok: true, variantGroup: sizeHits[0].variantGroup, sizeId: catalogSizeId, colorId: null };
}

/** Per-size cells for the dropdown / downsell / warned badge. */
export function listSizeCoverageFromMatrix(params: {
  mappings: SizeColorMapping[];
  rates: SizeCoverageRate[];
  country: string;
}): ShipsToSize[] {
  return uniqueShipsToSizes(params);
}

export function findSizeCoverageRow(
  sizeIdOrName: string,
  rows: ShipsToSize[],
): ShipsToSize | undefined {
  return rows.find((r) => sizeTokensMatch(r.sizeId, sizeIdOrName));
}

/** Dropdown: omit excluded sizes. Empty matrix → show all (generate still fail-closes). */
export function filterCatalogSizesForCountry<T extends { id: string; name?: string }>(
  sizes: T[],
  rows: ShipsToSize[] | null | undefined,
): T[] {
  if (!rows || rows.length === 0) return sizes;
  return sizes.filter((s) => {
    const row =
      findSizeCoverageRow(s.id, rows) ||
      (s.name ? findSizeCoverageRow(s.name, rows) : undefined);
    if (!row) return true;
    return row.shippable;
  });
}

/** Deep-link / country-change: excluded size → shippable alternatives (same shape as the 409). */
export function buildSizeDownsell(params: {
  requestedSizeId: string;
  country: string;
  rows: ShipsToSize[];
}): {
  requestedSizeId: string;
  country: string;
  shipsToSizes: ShipsToSize[];
  suggestedSizeId: string | null;
} | null {
  if (!params.rows.length) return null;
  const row = findSizeCoverageRow(params.requestedSizeId, params.rows);
  if (row?.shippable) return null;
  const shipsToSizes = params.rows.filter((s) => s.shippable);
  return {
    requestedSizeId: row?.sizeId || params.requestedSizeId,
    country: params.country,
    shipsToSizes,
    suggestedSizeId: suggestSize(shipsToSizes),
  };
}

export function formatUsdCents(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "";
  return `$${(cents / 100).toFixed(2)}`;
}

export function pickRateForCountry(
  rates: SizeCoverageRate[],
  countryRaw: string,
  variantGroup: string,
): SizeCoverageRate | null {
  const country = String(countryRaw || "").trim().toUpperCase();
  const forGroup = rates.filter((r) => r.variantGroup === variantGroup);
  const exact = forGroup.find((r) => r.countryCode.toUpperCase() === country);
  if (exact) return exact;
  return forGroup.find((r) => r.countryCode.toUpperCase() === "ROW") ?? null;
}

function uniqueShipsToSizes(params: {
  mappings: SizeColorMapping[];
  rates: SizeCoverageRate[];
  country: string;
}): ShipsToSize[] {
  const bySize = new Map<string, ShipsToSize>();
  for (const m of params.mappings) {
    const sizeId = splitSizeColorKey(m.sizeColorKey).size;
    if (!sizeId || bySize.has(sizeId)) continue;
    const rate = pickRateForCountry(params.rates, params.country, m.variantGroup);
    const shippable = !!(rate && rate.shippable && rate.tier !== "excluded");
    bySize.set(sizeId, {
      sizeId,
      variantGroup: m.variantGroup,
      tier: rate?.tier ?? "excluded",
      firstItemCents: rate?.firstItemCents ?? null,
      shippable,
      matchedZone: rate?.countryCode ?? null,
    });
  }
  return Array.from(bySize.values());
}

function suggestSize(shipsTo: ShipsToSize[]): string | null {
  const ok = shipsTo.filter((s) => s.shippable);
  if (ok.length === 0) return null;
  const rank = (t: string) => (t === "normal" ? 0 : t === "warned" ? 1 : 2);
  ok.sort((a, b) => {
    const tr = rank(a.tier) - rank(b.tier);
    if (tr !== 0) return tr;
    return (a.firstItemCents ?? Number.MAX_SAFE_INTEGER) - (b.firstItemCents ?? Number.MAX_SAFE_INTEGER);
  });
  return ok[0].sizeId;
}

function emptyVerdict(params: {
  country: string;
  sizeId: string;
  colorId: string | null;
  reason: SizeCoverageFailReason;
  shipsToSizes?: ShipsToSize[];
}): SizeCoverageVerdict {
  const shipsToSizes = params.shipsToSizes ?? [];
  return {
    allowed: false,
    country: params.country,
    sizeId: params.sizeId,
    colorId: params.colorId,
    variantGroup: null,
    matchedZone: null,
    tier: null,
    firstItemCents: null,
    additionalCents: null,
    reason: params.reason,
    shipsToSizes,
    suggestedSizeId: suggestSize(shipsToSizes),
  };
}

/** Evaluate (size, colour, country) against already-loaded mappings + rates. */
export function evaluateSizeCountryCoverage(params: {
  mappings: SizeColorMapping[];
  rates: SizeCoverageRate[];
  size: string | null | undefined;
  color?: string | null;
  country: string;
}): SizeCoverageVerdict {
  const country = String(params.country || "").trim().toUpperCase();
  const shipsToSizes = uniqueShipsToSizes({
    mappings: params.mappings,
    rates: params.rates,
    country,
  });

  const resolved = resolveVariantGroupForSelection({
    mappings: params.mappings,
    size: params.size,
    color: params.color,
  });
  if (!resolved.ok) {
    return emptyVerdict({
      country,
      sizeId: resolved.sizeId,
      colorId: resolved.colorId,
      reason: resolved.reason,
      shipsToSizes,
    });
  }

  const rate = pickRateForCountry(params.rates, country, resolved.variantGroup);
  if (!rate) {
    return {
      ...emptyVerdict({
        country,
        sizeId: resolved.sizeId,
        colorId: resolved.colorId,
        reason: "no_rate",
        shipsToSizes,
      }),
      variantGroup: resolved.variantGroup,
    };
  }

  const excluded = !rate.shippable || rate.tier === "excluded";
  if (excluded) {
    return {
      allowed: false,
      country,
      sizeId: resolved.sizeId,
      colorId: resolved.colorId,
      variantGroup: resolved.variantGroup,
      matchedZone: rate.countryCode,
      tier: rate.tier,
      firstItemCents: rate.firstItemCents,
      additionalCents: rate.additionalCents ?? null,
      reason: "excluded",
      shipsToSizes,
      suggestedSizeId: suggestSize(shipsToSizes),
    };
  }

  return {
    allowed: true,
    country,
    sizeId: resolved.sizeId,
    colorId: resolved.colorId,
    variantGroup: resolved.variantGroup,
    matchedZone: rate.countryCode,
    tier: rate.tier,
    firstItemCents: rate.firstItemCents,
    additionalCents: rate.additionalCents ?? null,
    reason: null,
    shipsToSizes,
    suggestedSizeId: suggestSize(shipsToSizes),
  };
}

export type ShippingGenerate409 = {
  error: "SHIPPING_EXCLUDED" | "SHIPPING_UNMAPPED";
  code: "SHIPPING_EXCLUDED" | "SHIPPING_UNMAPPED";
  message: string;
  country: string;
  productTypeId: number | null;
  sizeId: string;
  colorId: string | null;
  variantGroup: string | null;
  matchedZone: string | null;
  tier: string | null;
  reason: SizeCoverageVerdict["reason"];
  firstItemCents: number | null;
  shipsToSizes: ShipsToSize[];
  suggestedSizeId: string | null;
};

function blockMessage(verdict: SizeCoverageVerdict): string {
  if (verdict.reason === "excluded") {
    return `This size cannot ship to ${verdict.country}. Choose a size that does, or change your shipping country.`;
  }
  if (verdict.reason === "color_unmapped") {
    return `This size/colour is not mapped for shipping to ${verdict.country}.`;
  }
  if (verdict.reason === "size_unmapped") {
    return `This size is not mapped for shipping to ${verdict.country}.`;
  }
  if (verdict.reason === "no_rate" || verdict.reason === "no_matrix") {
    return `Shipping coverage is missing for this product/size in ${verdict.country}. Generation blocked.`;
  }
  return `This size cannot be generated for ${verdict.country}.`;
}

/** Route contract: if this returns a body, do not spend a credit or enqueue generation. */
export function shippingGenerateBlockResponse(
  verdict: SizeCoverageVerdict,
  productTypeId: number | null,
): ShippingGenerate409 | null {
  if (verdict.allowed) return null;
  const code = verdict.reason === "excluded" ? "SHIPPING_EXCLUDED" : "SHIPPING_UNMAPPED";
  return {
    error: code,
    code,
    message: blockMessage(verdict),
    country: verdict.country,
    productTypeId,
    sizeId: verdict.sizeId,
    colorId: verdict.colorId,
    variantGroup: verdict.variantGroup,
    matchedZone: verdict.matchedZone,
    tier: verdict.tier,
    reason: verdict.reason,
    firstItemCents: verdict.firstItemCents,
    shipsToSizes: verdict.shipsToSizes.filter((s) => s.shippable),
    suggestedSizeId: verdict.suggestedSizeId,
  };
}

/**
 * Same order the storefront generate route uses: look up, then maybe spend.
 * Tests use this to prove a blocked verdict never calls `spend`.
 */
export async function spendStudioCreditIfCoverageAllows<T>(params: {
  verdict: SizeCoverageVerdict;
  productTypeId: number | null;
  spend: () => Promise<T>;
}): Promise<{ blocked: ShippingGenerate409 | null; spent: boolean; result?: T }> {
  const blocked = shippingGenerateBlockResponse(params.verdict, params.productTypeId);
  if (blocked) return { blocked, spent: false };
  const result = await params.spend();
  return { blocked: null, spent: true, result };
}
