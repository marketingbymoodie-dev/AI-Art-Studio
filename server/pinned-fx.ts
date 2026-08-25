/**
 * Read-only pinned USD→currency rates (same source shipping uses).
 * Never fetches a live FX API — page loads and grant checks stay stable.
 */
import { eq } from "drizzle-orm";
import { shippingStoreSettings } from "@shared/schema";
import { db } from "./db";
import { normalizeMyshopifyShopDomain } from "./shopDomain";

export const SHIPPING_FX_BUFFER = Number(process.env.SHIPPING_FX_BUFFER || 1.05);

function bufferedEnvUsdToCurrency(currency: string): number | null {
  const c = currency.toUpperCase();
  if (c === "USD") return 1;
  const raw = Number(process.env[`PRINTIFY_SHIPPING_USD_${c}`] || 0);
  if (!(raw > 0)) return null;
  return Math.round(raw * SHIPPING_FX_BUFFER * 10000) / 10000;
}

/**
 * USD→`currency` units, already buffered the way shipping pins.
 * Prefer the shop pin when it is for this currency; else env; else null.
 * Does not insert shipping_store_settings.
 */
export async function readPinnedUsdToCurrency(params: {
  currency: string;
  shop?: string | null;
}): Promise<number | null> {
  const currency = String(params.currency || "USD").trim().toUpperCase() || "USD";
  if (currency === "USD") return 1;

  if (params.shop) {
    try {
      const shop = normalizeMyshopifyShopDomain(params.shop);
      const [settings] = shop
        ? await db
            .select()
            .from(shippingStoreSettings)
            .where(eq(shippingStoreSettings.shopDomain, shop))
        : [];
      const pinned = settings?.pinnedFxRate ? Number(settings.pinnedFxRate) : NaN;
      const pinCurrency = String(settings?.pinnedFxCurrency || "").trim().toUpperCase();
      if (pinned > 0 && pinCurrency === currency) return pinned;
      // Legacy pin with no currency stamp: only trust it when env agrees (same currency).
      const env = bufferedEnvUsdToCurrency(currency);
      if (pinned > 0 && !pinCurrency && env && Math.abs(env - pinned) / pinned <= 0.15) {
        return pinned;
      }
    } catch {
      /* env fallback */
    }
  }

  return bufferedEnvUsdToCurrency(currency);
}
