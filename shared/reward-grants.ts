/**
 * Reward Ladder grant keys + $50 USD threshold display.
 * Newsletter is once-per-customer. Share/purchase are per related entity.
 */
import { currencyForShipCountry } from "./ship-country";

export const PURCHASE_THRESHOLD_USD_CENTS = 5000;

export type RepeatableRewardRung = "share_design" | "purchase_threshold";

export function isRepeatableRewardRung(rungKey: string): rungKey is RepeatableRewardRung {
  return rungKey === "share_design" || rungKey === "purchase_threshold";
}

/** Stable Shopify order id (numeric). GID and raw id collapse to the same key. */
export function canonicalOrderId(raw: string | number | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const gid = s.match(/\/Order\/(\d+)/i) || s.match(/^(\d+)$/);
  return gid ? gid[1] : s;
}

/** One credit per distinct shared design — never per visitor/session. */
export function shareDesignRelatedEntityId(shareId: string): string {
  return String(shareId || "").trim();
}

export function purchaseRelatedEntityId(orderId: string | number): string {
  return canonicalOrderId(orderId);
}

/** True when an existing share grant already paid out this share (including legacy shareId:visitor keys). */
export function shareGrantMatchesShareId(
  relatedEntityId: string | null | undefined,
  shareId: string,
): boolean {
  const id = shareDesignRelatedEntityId(shareId);
  const rel = String(relatedEntityId || "");
  if (!id || !rel) return false;
  return rel === id || rel.startsWith(`${id}:`);
}

/**
 * Shop/presentment cents → USD cents via pinned USD→shop-unit rate.
 * shopCents / rate, floored — grant only when they clearly clear $50 USD.
 */
export function shopCentsToUsdCents(
  shopCents: number,
  usdToShopUnitRate: number | null | undefined,
): number | null {
  const cents = Math.round(Number(shopCents) || 0);
  if (cents <= 0) return null;
  const rate = Number(usdToShopUnitRate);
  if (!(rate > 0)) return null;
  if (rate === 1) return cents;
  return Math.floor(cents / rate);
}

/**
 * Display the USD threshold in the shopper's currency using the same pinned rate.
 * Ceil to a whole unit so spending the shown amount clears $50 USD
 * even if Shopify's live checkout FX is a touch worse.
 */
export function formatPurchaseThresholdDisplay(params: {
  usdCents?: number;
  shopperCurrency: string;
  usdToShopperRate: number | null | undefined;
}): { currency: string; amount: number; label: string; usedPinnedRate: boolean } {
  const usdCents = params.usdCents ?? PURCHASE_THRESHOLD_USD_CENTS;
  const currency = String(params.shopperCurrency || "USD").trim().toUpperCase() || "USD";
  const rate = Number(params.usdToShopperRate);
  if (currency === "USD" || !(rate > 0)) {
    const amount = Math.max(1, Math.ceil(usdCents / 100));
    return { currency: "USD", amount, label: `$${amount} USD`, usedPinnedRate: false };
  }
  const raw = (usdCents / 100) * rate;
  const amount = Math.max(1, Math.ceil(raw));
  return {
    currency,
    amount,
    label: formatShopperThresholdLabel(currency, amount),
    usedPinnedRate: true,
  };
}

export function formatShopperThresholdLabel(currency: string, amount: number): string {
  const c = currency.toUpperCase();
  const n = amount.toLocaleString("en", { maximumFractionDigits: 0 });
  if (c === "USD") return `$${n} USD`;
  if (c === "GBP") return `£${n}`;
  if (c === "EUR") return `€${n}`;
  if (c === "JPY" || c === "KRW") return `${c} ${n}`;
  return `${c} $${n}`;
}

export function purchaseThresholdDisplayForCountry(params: {
  country: string;
  usdToShopperRate: number | null | undefined;
  usdCents?: number;
}) {
  return formatPurchaseThresholdDisplay({
    usdCents: params.usdCents,
    shopperCurrency: currencyForShipCountry(params.country),
    usdToShopperRate: params.usdToShopperRate,
  });
}
