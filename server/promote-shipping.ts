import { and, eq, inArray } from "drizzle-orm";
import {
  PromoteShippingError,
  collectStudioVariantIds,
  promoteBlockedWithoutMappedStudioVariants,
} from "@shared/promoteShipping";
import { shippingStoreSettings, shippingStoreVariants } from "@shared/schema";
import { db } from "./db";
import { normalizeMyshopifyShopDomain } from "./shopDomain";

export { PromoteShippingError };

/**
 * Refuse before a Shopify product is created. Does not reconcile, and does
 * not invent a profile. A customizer page is what puts studio variants on the map.
 */
export async function assertProductTypeReadyToPromote(params: {
  shop: string;
  productTypeName: string;
  variantIdMaps: unknown[];
}): Promise<void> {
  const shop = normalizeMyshopifyShopDomain(params.shop);
  const [settings] = await db
    .select({ shippingMode: shippingStoreSettings.shippingMode })
    .from(shippingStoreSettings)
    .where(eq(shippingStoreSettings.shopDomain, shop));

  const studioVariantIds = collectStudioVariantIds(params.variantIdMaps);
  let mappedVariantIds: string[] = [];
  if (settings?.shippingMode === "table" && studioVariantIds.length > 0) {
    const rows = await db
      .select({ shopifyVariantId: shippingStoreVariants.shopifyVariantId })
      .from(shippingStoreVariants)
      .where(
        and(
          eq(shippingStoreVariants.shopDomain, shop),
          eq(shippingStoreVariants.source, "base"),
          inArray(shippingStoreVariants.shopifyVariantId, studioVariantIds),
        ),
      );
    mappedVariantIds = rows.map((row) => row.shopifyVariantId);
  }

  if (
    promoteBlockedWithoutMappedStudioVariants({
      shippingMode: settings?.shippingMode,
      studioVariantIds,
      mappedVariantIds,
    })
  ) {
    throw new PromoteShippingError(params.productTypeName);
  }
}
