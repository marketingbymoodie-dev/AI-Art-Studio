/**
 * Storefront customizer headline presentment formatting.
 *
 * DISPLAY-ONLY. Never feed these strings or cents into buildPriceMap,
 * resolveStorefrontHeadlinePrice, displayedRetail*, CART_STATE.price,
 * or resolve-design-variant. Those paths stay shop currency.
 */

export type PresentmentHeadlineInput = {
  shopAmount: number;
  showFrom: boolean;
  variantId?: string | null;
  activeCurrency: string | null;
  shopCurrency: string | null;
  rate: number | null;
  pricesByVariantId: Record<string, number>;
  country?: string | null;
  locale?: string | null;
  /** False for both-tier: Ajax /products/{handle}.js is front-only. */
  allowAjaxPresentment: boolean;
};

export function isShopCurrencyPresentment(
  activeCurrency: string | null | undefined,
  shopCurrency: string | null | undefined,
  rate: number | null | undefined,
): boolean {
  const active = String(activeCurrency || "").trim().toUpperCase();
  if (!active) return true;
  const shop = String(shopCurrency || "").trim().toUpperCase();
  if (shop && active === shop) return true;
  if (rate != null && Number.isFinite(rate) && Math.abs(rate - 1) < 0.0001) return true;
  return false;
}

/** Markets money follows the country, not the theme language (en-AT still uses `.`). */
export function presentmentNumberLocale(
  currency: string,
  country?: string | null,
  locale?: string | null,
): string {
  const cur = String(currency || "").toUpperCase();
  const cc = String(country || "").trim().toUpperCase();
  const lang = String(locale || "").trim().toLowerCase();
  const eurComma = new Set([
    "AT",
    "DE",
    "FR",
    "ES",
    "IT",
    "NL",
    "BE",
    "FI",
    "PT",
    "IE",
    "GR",
    "SK",
    "SI",
    "EE",
    "LV",
    "LT",
    "LU",
  ]);
  if (cur === "EUR" && cc && eurComma.has(cc)) return `de-${cc}`;
  if (cur === "EUR" && !cc) return "de-DE";
  if (lang && cc) return `${lang}-${cc}`;
  if (cc) return `en-${cc}`;
  return lang || "en";
}

/**
 * Shopify Markets fixed defaults — not merchant-customizable.
 * These currencies use 2-decimal Ajax subunits (cents / haléře / pence).
 * Round UP to the next whole major unit. Already on the unit → no bump.
 */
const WHOLE_UNIT_CURRENCIES = new Set(["AUD", "CAD", "NZD", "USD", "CZK", "GBP"]);

/**
 * Display-only: ceil UP to Shopify's increment. Already on increment → no bump.
 * EUR uses a .95 ending (not multiples of 0.95).
 * JPY Ajax is forced-cents (¥6,475 arrives as 647500); 100 yen = 10000 subunits.
 * Unknown / unverified currencies (incl. KRW) stay raw.
 */
export function ceilPresentmentEstimateCents(
  cents: number,
  currency: string | null | undefined,
): number {
  const n = Math.round(Number(cents));
  if (!Number.isFinite(n) || n <= 0) return n;
  const cur = String(currency || "").trim().toUpperCase();
  if (WHOLE_UNIT_CURRENCIES.has(cur)) {
    if (n % 100 === 0) return n;
    return Math.ceil(n / 100) * 100;
  }
  if (cur === "EUR") {
    const whole = Math.floor(n / 100);
    const frac = n - whole * 100;
    if (frac === 95) return n;
    if (frac < 95) return whole * 100 + 95;
    return (whole + 1) * 100 + 95;
  }
  if (cur === "JPY") {
    const step = 10000;
    if (n % step === 0) return n;
    return Math.ceil(n / step) * step;
  }
  return n;
}

export function formatPresentmentMoney(
  cents: number,
  currency: string,
  country?: string | null,
  locale?: string | null,
): string {
  // Ajax / cart.js money is always 2-decimal subunits, including JPY/KRW
  // (¥6,475 arrives as 647500). Do not skip this divide for zero-decimal ISO.
  const amount = cents / 100;
  const cur = String(currency || "USD").toUpperCase();
  const loc = presentmentNumberLocale(cur, country, locale);
  try {
    return new Intl.NumberFormat(loc, { style: "currency", currency: cur }).format(amount);
  } catch {
    return new Intl.NumberFormat("en", { style: "currency", currency: cur }).format(amount);
  }
}

export function formatStorefrontHeadlineDisplay(args: PresentmentHeadlineInput): {
  text: string;
  converted: boolean;
} {
  const shopAmount = Number(args.shopAmount);
  const shopFallback = () => {
    const s = `$${shopAmount.toFixed(2)}`;
    return { text: args.showFrom ? `from ${s}` : s, converted: false };
  };
  if (!Number.isFinite(shopAmount) || shopAmount <= 0) return shopFallback();

  if (isShopCurrencyPresentment(args.activeCurrency, args.shopCurrency, args.rate)) {
    return shopFallback();
  }

  let cents: number | null = null;
  if (args.allowAjaxPresentment && args.variantId) {
    const p = args.pricesByVariantId[String(args.variantId)];
    if (p != null && Number.isFinite(Number(p)) && Number(p) > 0) {
      cents = Math.round(Number(p));
    }
  }
  if (cents == null && args.rate != null && args.rate > 0 && args.activeCurrency) {
    cents = Math.round(shopAmount * args.rate * 100);
  }
  if (cents == null || cents <= 0 || !args.activeCurrency) {
    return shopFallback();
  }

  cents = ceilPresentmentEstimateCents(cents, args.activeCurrency);

  const money = appendIsoCurrencyCode(
    formatPresentmentMoney(
      cents,
      args.activeCurrency,
      args.country,
      args.locale,
    ),
    args.activeCurrency,
  );
  const core = args.showFrom ? `from ${money}` : money;
  return { text: `≈ ${core}`, converted: true };
}

/**
 * Shopify money_with_currency: ISO-4217 after the figure (`$71.00 NZD`).
 * Header picker on this shop is `NZD $`, not `NZ$` — same ISO, different slot.
 */
export function appendIsoCurrencyCode(
  formattedMoney: string,
  currency: string | null | undefined,
): string {
  const code = String(currency || "").trim().toUpperCase();
  if (!code || !formattedMoney) return formattedMoney;
  return `${formattedMoney} ${code}`;
}

/**
 * Size-dropdown shop-currency dollars. DISPLAY ONLY — never convert cents.
 * Code is appended only when the caller says presentment ≠ shop currency.
 */
export function formatShopCurrencyDropdownPrice(
  cents: number,
  shopCurrency: string | null | undefined,
  showShopCurrencyCode: boolean,
): string {
  const amount = `$${(Number(cents) / 100).toFixed(2)}`;
  if (!showShopCurrencyCode) return amount;
  return appendIsoCurrencyCode(amount, shopCurrency || "USD");
}
