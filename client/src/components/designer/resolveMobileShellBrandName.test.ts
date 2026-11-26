import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOBILE_SHELL_BRAND,
  resolveMobileShellBrandName,
} from "./resolveMobileShellBrandName";

describe("resolveMobileShellBrandName", () => {
  it("falls back to AI Art Studio when nothing is scoped", () => {
    expect(resolveMobileShellBrandName({})).toBe(DEFAULT_MOBILE_SHELL_BRAND);
  });

  it("uses the creator public shop name on creator storefronts", () => {
    expect(
      resolveMobileShellBrandName({
        isCreatorStorefront: true,
        creatorStoreName: "Willow & Finch Studio",
        shopNameParam: "Platform Checkout Shop",
        merchantStoreName: "Platform Checkout Shop",
      }),
    ).toBe("Willow & Finch Studio");
  });

  it("does not use merchant / theme shop name on creator storefronts", () => {
    expect(
      resolveMobileShellBrandName({
        isCreatorStorefront: true,
        shopNameParam: "Platform Checkout Shop",
        merchantStoreName: "Platform Checkout Shop",
      }),
    ).toBe(DEFAULT_MOBILE_SHELL_BRAND);
  });

  it("prefers the live Shopify shop name for independent merchants", () => {
    expect(
      resolveMobileShellBrandName({
        shopNameParam: "Northshore Goods",
        merchantStoreName: "Legacy DB Name",
      }),
    ).toBe("Northshore Goods");
  });

  it("uses merchant storeName when the theme did not pass shopName", () => {
    expect(
      resolveMobileShellBrandName({
        merchantStoreName: "Harbor Prints",
      }),
    ).toBe("Harbor Prints");
  });
});
