import { describe, expect, it } from "vitest";
import {
  PETPOSTEROUS_CATALOGUE_SHOP,
  STAGING_CATALOGUE_SHOP,
  STAGING_FALLBACK_PRODUCT_TYPE_ID,
  candidateVisibleToShop,
  catalogueShopAllowed,
  operatorCatalogueForShop,
} from "./operatorCatalogue";

describe("operatorCatalogueForShop", () => {
  it("lets Petposterous choose its own types and does not pin a Printify shop", () => {
    expect(operatorCatalogueForShop("h7epay-gh")).toEqual({
      shop: PETPOSTEROUS_CATALOGUE_SHOP,
      fallbackProductTypeId: null,
    });
    expect(operatorCatalogueForShop("https://h7epay-gh.myshopify.com/admin")).toEqual({
      shop: PETPOSTEROUS_CATALOGUE_SHOP,
      fallbackProductTypeId: null,
    });
  });

  it("keeps the staging demo on type 54 when nothing is selected", () => {
    expect(operatorCatalogueForShop("ai-art-studio-staging.myshopify.com")).toEqual({
      shop: STAGING_CATALOGUE_SHOP,
      fallbackProductTypeId: STAGING_FALLBACK_PRODUCT_TYPE_ID,
    });
    expect(operatorCatalogueForShop("some-merchant.myshopify.com").shop).toBe(STAGING_CATALOGUE_SHOP);
    expect(operatorCatalogueForShop(null).fallbackProductTypeId).toBe(54);
  });

  it("shows a session only its own candidates", () => {
    expect(candidateVisibleToShop("h7epay-gh.myshopify.com", "h7epay-gh.myshopify.com")).toBe(true);
    expect(candidateVisibleToShop("h7epay-gh.myshopify.com", STAGING_CATALOGUE_SHOP)).toBe(false);
    expect(candidateVisibleToShop(STAGING_CATALOGUE_SHOP, STAGING_CATALOGUE_SHOP)).toBe(true);
    expect(candidateVisibleToShop(STAGING_CATALOGUE_SHOP, PETPOSTEROUS_CATALOGUE_SHOP)).toBe(false);
    expect(catalogueShopAllowed("other.myshopify.com")).toBe(false);
    expect(catalogueShopAllowed(PETPOSTEROUS_CATALOGUE_SHOP)).toBe(true);
    expect(catalogueShopAllowed(STAGING_CATALOGUE_SHOP)).toBe(true);
  });
});
