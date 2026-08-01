/** Parse Printify variant cost in cents from catalog or shop product payloads. */
export function extractPrintifyVariantCostCents(variant: unknown): number | undefined {
  if (!variant || typeof variant !== "object") return undefined;
  const v = variant as Record<string, unknown>;
  const variantId = v.id ?? v.variant_id;
  if (variantId == null) return undefined;

  const direct = v.cost;
  if (typeof direct === "number" && Number.isFinite(direct)) return Math.round(direct);
  if (typeof direct === "string" && direct.trim()) {
    const n = Number(direct);
    if (Number.isFinite(n)) return Math.round(n);
  }

  const priceTag = (v.priceTag ?? v.price_tag) as Record<string, unknown> | undefined;
  if (priceTag && priceTag.cost != null) {
    const tagCost = priceTag.cost;
    if (typeof tagCost === "number" && Number.isFinite(tagCost)) return Math.round(tagCost);
    if (typeof tagCost === "string" && tagCost.trim()) {
      const n = Number(tagCost);
      if (Number.isFinite(n)) return Math.round(n);
    }
  }

  return undefined;
}

/** Build printifyVariantId → cost (cents) from catalog variants.json entries. */
export function extractCostsFromCatalogVariants(variants: unknown[]): Record<string, number> {
  const costs: Record<string, number> = {};
  for (const variant of variants) {
    if (!variant || typeof variant !== "object") continue;
    const v = variant as Record<string, unknown>;
    const variantId = v.id ?? v.variant_id;
    if (variantId == null) continue;
    const cost = extractPrintifyVariantCostCents(variant);
    if (cost != null) costs[String(variantId)] = cost;
  }
  return costs;
}

/** Build printifyVariantId → cost (cents) from a shop product payload. */
export function extractCostsFromPrintifyProduct(product: unknown): Record<string, number> {
  const costs: Record<string, number> = {};
  const variants = (product as { variants?: unknown[] } | null)?.variants;
  if (!Array.isArray(variants)) return costs;
  for (const variant of variants) {
    const v = variant as Record<string, unknown>;
    const variantId = v?.id;
    if (variantId == null) continue;
    const cost = extractPrintifyVariantCostCents(variant);
    if (cost != null) costs[String(variantId)] = cost;
  }
  return costs;
}

export type PrintifyCostsTiered = {
  front: Record<string, number>;
  both?: Record<string, number>;
};

function isTieredCostsPayload(value: unknown): value is PrintifyCostsTiered {
  return (
    !!value &&
    typeof value === "object" &&
    "front" in value &&
    typeof (value as PrintifyCostsTiered).front === "object" &&
    (value as PrintifyCostsTiered).front != null &&
    !Array.isArray((value as PrintifyCostsTiered).front)
  );
}

/** Serialize front-only (legacy) or front+both cost maps for product_types.printify_costs. */
export function serializePrintifyCostsCache(
  costsOrTiered: Record<string, number> | PrintifyCostsTiered,
): string {
  const fetchedAt = new Date().toISOString();
  if (isTieredCostsPayload(costsOrTiered)) {
    return JSON.stringify({
      front: costsOrTiered.front,
      ...(costsOrTiered.both && Object.keys(costsOrTiered.both).length > 0
        ? { both: costsOrTiered.both }
        : {}),
      _fetchedAt: fetchedAt,
    });
  }
  // Always persist the tiered shape going forward so front vs both can coexist.
  return JSON.stringify({ front: costsOrTiered, _fetchedAt: fetchedAt });
}

/** Keep only costs for Printify variant IDs in the active variantMap. */
export function filterCostsToPrintifyVariantIds(
  costs: Record<string, number>,
  variantIds: Iterable<number>,
): Record<string, number> {
  const idSet = new Set([...variantIds].map(Number).filter((id) => Number.isFinite(id) && id > 0));
  if (idSet.size === 0) return { ...costs };
  const filtered: Record<string, number> = {};
  for (const [key, value] of Object.entries(costs)) {
    if (idSet.has(Number(key))) filtered[key] = value;
  }
  return filtered;
}

/** True when at least one active variant has a cached production cost. */
export function cacheCoversVariantIds(
  costs: Record<string, number>,
  variantIds: Iterable<number>,
): boolean {
  const keys = Object.keys(costs);
  if (keys.length === 0) return false;
  const idSet = new Set([...variantIds].map(Number).filter((id) => Number.isFinite(id) && id > 0));
  if (idSet.size === 0) return true;
  for (const id of idSet) {
    if (costs[String(id)] != null) return true;
  }
  return false;
}

function extractNumericCostMap(raw: Record<string, unknown>): Record<string, number> {
  const costs: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "_fetchedAt" || key === "front" || key === "both") continue;
    if (typeof value === "number" && Number.isFinite(value)) costs[key] = value;
  }
  return costs;
}

/**
 * Parse cached Printify costs.
 * - Legacy flat `{ [variantId]: cents, _fetchedAt }` → treated as front-only
 * - Tiered `{ front, both?, _fetchedAt }` → `costs` aliases `front` for existing call sites
 */
export function parsePrintifyCostsCache(raw: string | null | undefined): {
  costs: Record<string, number>;
  front: Record<string, number>;
  both: Record<string, number>;
  fetchedAt: string | null;
} {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  const fetchedAt = typeof parsed._fetchedAt === "string" ? parsed._fetchedAt : null;

  if (isTieredCostsPayload(parsed)) {
    const front = extractNumericCostMap(
      (parsed.front && typeof parsed.front === "object" ? parsed.front : {}) as Record<string, unknown>,
    );
    // Prefer nested both; also accept accidentally-flat numeric keys only on front
    const bothRaw =
      parsed.both && typeof parsed.both === "object" && !Array.isArray(parsed.both)
        ? (parsed.both as Record<string, unknown>)
        : {};
    const both = extractNumericCostMap(bothRaw);
    return { costs: front, front, both, fetchedAt };
  }

  const flat = extractNumericCostMap(parsed);
  return { costs: flat, front: flat, both: {}, fetchedAt };
}

/** True when cached both-side costs exist for at least one variant. */
export function hasBothSideCosts(raw: string | null | undefined): boolean {
  const { both } = parsePrintifyCostsCache(raw);
  return Object.keys(both).length > 0;
}
