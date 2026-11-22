import { describe, expect, it } from "vitest";
import {
  PETPOSTEROUS_CATALOGUE_SHOP,
  STAGING_CATALOGUE_SHOP,
  candidateVisibleToShop,
  catalogueShopAllowed,
  operatorCatalogueForShop,
} from "./operatorCatalogue";

describe("operatorCatalogueForShop", () => {
  it("lets Petposterous choose its own types and does not pin a Printify shop", () => {
    expect(operatorCatalogueForShop("h7epay-gh")).toEqual({
      shop: PETPOSTEROUS_CATALOGUE_SHOP,
    });
    expect(operatorCatalogueForShop("https://h7epay-gh.myshopify.com/admin")).toEqual({
      shop: PETPOSTEROUS_CATALOGUE_SHOP,
    });
  });

  it("keeps other sessions on the staging demo shop without pinning a product type id", () => {
    expect(operatorCatalogueForShop("ai-art-studio-staging.myshopify.com")).toEqual({
      shop: STAGING_CATALOGUE_SHOP,
    });
    expect(operatorCatalogueForShop("some-merchant.myshopify.com").shop).toBe(STAGING_CATALOGUE_SHOP);
    expect(operatorCatalogueForShop(null).shop).toBe(STAGING_CATALOGUE_SHOP);
  });

  it("shows a session only its own candidates", () => {
    expect(candidateVisibleToShop("h7epay-gh.myshopify.com", "h7epay-gh.myshopify.com")).toBe(true);
    expect(candidateVisibleToShop("h7epay-gh.myshopify.com", STAGING_CATALOGUE_SHOP)).toBe(false);
    expect(candidateVisibleToShop(STAGING_CATALOGUE_SHOP, STAGING_CATALOGUE_SHOP)).toBe(true);
    expect(candidateVisibleToShop(STAGING_CATALOGUE_SHOP, PETPOSTEROUS_CATALOGUE_SHOP)).toBe(false);
    expect(catalogueShopAllowed("other.myshopify.com")).toBe(false);
    expect(catalogueShopAllowed(PETPOSTEROUS_CATALOGUE_SHOP)).toBe(true);
    expect(catalogueShopAllowed(STAGING_CATALOGUE_SHOP)).toBe(true);
    expect(catalogueShopAllowed(null)).toBe(false);
    expect(catalogueShopAllowed("")).toBe(false);
    expect(catalogueShopAllowed(undefined)).toBe(false);
  });
});
