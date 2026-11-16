/**
 * Printify calls for an operator shop use that shop's connected merchant.
 * The shop id comes from the installation, never a hardcoded Printify shop.
 */
import { and, asc, eq } from "drizzle-orm";
import { catalogueShopAllowed, catalogueShopDomain, operatorCatalogueForShop } from "@shared/operatorCatalogue";
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

/** Staging with no selection stays on type 54. Other operator shops use their first owned type. */
export async function defaultCatalogueTypeId(shopDomain: string | null | undefined): Promise<number> {
  const profile = operatorCatalogueForShop(shopDomain);
  if (profile.fallbackProductTypeId) return profile.fallbackProductTypeId;
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
