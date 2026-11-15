import {
  operatorCatalogueForShop,
  type OperatorCatalogueProfile,
} from "@shared/operatorCatalogue";
import { storage } from "./storage";

type PrintifyMerchant = {
  printifyApiToken?: string | null;
  printifyShopId?: string | null;
};

function matchesPrintifyShop(merchant: PrintifyMerchant | null | undefined, profile: OperatorCatalogueProfile): boolean {
  if (!profile.printifyShopId) return Boolean(merchant?.printifyApiToken && merchant.printifyShopId);
  return Boolean(merchant?.printifyApiToken) && String(merchant?.printifyShopId || "").trim() === profile.printifyShopId;
}

/**
 * Petposterous catalogue calls use Printify shop 29135517.
 * The product type's merchant wins when it already points there; otherwise the
 * shop's own merchant is used. Other shops keep the product type's merchant.
 */
export async function cataloguePrintifyMerchant(
  typeMerchantId: string | null | undefined,
  shop: string | null | undefined,
) {
  const profile = operatorCatalogueForShop(shop);
  const fromType = typeMerchantId ? await storage.getMerchant(typeMerchantId) : undefined;
  if (!profile.printifyShopId) return fromType ?? null;
  if (matchesPrintifyShop(fromType, profile)) return fromType ?? null;
  const fromShop = await storage.getMerchantByShop(profile.shop);
  if (matchesPrintifyShop(fromShop, profile)) return fromShop ?? null;
  return fromShop ?? fromType ?? null;
}
