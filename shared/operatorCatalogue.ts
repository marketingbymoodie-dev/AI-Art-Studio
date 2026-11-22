/**
 * Which shop an operator catalogue session reads and writes.
 * Staging keeps the demo catalogue. Petposterous is an operator shop with its
 * own products. Product types are not pinned by id: each shop lists the types
 * whose Shopify shell lives on that shop. The staging demo Softstyle is the
 * row on the staging shop with Printify blueprint 145 and provider 99.
 */
export const STAGING_CATALOGUE_SHOP = "ai-art-studio-staging.myshopify.com";
export const PETPOSTEROUS_CATALOGUE_SHOP = "h7epay-gh.myshopify.com";

export type OperatorCatalogueProfile = {
  shop: string;
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
    return { shop: PETPOSTEROUS_CATALOGUE_SHOP };
  }
  return { shop: STAGING_CATALOGUE_SHOP };
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
