import { describe, expect, it } from "vitest";
import {
  PromoteShippingError,
  collectStudioVariantIds,
  promoteBlockedWithoutMappedStudioVariants,
  promoteShippingRefusal,
} from "./promoteShipping";

describe("promote shipping fail-closed", () => {
  it("names the product type and requires a customizer page", () => {
    const message = promoteShippingRefusal("Unisex Softstyle T-Shirt");
    expect(message).toContain("Unisex Softstyle T-Shirt");
    expect(message).toContain("no mapped studio variants");
    expect(message).toContain("customizer page is required");
    expect(new PromoteShippingError("Poster").message).toContain("Poster");
    expect(new PromoteShippingError("Poster").status).toBe(409);
  });

  it("reads studio variant ids from the front and both maps", () => {
    expect(
      collectStudioVariantIds([
        { "S:Black": "111", "M:White": 222 },
        { "S:Black / back": "gid://shopify/ProductVariant/333" },
        null,
        "not-a-map",
      ]),
    ).toEqual(["111", "222", "333"]);
  });

  it("refuses in table mode when none of the studio ids are mapped", () => {
    expect(
      promoteBlockedWithoutMappedStudioVariants({
        shippingMode: "table",
        studioVariantIds: ["111"],
        mappedVariantIds: [],
      }),
    ).toBe(true);
    expect(
      promoteBlockedWithoutMappedStudioVariants({
        shippingMode: "table",
        studioVariantIds: [],
        mappedVariantIds: ["999"],
      }),
    ).toBe(true);
  });

  it("allows promote when a studio variant is already mapped", () => {
    expect(
      promoteBlockedWithoutMappedStudioVariants({
        shippingMode: "table",
        studioVariantIds: ["111", "222"],
        mappedVariantIds: ["222"],
      }),
    ).toBe(false);
  });

  it("does not refuse when the shop is not on the shipping table", () => {
    expect(
      promoteBlockedWithoutMappedStudioVariants({
        shippingMode: "off",
        studioVariantIds: [],
        mappedVariantIds: [],
      }),
    ).toBe(false);
    expect(
      promoteBlockedWithoutMappedStudioVariants({
        shippingMode: null,
        studioVariantIds: [],
        mappedVariantIds: [],
      }),
    ).toBe(false);
  });
});
