/**
 * Shadow sell price is the catalogue variant's Admin price in shop currency.
 * A client / presentment amount is never written. Front+back uses the
 * catalogue's both-tier variant (or the merchant both-tier map), both of
 * which are shop currency, and only when the selection is both.
 */
import { printSidesOfVariant } from "@shared/printSides";
import { resolveDesignerVariantPricesBoth } from "@shared/variantPricesBoth";
import { SHADOW_FETCH_TIMEOUT_MS as PRICE_FETCH_TIMEOUT_MS } from "./shadow-admin-fetch";

export function formatShopPrice(price: string | number | null | undefined): string | null {
  const n = parseFloat(String(price ?? ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(2);
}

/**
 * Catalogue price, or the shop-currency both-tier amount when that selection
 * is on and the catalogue variant itself is still the front variant.
 * There is no client-price argument.
 */
export function pickShadowShopPrice(
  cataloguePrice: string | number | null | undefined,
  bothShopPrice: string | number | null | undefined,
  applyBothTier: boolean,
): { front: string | null; written: string | null; source: "catalogue-variant" } {
  const front = formatShopPrice(cataloguePrice);
  const both = applyBothTier ? formatShopPrice(bothShopPrice) : null;
  return { front, written: both || front, source: "catalogue-variant" };
}

const currencyCache = new Map<string, { code: string; at: number }>();

export async function readShopCurrency(shop: string, token: string): Promise<string> {
  const hit = currencyCache.get(shop);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.code;
  let code = "";
  try {
    const res = await fetch(`https://${shop}/admin/api/2025-10/shop.json?fields=currency`, {
      headers: { "X-Shopify-Access-Token": token },
      signal: AbortSignal.timeout(PRICE_FETCH_TIMEOUT_MS),
    });
    if (res.ok) {
      const body = (await res.json()) as { shop?: { currency?: string } };
      code = String(body?.shop?.currency || "").trim().toUpperCase();
    }
  } catch {
    code = "";
  }
  if (!code) code = "USD";
  currencyCache.set(shop, { code, at: Date.now() });
  return code;
}

export function logResolveShadowPrice(amount: string, currency: string, clientSent: boolean): void {
  console.log(
    `[ResolveVariant] shadow price base=${amount} ${currency} source=catalogue-variant client=${clientSent ? "ignored" : "none"}`,
  );
}

function clientSentPrice(value: unknown): boolean {
  if (value == null) return false;
  const s = String(value).trim();
  if (!s) return false;
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0;
}

type CatalogueVariant = {
  title?: string | null;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
  selectedOptions?: Array<{ name?: string | null; value?: string | null }> | null;
  price?: string | number | null;
  id?: string | number;
};

async function fetchVariant(
  shop: string,
  token: string,
  variantId: string,
): Promise<CatalogueVariant | null> {
  const id = String(variantId || "").replace(/\D/g, "");
  if (!id) return null;
  try {
    const res = await fetch(`https://${shop}/admin/api/2025-10/variants/${id}.json`, {
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(PRICE_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { variant?: CatalogueVariant };
    return body?.variant ?? null;
  } catch {
    return null;
  }
}

/** Shop-currency both-tier retail. Never reads a request price. */
async function bothTierShopPrice(opts: {
  shop: string;
  token: string;
  baseVariantId: string;
  productTypeId?: unknown;
  sizeId?: unknown;
  colorId?: unknown;
}): Promise<string | null> {
  const ptId = parseInt(String(opts.productTypeId ?? ""), 10);
  if (!Number.isFinite(ptId) || ptId <= 0) return null;
  const { storage } = await import("./storage");
  const pt = await storage.getProductType(ptId);
  if (!pt) return null;
  const sizeId = String(opts.sizeId || "").trim();
  const colorId = String(opts.colorId || "").trim() || "default";
  const bothIds =
    pt.shopifyVariantIdsBoth && typeof pt.shopifyVariantIdsBoth === "object"
      ? (pt.shopifyVariantIdsBoth as Record<string, unknown>)
      : {};
  const bothRaw = bothIds[`${sizeId}:${colorId}`] ?? (sizeId ? bothIds[sizeId] : undefined);
  const bothId = String(bothRaw ?? "").replace(/\D/g, "");
  const baseId = String(opts.baseVariantId || "").replace(/\D/g, "");
  if (bothId && bothId !== baseId) {
    const twin = await fetchVariant(opts.shop, opts.token, bothId);
    const twinPrice = formatShopPrice(twin?.price);
    if (twinPrice) return twinPrice;
  }
  const map = resolveDesignerVariantPricesBoth(
    pt.variantPricesBoth,
    pt.printifyCosts,
    pt.defaultMarkupPercent,
    {
      variantMap: pt.variantMap,
      shopifyVariantIds: pt.shopifyVariantIds,
      sizes: pt.sizes,
      frameColors: pt.frameColors,
    },
  );
  return (
    formatShopPrice(map[baseId]) ||
    formatShopPrice(map[`${sizeId}:${colorId}`]) ||
    formatShopPrice(sizeId ? map[sizeId] : null)
  );
}

export async function decideShadowShopPrice(opts: {
  shop: string;
  token: string;
  baseVariantId: string | number;
  catalogueVariant?: CatalogueVariant | null;
  /** Only the literal "both" selects the both tier. A money amount does not. */
  printSides?: unknown;
  productTypeId?: unknown;
  sizeId?: unknown;
  colorId?: unknown;
  /** Present only so the log can say ignored. Never used as a price. */
  clientPrice?: unknown;
}): Promise<{ front: string | null; written: string | null; source: "catalogue-variant" }> {
  const shop = String(opts.shop || "").trim();
  const token = String(opts.token || "").trim();
  const baseVariantId = String(opts.baseVariantId || "").replace(/\D/g, "");
  const empty = { front: null, written: null, source: "catalogue-variant" as const };
  if (!shop || !token || !baseVariantId) return empty;

  let variant = opts.catalogueVariant ?? null;
  if (!variant || formatShopPrice(variant.price) == null) {
    variant = await fetchVariant(shop, token, baseVariantId);
  }
  const catalogue = formatShopPrice(variant?.price);
  const variantIsBoth = printSidesOfVariant(variant) === "both";
  const applyBoth = opts.printSides === "both" && !variantIsBoth;
  const both = applyBoth
    ? await bothTierShopPrice({
        shop,
        token,
        baseVariantId,
        productTypeId: opts.productTypeId,
        sizeId: opts.sizeId,
        colorId: opts.colorId,
      })
    : null;
  const decided = pickShadowShopPrice(catalogue, both, applyBoth);
  if (decided.written) {
    const currency = await readShopCurrency(shop, token);
    logResolveShadowPrice(decided.written, currency, clientSentPrice(opts.clientPrice));
  }
  return decided;
}

export async function syncShadowVariantPrice(opts: {
  shop: string;
  token: string;
  shadowVariantId: string | number;
  baseVariantId: string | number;
  printSides?: unknown;
  productTypeId?: unknown;
  sizeId?: unknown;
  colorId?: unknown;
  clientPrice?: unknown;
}): Promise<{ front: string | null; written: string | null; source: "catalogue-variant" } | null> {
  const shop = String(opts.shop || "").trim();
  const token = String(opts.token || "").trim();
  const shadowVariantId = String(opts.shadowVariantId || "").replace(/\D/g, "");
  const baseVariantId = String(opts.baseVariantId || "").replace(/\D/g, "");
  if (!shop || !token || !shadowVariantId || !baseVariantId) return null;

  const decided = await decideShadowShopPrice({
    shop,
    token,
    baseVariantId,
    printSides: opts.printSides,
    productTypeId: opts.productTypeId,
    sizeId: opts.sizeId,
    colorId: opts.colorId,
    clientPrice: opts.clientPrice,
  });
  if (!decided.written) {
    console.warn(
      `[ShadowProduct] Skip shadow price write — catalogue variant ${baseVariantId} has no shop-currency price`,
    );
    return decided;
  }

  try {
    const put = await fetch(`https://${shop}/admin/api/2025-10/variants/${shadowVariantId}.json`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({
        variant: { id: Number(shadowVariantId), price: decided.written },
      }),
      signal: AbortSignal.timeout(PRICE_FETCH_TIMEOUT_MS),
    });
    if (!put.ok) {
      const t = await put.text();
      console.warn(
        `[ShadowProduct] Shadow price PUT failed for ${shadowVariantId}:`,
        put.status,
        t.substring(0, 200),
      );
      return null;
    }
    return decided;
  } catch (e: any) {
    console.warn(
      `[ShadowProduct] Shadow price PUT error for ${shadowVariantId}:`,
      e?.message || e,
    );
    return null;
  }
}
