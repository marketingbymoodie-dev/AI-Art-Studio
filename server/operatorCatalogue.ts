/**
 * Printify calls for an operator shop use that shop's connected merchant.
 * The shop id comes from the installation, never a hardcoded Printify shop.
 */
import { and, asc, eq } from "drizzle-orm";
import { catalogueShopAllowed, catalogueShopDomain, operatorCatalogueForShop, STAGING_CATALOGUE_SHOP } from "@shared/operatorCatalogue";
import { CATALOGUE_SHIRT_PROVIDER_ID, SOFTSTYLE_BLUEPRINT_ID } from "@shared/printPlacement";
import { productTypes, type Merchant } from "@shared/schema";
import { db } from "./db";
import { storage } from "./storage";

export async function listOwnedCatalogueTypes(shopDomain: string | null | undefined): Promise<Array<{ id: number; name: string }> | null> {
  const session = catalogueShopDomain(shopDomain);
  if (!catalogueShopAllowed(session)) return null;
  return db
    .select({ id: productTypes.id, name: productTypes.name })
    .from(productTypes)
    .where(and(
      eq(productTypes.shopifyShopDomain, session),
      eq(productTypes.isPlatformCatalogRef, false),
      eq(productTypes.isActive, true),
    ))
    .orderBy(asc(productTypes.id));
}

/** Staging demo Softstyle: that shop, blueprint 145, provider 99. Missing row is not a fake id. */
export async function stagingSoftstyleType(): Promise<{ id: number; name: string } | null> {
  const [row] = await db
    .select({ id: productTypes.id, name: productTypes.name })
    .from(productTypes)
    .where(and(
      eq(productTypes.shopifyShopDomain, STAGING_CATALOGUE_SHOP),
      eq(productTypes.printifyBlueprintId, SOFTSTYLE_BLUEPRINT_ID),
      eq(productTypes.printifyProviderId, CATALOGUE_SHIRT_PROVIDER_ID),
      eq(productTypes.isPlatformCatalogRef, false),
    ))
    .limit(1);
  if (!row?.id) return null;
  return { id: row.id, name: row.name || "Unisex Softstyle T-Shirt" };
}

/** Staging with no selection uses the demo Softstyle row. Other operator shops use their first owned type. */
export async function defaultCatalogueTypeId(shopDomain: string | null | undefined): Promise<number> {
  const profile = operatorCatalogueForShop(shopDomain);
  if (profile.shop === STAGING_CATALOGUE_SHOP) {
    const softstyle = await stagingSoftstyleType();
    if (softstyle) return softstyle.id;
  }
  const owned = await listOwnedCatalogueTypes(shopDomain);
  return owned?.[0]?.id ?? 0;
}

export async function shopPrintifyMerchant(shopDomain: string | null | undefined): Promise<Merchant | null> {
  const shop = catalogueShopDomain(shopDomain);
  if (!shop || !catalogueShopAllowed(shop)) return null;
  const profile = operatorCatalogueForShop(shop);
  const installation = await storage.getShopifyInstallationByShop(profile.shop);
  if (!installation?.merchantId) return null;
  const merchant = await storage.getMerchant(installation.merchantId);
  if (!merchant?.printifyApiToken || !merchant.printifyShopId) return null;
  return merchant;
}

export async function cataloguePrintifyMerchant(
  typeMerchantId: string | null | undefined,
  shopDomain?: string | null,
): Promise<Merchant | null> {
  const fromShop = await shopPrintifyMerchant(shopDomain);
  if (fromShop) return fromShop;
  if (!typeMerchantId) return null;
  return storage.getMerchant(typeMerchantId);
}
