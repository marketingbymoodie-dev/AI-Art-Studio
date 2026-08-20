import { normalizeVariantLabelForCostMatch } from "./printifyCostLabels";

type SizeOrColor = { id?: string; name?: string };

function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function parseJsonArray(raw: unknown): SizeOrColor[] {
  if (!raw) return [];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? raw : [];
}

export type ShopifyVariantForPriceSync = {
  id: number | string;
  title?: string | null;
  option1?: string | null;
  option2?: string | null;
};

/**
 * Build printifyVariantId → Shopify variant id for Resync Prices.
 * Always merges shopifyVariantIds + live Shopify title/option matches so partial
 * id maps (common when option names differ slightly) still cover every blank row.
 */
export function buildPrintifyToShopifyVariantIdMap(args: {
  variantMap?: unknown;
  shopifyVariantIds?: unknown;
  sizes?: unknown;
  frameColors?: unknown;
  shopifyVariants?: ShopifyVariantForPriceSync[];
}): Record<string, number> {
  const out: Record<string, number> = {};
  const vm = parseJsonObject(args.variantMap);
  const svIds = parseJsonObject(args.shopifyVariantIds);
  const sizes = parseJsonArray(args.sizes);
  const colors = parseJsonArray(args.frameColors);
  const shopifyVariants = args.shopifyVariants ?? [];

  const put = (printifyId: string | number | null | undefined, shopifyId: number) => {
    if (printifyId == null || !shopifyId) return;
    const key = String(printifyId);
    if (!key || out[key]) return;
    out[key] = shopifyId;
  };

  /** Normalized label → Shopify variant id */
  const byNormLabel = new Map<string, number>();
  const addLabel = (label: string | null | undefined, shopifyId: number) => {
    if (!label || !shopifyId) return;
    const norm = normalizeVariantLabelForCostMatch(label);
    if (!norm) return;
    if (!byNormLabel.has(norm)) byNormLabel.set(norm, shopifyId);
    // Cotton crew etc.: Printify may use "Solid Black" while Shopify stores "Black"
    const noSolid = normalizeVariantLabelForCostMatch(norm.replace(/\bsolid\s+/g, ""));
    if (noSolid && !byNormLabel.has(noSolid)) byNormLabel.set(noSolid, shopifyId);
    // Slash colorways: "BLACK/ RED" ↔ "BLACK/RED"
    const compactSlash = norm.replace(/\s*\/\s*/g, "/");
    if (compactSlash && !byNormLabel.has(compactSlash)) byNormLabel.set(compactSlash, shopifyId);
    // Printify SKUs / ids: "one_size" / "one-size" ↔ Shopify "One Size"
    const unsnake = normalizeVariantLabelForCostMatch(norm.replace(/[_-]+/g, " "));
    if (unsnake && !byNormLabel.has(unsnake)) byNormLabel.set(unsnake, shopifyId);
  };

  for (const sv of shopifyVariants) {
    const id = Number(sv.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (sv.title) addLabel(sv.title, id);
    // Never index bare option1 when option2 exists — "S" would collide across colors.
    if (sv.option1 && !sv.option2) addLabel(sv.option1, id);
    if (sv.option1 && sv.option2) {
      addLabel(`${sv.option1} / ${sv.option2}`, id);
      addLabel(`${sv.option1}:${sv.option2}`, id);
    }
  }

  // shopifyVariantIds may be keyed by sizeId:colorId OR option names (S:Heather Grey).
  const nameToShopifyId: Record<string, number> = {};
  for (const [mapKey, shopifyVid] of Object.entries(svIds)) {
    const id = Number(shopifyVid);
    if (!Number.isFinite(id) || id <= 0) continue;
    nameToShopifyId[mapKey] = id;
    nameToShopifyId[normalizeVariantLabelForCostMatch(mapKey)] = id;
    addLabel(mapKey.replace(":", " / "), id);

    const [kSize, kColor] = String(mapKey).split(":");
    const sizeName = sizes.find((s) => String(s.id) === kSize)?.name ?? kSize;
    const colorName = colors.find((c) => String(c.id) === kColor)?.name ?? kColor;
    if (sizeName) {
      const nameKey = colorName && kColor !== "default" ? `${sizeName}:${colorName}` : `${sizeName}:default`;
      nameToShopifyId[nameKey] = id;
      nameToShopifyId[normalizeVariantLabelForCostMatch(nameKey)] = id;
      addLabel(colorName && kColor !== "default" ? `${sizeName} / ${colorName}` : sizeName, id);
    }
  }

  for (const [vmKey, entry] of Object.entries(vm)) {
    const e = entry as { printifyVariantId?: number | string } | null;
    if (e?.printifyVariantId == null) continue;
    const printifyId = String(e.printifyVariantId);
    const [sizeId, colorId = "default"] = String(vmKey).split(":");
    const sizeName = sizes.find((s) => String(s.id) === sizeId)?.name ?? sizeId;
    const colorName = colors.find((c) => String(c.id) === colorId)?.name;
    const title =
      colorName && colorId !== "default" ? `${sizeName} / ${colorName}` : sizeName;

    const candidates = [
      vmKey,
      normalizeVariantLabelForCostMatch(vmKey),
      colorName ? `${sizeName}:${colorName}` : `${sizeName}:default`,
      colorName ? normalizeVariantLabelForCostMatch(`${sizeName}:${colorName}`) : "",
      `${sizeName}:${colorId}`,
      `${sizeId}:${colorName ?? colorId}`,
      title,
      normalizeVariantLabelForCostMatch(title),
    ].filter(Boolean);

    let shopifyId = 0;
    for (const candidate of candidates) {
      const norm = normalizeVariantLabelForCostMatch(candidate);
      const noSolid = normalizeVariantLabelForCostMatch(norm.replace(/\bsolid\s+/g, ""));
      const compactSlash = norm.replace(/\s*\/\s*/g, "/");
      shopifyId =
        nameToShopifyId[candidate] ||
        nameToShopifyId[norm] ||
        nameToShopifyId[noSolid] ||
        byNormLabel.get(norm) ||
        byNormLabel.get(noSolid) ||
        byNormLabel.get(compactSlash) ||
        0;
      if (shopifyId) break;
    }
    put(printifyId, shopifyId);
  }

  // One Size / single-SKU blanks: only one Shopify variant — map every Printify id to it.
  if (shopifyVariants.length === 1) {
    const onlyId = Number(shopifyVariants[0].id);
    if (Number.isFinite(onlyId) && onlyId > 0) {
      for (const entry of Object.values(vm)) {
        const e = entry as { printifyVariantId?: number | string } | null;
        put(e?.printifyVariantId, onlyId);
      }
    }
  }

  return out;
}

export function parseShopifyVariantPrice(price: string | number | null | undefined): number {
  const n = parseFloat(String(price ?? "").replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** True only when the cached/Shopify price is a real retail amount. */
export function hasPositiveRetailPrice(price: string | number | null | undefined): boolean {
  return parseShopifyVariantPrice(price) > 0;
}

/** Every Shopify variant on the product has a real retail price. Empty list is not priced. */
export function allShopifyVariantsHavePositiveRetail(
  variants: Array<{ price?: string | number | null }> | null | undefined,
): boolean {
  if (!Array.isArray(variants) || variants.length === 0) return false;
  return variants.every((v) => hasPositiveRetailPrice(v.price));
}

/**
 * Customer-facing amount (e.g. "29.95"), or null when missing/zero.
 * Never returns "0.00" — catalogs must not advertise a free product.
 */
export function displayRetailPrice(price: string | number | null | undefined): string | null {
  const n = parseShopifyVariantPrice(price);
  return n > 0 ? n.toFixed(2) : null;
}

/** Cheapest positive price from a wizard/Shopify map, or null if none. */
export function minPositiveRetailPrice(
  prices:
    | Array<string | number | null | undefined>
    | Record<string, string | number | null | undefined>
    | null
    | undefined,
): number | null {
  const values = Array.isArray(prices)
    ? prices
    : prices && typeof prices === "object"
      ? Object.values(prices)
      : [];
  let min = Infinity;
  for (const p of values) {
    const n = parseShopifyVariantPrice(p);
    if (n > 0 && n < min) min = n;
  }
  return Number.isFinite(min) ? min : null;
}

/** Shopify lists variants in option order (often largest size first). "From" must use the cheapest. */
export function pickLowestPricedShopifyVariant<T extends { price?: string | number | null }>(
  variants: T[] | null | undefined,
): T | undefined {
  if (!Array.isArray(variants) || variants.length === 0) return undefined;
  let best: T | undefined;
  let bestN = Infinity;
  for (const v of variants) {
    const n = parseShopifyVariantPrice(v?.price);
    if (n <= 0) continue;
    if (n < bestN) {
      bestN = n;
      best = v;
    }
  }
  return best ?? variants[0];
}

export function resolveStorefrontHeadlinePrice(args: {
  variants: Array<{ id?: string | number; price?: string | number | null }>;
  sizeSelected: boolean;
  matchedVariantId?: string | null;
  bothPrice?: number | null;
  hasBothRetailPrices?: boolean;
  printPlacementUsesBoth?: boolean;
}): { amount: number; showFrom: boolean } | null {
  const cheapest = pickLowestPricedShopifyVariant(args.variants);
  if (!cheapest) return null;

  const matched =
    args.sizeSelected && args.matchedVariantId
      ? args.variants.find((v) => String(v.id) === String(args.matchedVariantId))
      : undefined;
  const variant = args.sizeSelected ? matched ?? cheapest : cheapest;
  const front = parseShopifyVariantPrice(variant.price);
  if (front <= 0) return null;

  const both = args.bothPrice ?? null;
  if (args.printPlacementUsesBoth) {
    const amount =
      both != null && both > front + 0.005
        ? both
        : both != null && both > 0
          ? Math.ceil(front + 1) - 0.05
          : Math.ceil(front * 1.22) - 0.05;
    if (amount > 0) {
      return { amount, showFrom: !args.sizeSelected };
    }
  }

  const cheapestN = parseShopifyVariantPrice(cheapest.price);
  const hasHigherSize = args.variants.some((v) => {
    const n = parseShopifyVariantPrice(v.price);
    return n > cheapestN + 0.005;
  });
  // "from" is only for no size yet: cheapest front, or a hint that back-print costs more.
  // Once a size is picked, show that size's front price with no prefix.
  const showFromSize = !args.sizeSelected && hasHigherSize;
  const showFromBoth = !!(
    !args.sizeSelected &&
    args.hasBothRetailPrices &&
    !args.printPlacementUsesBoth &&
    both != null &&
    both > front
  );
  return { amount: front, showFrom: showFromSize || showFromBoth };
}
