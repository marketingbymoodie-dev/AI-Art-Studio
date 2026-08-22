/** Pure Printify → checkout shipping math (no I/O). */

export type PrintifyShippingLineQuote = {
  /** Same print facility / provider. Extra qty of the same variant uses additional-item. */
  groupKey: string;
  variantKey: string;
  quantity: number;
  firstItemCents: number;
  additionalItemCents: number;
};

export type PrintifyShippingTierQuote = {
  serviceCode: string;
  serviceName: string;
  description: string;
  totalUsdCents: number;
};

export function countryLookupKeys(country: string | null | undefined): string[] {
  const raw = String(country || "").trim().toUpperCase();
  if (!raw) return ["REST_OF_THE_WORLD"];
  const iso = raw.length === 2 ? raw : raw.slice(0, 2);
  const keys = [raw];
  if (iso && iso !== raw) keys.push(iso);
  keys.push("REST_OF_THE_WORLD");
  return Array.from(new Set(keys));
}

/** Combine qty of the same variant, then charge first + (n-1)×additional per variant group. */
export function quotePrintifyLinesUsdCents(lines: PrintifyShippingLineQuote[]): number {
  const byVariant = new Map<string, PrintifyShippingLineQuote>();
  for (const line of lines) {
    const key = `${line.groupKey}::${line.variantKey}`;
    const existing = byVariant.get(key);
    if (!existing) {
      byVariant.set(key, { ...line });
      continue;
    }
    existing.quantity += line.quantity;
  }
  let total = 0;
  for (const line of byVariant.values()) {
    const qty = Math.max(1, Math.floor(line.quantity) || 1);
    const first = Math.max(0, Math.round(line.firstItemCents));
    const extra = Math.max(0, Math.round(line.additionalItemCents));
    total += first + Math.max(0, qty - 1) * extra;
  }
  return total;
}

export function convertUsdCentsToShop(
  usdCents: number,
  shopCurrency: string,
  usdPerShopUnit: number,
): { amountCents: number; currency: string } {
  const currency = String(shopCurrency || "USD").trim().toUpperCase() || "USD";
  const usd = Math.max(0, Math.round(usdCents));
  if (currency === "USD" || !(usdPerShopUnit > 0)) {
    return { amountCents: usd, currency: currency === "USD" ? "USD" : currency };
  }
  return {
    amountCents: Math.max(0, Math.round(usd * usdPerShopUnit)),
    currency,
  };
}

export function printifyShippingLineProps(opts: {
  productTypeId?: string | number | null;
  blueprintId?: number | string | null;
  providerId?: number | string | null;
  printifyVariantId?: number | string | null;
}): Record<string, string> {
  const out: Record<string, string> = {};
  const pt = opts.productTypeId != null ? String(opts.productTypeId).trim() : "";
  if (pt && pt !== "0") out._product_type_id = pt;
  const bp = opts.blueprintId != null ? String(opts.blueprintId).trim() : "";
  if (bp && bp !== "0") out._printify_blueprint_id = bp;
  const pr = opts.providerId != null ? String(opts.providerId).trim() : "";
  if (pr && pr !== "0") out._printify_provider_id = pr;
  const vid = opts.printifyVariantId != null ? String(opts.printifyVariantId).trim() : "";
  if (vid && vid !== "0") out._printify_variant_id = vid;
  return out;
}
