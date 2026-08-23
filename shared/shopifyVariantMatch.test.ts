import { describe, expect, it } from "vitest";
import {
  matchShopifyVariantBySizeColor,
  normalizeShopifyVariantToken,
  shopifyColorTokensEqual,
} from "./shopifyVariantMatch";

describe("normalizeShopifyVariantToken", () => {
  it("normalizes slash spacing and spaces", () => {
    expect(normalizeShopifyVariantToken("White/ Navy")).toBe("white/navy");
    expect(normalizeShopifyVariantToken("White / Navy")).toBe("white/navy");
    expect(normalizeShopifyVariantToken("White/Navy")).toBe("white/navy");
    expect(normalizeShopifyVariantToken("white_navy")).toBe("white_navy");
  });
});

describe("shopifyColorTokensEqual", () => {
  it("equates slash and underscore forms", () => {
    expect(shopifyColorTokensEqual("White/ Navy", "White/Navy")).toBe(true);
    expect(shopifyColorTokensEqual("White/Navy", "white_navy")).toBe(true);
    expect(shopifyColorTokensEqual("White/ Navy", "White/ True Royal")).toBe(false);
  });
});

describe("matchShopifyVariantBySizeColor", () => {
  const baseballCatalog = [
    {
      id: 101,
      title: "White/Black / M",
      option1: "White/Black",
      option2: "M",
    },
    {
      id: 102,
      title: "White/Red / M",
      option1: "White/Red",
      option2: "M",
    },
    {
      id: 103,
      title: "White/ Navy / M",
      option1: "White/ Navy",
      option2: "M",
    },
    {
      id: 104,
      title: "White/ True Royal / M",
      option1: "White/ True Royal",
      option2: "M",
    },
    {
      id: 105,
      title: "White/Navy / L",
      option1: "White/Navy",
      option2: "L",
    },
  ];

  it("distinguishes White/Navy from White/True Royal", () => {
    expect(
      matchShopifyVariantBySizeColor(
        baseballCatalog,
        "M",
        "White/ Navy",
        true,
        "white_navy",
      ),
    ).toBe("103");
    expect(
      matchShopifyVariantBySizeColor(
        baseballCatalog,
        "M",
        "White/ True Royal",
        true,
        "white_true_royal",
      ),
    ).toBe("104");
  });

  it("matches slug color id to spaced slash Shopify option", () => {
    expect(
      matchShopifyVariantBySizeColor(baseballCatalog, "M", "", true, "white_navy"),
    ).toBe("103");
  });

  it("does not size-only fallback when hasColors (avoids Navy≈True Royal)", () => {
    // Unknown color — must not pick first M variant
    expect(
      matchShopifyVariantBySizeColor(
        baseballCatalog,
        "M",
        "Does Not Exist",
        true,
        "does_not_exist",
      ),
    ).toBeNull();
  });

  it("does not treat an empty size as a match (no silent Small / PDP default)", () => {
    expect(
      matchShopifyVariantBySizeColor(baseballCatalog, "", "White/Navy", true, "white_navy"),
    ).toBeNull();
    expect(
      matchShopifyVariantBySizeColor(baseballCatalog, "", "", true, "white_navy"),
    ).toBeNull();
    expect(matchShopifyVariantBySizeColor(baseballCatalog, "", "", false)).toBeNull();
  });

  it("allows size-only fallback when product has no color axis", () => {
    const sizeOnly = [
      { id: 1, title: "S", option1: "S", option2: null },
      { id: 2, title: "M", option1: "M", option2: null },
    ];
    expect(matchShopifyVariantBySizeColor(sizeOnly, "M", "", false)).toBe("2");
  });

  it("matches title-only catalog with Color / Size order", () => {
    const titleOnly = [
      { id: 10, title: "White/ Navy / M" },
      { id: 11, title: "White/ True Royal / M" },
    ];
    expect(
      matchShopifyVariantBySizeColor(titleOnly, "M", "White/Navy", true, "white_navy"),
    ).toBe("10");
    expect(
      matchShopifyVariantBySizeColor(
        titleOnly,
        "M",
        "White/ True Royal",
        true,
        "white_true_royal",
      ),
    ).toBe("11");
  });
});
