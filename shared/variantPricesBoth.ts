/**
 * Front+back retail map helpers.
 *
 * Merchant Resync / create-wizard keys prices by blank rows from `/api/appai/blanks`,
 * which use `printify:{printifyVariantId}`. The storefront resolves the active
 * Shopify variant id + `size:color` / `Size / Color` labels. Without expansion,
 * both-tier prices are saved but never match → UI stays on the front Shopify price.
 */

import { parsePrintifyCostsCache } from "./printifyProductionCosts";
import { resolveMarkupPercent, suggestedRetailDollarsString } from "./productIntelligence";
import { normalizePrintifyColorKey, slugPrintifyColorId } from "./printifyColorSlug";

export type VariantPricesBothExpandContext = {
  variantMap?: unknown;
  shopifyVariantIds?: unknown;
  sizes?: unknown;
  frameColors?: unknown;
};

type VariantMeta = {
  shopifyId?: string;
  sizeName?: string;
  colorName?: string;
  title?: string;
  mapKey?: string;
  printifyId?: string;
};

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

function parseJsonArray(raw: unknown): Array<{ id?: string; name?: string }> {
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

function normalizePrice(price: string | number): string | null {
  const n = parseFloat(String(price));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(2);
}

/** Expand a both-tier price map so storefront lookups (Shopify id / size:color) hit. */
export function expandVariantPricesBothMap(
  raw: Record<string, string> | null | undefined,
  ctx: VariantPricesBothExpandContext,
): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (key: string | number | null | undefined, price: string) => {
    if (key == null) return;
    const k = String(key).trim();
    if (!k) return;
    const formatted = normalizePrice(price);
    if (!formatted) return;
    out[k] = formatted;
  };

  const aliasMeta = (meta: VariantMeta | undefined, price: string) => {
    if (!meta) return;
    put(meta.shopifyId, price);
    put(meta.mapKey, price);
    put(meta.title, price);
    put(meta.printifyId, price);
    if (meta.printifyId) put(`printify:${meta.printifyId}`, price);
    if (meta.sizeName && meta.colorName) {
      put(`${meta.sizeName}:${meta.colorName}`, price);
      put(`${meta.sizeName} / ${meta.colorName}`, price);
      const noSolid = meta.colorName.replace(/^solid\s+/i, "").trim();
      if (noSolid && noSolid.toLowerCase() !== meta.colorName.toLowerCase()) {
        put(`${meta.sizeName}:${noSolid}`, price);
        put(`${meta.sizeName} / ${noSolid}`, price);
      }
      const colorSlug = slugPrintifyColorId(meta.colorName);
      const colorNorm = normalizePrintifyColorKey(meta.colorName);
      if (colorSlug) put(`${meta.sizeName}:${colorSlug}`, price);
      if (colorNorm && colorNorm !== colorSlug) put(`${meta.sizeName}:${colorNorm}`, price);
    } else if (meta.sizeName) {
      put(meta.sizeName, price);
      put(`${meta.sizeName}:default`, price);
    }
  };

  const vm = parseJsonObject(ctx.variantMap);
  const svIds = parseJsonObject(ctx.shopifyVariantIds);
  const sizes = parseJsonArray(ctx.sizes);
  const colors = parseJsonArray(ctx.frameColors);

  const byPrintify = new Map<string, VariantMeta>();
  const byShopify = new Map<string, VariantMeta>();
  const byTitle = new Map<string, VariantMeta>();

  for (const [mapKey, shopifyVid] of Object.entries(svIds)) {
    const [sizeId, colorId = "default"] = String(mapKey).split(":");
    const sizeName =
      sizes.find((s) => String(s.id) === sizeId)?.name ?? sizeId;
    const colorName = colors.find((c) => String(c.id) === colorId)?.name;
    const hasColor = !!(colorName && colorId !== "default");
    const title = hasColor ? `${sizeName} / ${colorName}` : sizeName;
    const vmEntry = vm[mapKey] as { printifyVariantId?: number | string } | undefined;
    const printifyId = vmEntry?.printifyVariantId != null ? String(vmEntry.printifyVariantId) : undefined;
    const meta: VariantMeta = {
      shopifyId: String(shopifyVid),
      sizeName,
      colorName: hasColor ? colorName : undefined,
      title,
      mapKey: String(mapKey),
      printifyId,
    };
    byShopify.set(String(shopifyVid), meta);
    byTitle.set(title.toLowerCase(), meta);
    if (printifyId) byPrintify.set(printifyId, meta);
  }

  for (const [mapKey, entry] of Object.entries(vm)) {
    const e = entry as { printifyVariantId?: number | string } | null;
    if (e?.printifyVariantId == null) continue;
    const printifyId = String(e.printifyVariantId);
    if (byPrintify.has(printifyId)) continue;
    const [sizeId, colorId = "default"] = String(mapKey).split(":");
    const sizeName =
      sizes.find((s) => String(s.id) === sizeId)?.name ?? sizeId;
    const colorName = colors.find((c) => String(c.id) === colorId)?.name;
    const hasColor = !!(colorName && colorId !== "default");
    const title = hasColor ? `${sizeName} / ${colorName}` : sizeName;
    const meta: VariantMeta = {
      sizeName,
      colorName: hasColor ? colorName : undefined,
      title,
      mapKey: String(mapKey),
      printifyId,
    };
    byPrintify.set(printifyId, meta);
    byTitle.set(title.toLowerCase(), meta);
  }

  for (const [key, price] of Object.entries(raw || {})) {
    put(key, price);
    const k = String(key);

    if (k.startsWith("printify:")) {
      const pid = k.slice("printify:".length);
      put(pid, price);
      aliasMeta(byPrintify.get(pid), price);
      continue;
    }

    if (byPrintify.has(k)) {
      put(`printify:${k}`, price);
      aliasMeta(byPrintify.get(k), price);
      continue;
    }

    if (byShopify.has(k)) {
      aliasMeta(byShopify.get(k), price);
      continue;
    }

    const titleMeta = byTitle.get(k.toLowerCase());
    if (titleMeta) {
      aliasMeta(titleMeta, price);
      continue;
    }

    if (k.includes("/")) {
      const [sn, cn] = k.split("/").map((s) => s.trim());
      if (sn && cn) {
        put(`${sn}:${cn}`, price);
        put(`${sn} / ${cn}`, price);
      }
    }
  }

  return out;
}

