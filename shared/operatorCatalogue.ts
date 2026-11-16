/**
 * Which shop an operator catalogue session reads and writes.
 * Staging keeps the demo catalogue. Petposterous is an operator shop with its
 * own products. Product types are not pinned here: each shop lists the types
 * whose Shopify shell lives on that shop. Type 54 is the staging fallback
 * only when nothing is selected.
 */
export const STAGING_CATALOGUE_SHOP = "ai-art-studio-staging.myshopify.com";
export const PETPOSTEROUS_CATALOGUE_SHOP = "h7epay-gh.myshopify.com";
/** Staging demo garment when the operator has not chosen a type. */
export const STAGING_FALLBACK_PRODUCT_TYPE_ID = 54;

export type OperatorCatalogueProfile = {
  shop: string;
  /** Set only for the staging demo. Other operator shops pick a type from their rows. */
  fallbackProductTypeId: number | null;
};

export function catalogueShopDomain(shop: string | null | undefined): string {
  let s = String(shop || "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "");
  const slash = s.indexOf("/");
  if (slash >= 0) s = s.slice(0, slash);
  if (!s) return "";
  if (s.endsWith(".myshopify.com")) return s;
  if (/^[a-z0-9][a-z0-9-]*$/.test(s)) return `${s}.myshopify.com`;
  return s;
}

export function operatorCatalogueForShop(shopDomain: string | null | undefined): OperatorCatalogueProfile {
  if (catalogueShopDomain(shopDomain) === PETPOSTEROUS_CATALOGUE_SHOP) {
    return { shop: PETPOSTEROUS_CATALOGUE_SHOP, fallbackProductTypeId: null };
  }
  return { shop: STAGING_CATALOGUE_SHOP, fallbackProductTypeId: STAGING_FALLBACK_PRODUCT_TYPE_ID };
}

export function catalogueShopAllowed(shop: string | null | undefined): boolean {
  const domain = catalogueShopDomain(shop);
  return domain === STAGING_CATALOGUE_SHOP || domain === PETPOSTEROUS_CATALOGUE_SHOP;
}

/** A Petposterous session only sees Petposterous rows. Other operator sessions stay on staging. */
export function candidateVisibleToShop(
  requestShop: string | null | undefined,
  candidateShop: string | null | undefined,
): boolean {
  return catalogueShopDomain(candidateShop) === operatorCatalogueForShop(requestShop).shop;
}
