import { describe, expect, it } from "vitest";
import {
  cataloguePublishAllowedForShop,
  cataloguePublishAllowedShops,
  cataloguePublishBlockMessage,
  cataloguePublishLocked,
  catalogueStudioBlockMessage,
  CATALOGUE_PUBLISH_LOCKED_MESSAGE,
  CATALOGUE_PUBLISH_SHOP_MESSAGE,
  CATALOGUE_STUDIO_LOCKED_MESSAGE,
  CATALOGUE_STUDIO_SHOP_MESSAGE,
} from "./cataloguePublishAccess";
import { PETPOSTEROUS_CATALOGUE_SHOP, STAGING_CATALOGUE_SHOP } from "./operatorCatalogue";

describe("catalogue publish allowlist", () => {
  it("keeps the first production boot locked when the shop list is unset", () => {
    const env = { RAILWAY_ENVIRONMENT_NAME: "production" };
    expect(cataloguePublishLocked(env)).toBe(true);
    expect(cataloguePublishAllowedShops(env)).toEqual([]);
    expect(cataloguePublishAllowedForShop(PETPOSTEROUS_CATALOGUE_SHOP, env)).toBe(false);
    expect(cataloguePublishBlockMessage(PETPOSTEROUS_CATALOGUE_SHOP, env)).toBe(CATALOGUE_PUBLISH_LOCKED_MESSAGE);
  });

  it("allows only the listed shops after the lock is lifted", () => {
    const env = {
      RAILWAY_ENVIRONMENT_NAME: "production",
      CATALOGUE_PUBLISH_ALLOWED_SHOPS: "h7epay-gh",
    };
    expect(cataloguePublishLocked(env)).toBe(false);
    expect(cataloguePublishAllowedShops(env)).toEqual([PETPOSTEROUS_CATALOGUE_SHOP]);
    expect(cataloguePublishAllowedForShop(PETPOSTEROUS_CATALOGUE_SHOP, env)).toBe(true);
    expect(cataloguePublishAllowedForShop(STAGING_CATALOGUE_SHOP, env)).toBe(false);
    expect(cataloguePublishAllowedForShop("other-merchant.myshopify.com", env)).toBe(false);
    expect(cataloguePublishAllowedForShop(null, env)).toBe(false);
    expect(cataloguePublishBlockMessage(STAGING_CATALOGUE_SHOP, env)).toBe(CATALOGUE_PUBLISH_SHOP_MESSAGE);
  });

  it("keeps both catalogue shops on staging and ignores a production-style list", () => {
    const env = {
      RAILWAY_ENVIRONMENT_NAME: "staging",
      CATALOGUE_PUBLISH_ALLOWED_SHOPS: "h7epay-gh.myshopify.com",
    };
    expect(cataloguePublishLocked(env)).toBe(false);
    expect(cataloguePublishAllowedShops(env)).toEqual([
      STAGING_CATALOGUE_SHOP,
      PETPOSTEROUS_CATALOGUE_SHOP,
    ]);
    expect(cataloguePublishAllowedForShop(STAGING_CATALOGUE_SHOP, env)).toBe(true);
    expect(cataloguePublishBlockMessage("other-merchant.myshopify.com", env)).toBe(CATALOGUE_PUBLISH_SHOP_MESSAGE);
  });

  it("opens studio edits only for the same allowlist", () => {
    const locked = { RAILWAY_ENVIRONMENT_NAME: "production" };
    expect(catalogueStudioBlockMessage(PETPOSTEROUS_CATALOGUE_SHOP, locked)).toBe(CATALOGUE_STUDIO_LOCKED_MESSAGE);
    const lifted = {
      RAILWAY_ENVIRONMENT_NAME: "production",
      CATALOGUE_PUBLISH_ALLOWED_SHOPS: "h7epay-gh.myshopify.com",
    };
    expect(catalogueStudioBlockMessage(PETPOSTEROUS_CATALOGUE_SHOP, lifted)).toBeNull();
    expect(catalogueStudioBlockMessage(STAGING_CATALOGUE_SHOP, lifted)).toBe(CATALOGUE_STUDIO_SHOP_MESSAGE);
    expect(catalogueStudioBlockMessage("other-merchant.myshopify.com", lifted)).toBe(CATALOGUE_STUDIO_SHOP_MESSAGE);
    const staging = { RAILWAY_ENVIRONMENT_NAME: "staging", CATALOGUE_PUBLISH_ALLOWED_SHOPS: "h7epay-gh" };
    expect(catalogueStudioBlockMessage(STAGING_CATALOGUE_SHOP, staging)).toBeNull();
    expect(catalogueStudioBlockMessage(PETPOSTEROUS_CATALOGUE_SHOP, staging)).toBeNull();
    expect(catalogueStudioBlockMessage("other-merchant.myshopify.com", staging)).toBe(CATALOGUE_STUDIO_SHOP_MESSAGE);
  });
});
