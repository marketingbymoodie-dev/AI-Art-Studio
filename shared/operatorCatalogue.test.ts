import { describe, expect, it } from "vitest";
import {
  PETPOSTEROUS_CATALOGUE_SHOP,
  PETPOSTEROUS_PRINTIFY_SHOP_ID,
  PETPOSTEROUS_PRODUCT_TYPE_ID,
  SHARED_COLOUR_BLANK_TYPE_ID,
  STAGING_CATALOGUE_SHOP,
  candidateVisibleToShop,
  catalogueShopAllowed,
  operatorCatalogueForShop,
} from "./operatorCatalogue";

describe("operatorCatalogueForShop", () => {
  it("gives Petposterous its own type and Printify shop", () => {
    expect(operatorCatalogueForShop("h7epay-gh")).toEqual({
      shop: PETPOSTEROUS_CATALOGUE_SHOP,
      defaultProductTypeId: PETPOSTEROUS_PRODUCT_TYPE_ID,
      printifyShopId: PETPOSTEROUS_PRINTIFY_SHOP_ID,
    });
    expect(operatorCatalogueForShop("https://h7epay-gh.myshopify.com/admin")).toMatchObject({
      shop: PETPOSTEROUS_CATALOGUE_SHOP,
      defaultProductTypeId: 56,
      printifyShopId: "29135517",
    });
  });

  it("keeps every other shop on the staging catalogue", () => {
    expect(operatorCatalogueForShop("ai-art-studio-staging.myshopify.com")).toEqual({
      shop: STAGING_CATALOGUE_SHOP,
      defaultProductTypeId: SHARED_COLOUR_BLANK_TYPE_ID,
      printifyShopId: null,
    });
    expect(operatorCatalogueForShop("some-merchant.myshopify.com").shop).toBe(STAGING_CATALOGUE_SHOP);
    expect(operatorCatalogueForShop(null).defaultProductTypeId).toBe(54);
  });

  it("shows a session only its own candidates", () => {
    expect(candidateVisibleToShop("h7epay-gh.myshopify.com", "h7epay-gh.myshopify.com")).toBe(true);
    expect(candidateVisibleToShop("h7epay-gh.myshopify.com", STAGING_CATALOGUE_SHOP)).toBe(false);
    expect(candidateVisibleToShop(STAGING_CATALOGUE_SHOP, STAGING_CATALOGUE_SHOP)).toBe(true);
    expect(candidateVisibleToShop(STAGING_CATALOGUE_SHOP, PETPOSTEROUS_CATALOGUE_SHOP)).toBe(false);
    expect(catalogueShopAllowed("other.myshopify.com")).toBe(false);
    expect(catalogueShopAllowed(PETPOSTEROUS_CATALOGUE_SHOP)).toBe(true);
  });
});
