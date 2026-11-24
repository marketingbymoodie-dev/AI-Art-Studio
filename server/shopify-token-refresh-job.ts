/**
 * Renew expiring Shopify offline tokens before they die.
 * Access tokens last about an hour. This runs even when nobody is publishing.
 * A failed refresh is logged and emailed from ensureValidOfflineAccessToken.
 * It does not reinstall the app.
 */
import { and, isNotNull, lte, ne } from "drizzle-orm";
import { shopifyInstallations } from "@shared/schema";
import { db } from "./db";
import { ensureValidOfflineAccessToken } from "./shopify-offline-token";

const LEAD_MS = 15 * 60 * 1000;

export async function refreshExpiringShopifyTokens(): Promise<void> {
  const due = await db
    .select()
    .from(shopifyInstallations)
    .where(and(
      ne(shopifyInstallations.status, "uninstalled"),
      isNotNull(shopifyInstallations.refreshToken),
      isNotNull(shopifyInstallations.accessTokenExpiresAt),
      lte(shopifyInstallations.accessTokenExpiresAt, new Date(Date.now() + LEAD_MS)),
    ));
  for (const row of due) {
    const ready = await ensureValidOfflineAccessToken(row);
    if (!ready.ok) {
      console.error(`[shopify-token] scheduled refresh failed for ${row.shopDomain}: ${ready.error}`);
    }
  }
}
