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
  };

  for (const sv of shopifyVariants) {
    const id = Number(sv.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (sv.title) addLabel(sv.title, id);
    if (sv.option1) addLabel(sv.option1, id);
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
      shopifyId =
        nameToShopifyId[candidate] ||
        nameToShopifyId[normalizeVariantLabelForCostMatch(candidate)] ||
        byNormLabel.get(normalizeVariantLabelForCostMatch(candidate)) ||
        0;
      if (shopifyId) break;
    }
    put(printifyId, shopifyId);
  }

  return out;
}