/** Accept object or JSON-string both-tier maps from designer config. */
export function coerceVariantPricesBothMap(raw: unknown): Record<string, string> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, string>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, string>;
  }
  return {};
}

function numericShopifyVariantId(raw: string): string {
  const s = String(raw || "").trim();
  const gid = s.match(/\/ProductVariant\/(\d+)/i);
  return gid?.[1] || s;
}

function keyHasSizeToken(key: string, sizeName: string): boolean {
  const sn = sizeName.trim().toLowerCase();
  if (!sn) return false;
  const kl = key.toLowerCase();
  // Short labels like "S" must not match "XS" / "2XL" / "Ash".
  if (sn.length <= 2) {
    return kl.split(/[^a-z0-9]+/).filter(Boolean).includes(sn);
  }
  return kl.includes(sn);
}

/** Resolve a both-tier retail dollar amount from an (ideally expanded) price map. */
export function resolveBothRetailDollarsFromMap(
  map: Record<string, string> | null | undefined,
  opts?: {
    sizeName?: string;
    colorName?: string;
    shopifyVariantId?: string | null;
    printifyVariantId?: string | null;
  },
): number | null {
  if (!map || Object.keys(map).length === 0) return null;

  const sizeName = opts?.sizeName ?? "";
  const colorName = opts?.colorName ?? "";
  const colorNoSolid = colorName.replace(/^solid\s+/i, "").trim();
  const colorSlug = colorName ? slugPrintifyColorId(colorName) : "";
  const colorNorm = colorName ? normalizePrintifyColorKey(colorName) : "";
  const vid = opts?.shopifyVariantId ? String(opts.shopifyVariantId) : "";
  const vidNumeric = vid ? numericShopifyVariantId(vid) : "";
  const printifyId = opts?.printifyVariantId ? String(opts.printifyVariantId) : "";

  const candidates = [
    vid,
    vidNumeric && vidNumeric !== vid ? vidNumeric : "",
    printifyId ? `printify:${printifyId}` : "",
    printifyId,
    colorName ? `${sizeName}:${colorName}` : "",
    colorName ? `${sizeName} / ${colorName}` : "",
    colorNoSolid && colorNoSolid !== colorName ? `${sizeName}:${colorNoSolid}` : "",
    colorNoSolid && colorNoSolid !== colorName ? `${sizeName} / ${colorNoSolid}` : "",
    colorSlug ? `${sizeName}:${colorSlug}` : "",
    colorNorm && colorNorm !== colorSlug ? `${sizeName}:${colorNorm}` : "",
    sizeName ? `${sizeName}:default` : "",
    sizeName,
  ].filter(Boolean);

  const lowerMap = new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));

  for (const key of candidates) {
    const raw = map[key] ?? lowerMap.get(key.toLowerCase());
    const n = raw != null ? parseFloat(String(raw)) : NaN;
    if (Number.isFinite(n) && n > 0) return n;
  }

  if (sizeName) {
    const cn = (colorNoSolid || colorName).toLowerCase();
    for (const [k, raw] of Object.entries(map)) {
      const kl = k.toLowerCase();
      if (kl.startsWith("printify:") && !keyHasSizeToken(k, sizeName)) continue;
      if (!keyHasSizeToken(k, sizeName)) continue;
      if (cn && !kl.includes(cn)) continue;
      const n = parseFloat(String(raw));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }

  // Last resort: one shared both-tier price across the map (common for S–XL).
  const unique = new Set<string>();
  let only: number | null = null;
  for (const raw of Object.values(map)) {
    const n = parseFloat(String(raw));
    if (!Number.isFinite(n) || n <= 0) continue;
    const key = n.toFixed(2);
    unique.add(key);
    only = n;
    if (unique.size > 1) return null;
  }
  return only;
}

