/**
 * Front+back retail map helpers.
 *
 * Merchant Resync / create-wizard keys prices by blank rows from `/api/appai/blanks`,
 * which use `printify:{printifyVariantId}`. The storefront resolves the active
 * Shopify variant id + `size:color` / `Size / Color` labels. Without expansion,
 * both-tier prices are saved but never match → UI stays on the front Shopify price.
 */

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
  const vid = opts?.shopifyVariantId ? String(opts.shopifyVariantId) : "";
  const printifyId = opts?.printifyVariantId ? String(opts.printifyVariantId) : "";

  const candidates = [
    vid,
    printifyId ? `printify:${printifyId}` : "",
    printifyId,
    colorName ? `${sizeName}:${colorName}` : "",
    colorName ? `${sizeName} / ${colorName}` : "",
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
    const sn = sizeName.toLowerCase();
    const cn = colorName.toLowerCase();
    for (const [k, raw] of Object.entries(map)) {
      const kl = k.toLowerCase();
      // Skip opaque printify-only keys in loose scan unless they somehow include the label.
      if (kl.startsWith("printify:") && !kl.includes(sn)) continue;
      if (!kl.includes(sn)) continue;
      if (cn && !kl.includes(cn)) continue;
      const n = parseFloat(String(raw));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }

  return null;
}