/** Build an expanded both-tier retail map from cached Printify both-side COGS + markup. */
export function synthesizeBothRetailMapFromCosts(
  printifyCostsRaw: unknown,
  markupPercent: number | null | undefined,
  ctx: VariantPricesBothExpandContext,
): Record<string, string> {
  const raw =
    typeof printifyCostsRaw === "string"
      ? printifyCostsRaw
      : printifyCostsRaw == null
        ? "{}"
        : JSON.stringify(printifyCostsRaw);
  const { both, front } = parsePrintifyCostsCache(raw);
  const markup = resolveMarkupPercent(markupPercent);
  const seed: Record<string, string> = {};
  for (const [printifyId, cents] of Object.entries(both)) {
    if (!printifyId || printifyId.startsWith("_")) continue;
    const retail = suggestedRetailDollarsString(cents, markup);
    if (!retail) continue;
    const frontRetail = suggestedRetailDollarsString(front[printifyId], markup);
    const frontN = frontRetail != null ? parseFloat(frontRetail) : 0;
    const bothN = parseFloat(retail);
    // Keep Print on Back strictly above the matching front suggested retail.
    if (Number.isFinite(frontN) && frontN > 0 && bothN <= frontN) {
      const bumped = (Math.ceil(frontN + 1) - 0.05).toFixed(2);
      seed[`printify:${printifyId}`] = bumped;
    } else {
      seed[`printify:${printifyId}`] = retail;
    }
  }
  return expandVariantPricesBothMap(seed, ctx);
}

/**
 * Designer / storefront both-tier map: prefer the merchant-saved map, otherwise
 * synthesize from cached both-side Printify costs so Print on Back can still
 * raise the headline after a front-only Resync.
 */
export function resolveDesignerVariantPricesBoth(
  savedRaw: unknown,
  printifyCostsRaw: unknown,
  markupPercent: number | null | undefined,
  ctx: VariantPricesBothExpandContext,
): Record<string, string> {
  const saved = expandVariantPricesBothMap(coerceVariantPricesBothMap(savedRaw), ctx);
  if (Object.keys(saved).length > 0) return saved;
  return synthesizeBothRetailMapFromCosts(printifyCostsRaw, markupPercent, ctx);
}

/** Last-resort front+back retail when no both-tier map/costs exist yet. */
export function estimateBothRetailFromFront(front: number): number | null {
  if (!Number.isFinite(front) || front <= 0) return null;
  return bothRetailAboveFront(Math.ceil(front * 1.22) - 0.05, front);
}

/**
 * Print on Back must never show the same (or lower) price as front-only.
 * If the both-tier map is missing a surcharge vs live Shopify front, step up
 * to the next .95 above front so the toggle is visible.
 */
export function bothRetailAboveFront(both: number | null, front: number): number | null {
  if (both == null || !Number.isFinite(both) || both <= 0) return null;
  if (!Number.isFinite(front) || front <= 0) return both;
  if (both > front + 0.005) return both;
  const bumped = Math.ceil(front + 1) - 0.05;
  return bumped > front ? bumped : both;
}

/** Cheapest both-tier retail in the map — used for “from $X” before a size is picked. */
export function minBothRetailDollarsFromMap(
  map: Record<string, string> | null | undefined,
): number | null {
  if (!map) return null;
  let min: number | null = null;
  for (const raw of Object.values(map)) {
    const n = parseFloat(String(raw));
    if (!Number.isFinite(n) || n <= 0) continue;
    if (min == null || n < min) min = n;
  }
  return min;
}
