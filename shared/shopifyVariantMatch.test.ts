import { describe, expect, it } from "vitest";
import {
  catalogFromShopifyVariantIds,
  comboIsMinted,
  filterFrameColorsToMintedShopify,
  filterFrameColorsToShopifyCatalog,
  matchShopifyVariantBySizeColor,
  matchShopifyVariantBySizeTitle,
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

  it("matches XL to X-Large and 2XL to XXL", () => {
    const catalog = [
      { id: 1, title: "Heather Grey / X-Large", option1: "Heather Grey", option2: "X-Large" },
      { id: 2, title: "Heather Grey / S", option1: "Heather Grey", option2: "S" },
      { id: 3, title: "Navy / XXL", option1: "Navy", option2: "XXL" },
    ];
    expect(
      matchShopifyVariantBySizeColor(catalog, "XL", "Heather Grey", true, "heather_grey"),
    ).toBe("1");
    expect(
      matchShopifyVariantBySizeColor(catalog, "2XL", "Navy", true, "navy"),
    ).toBe("3");
  });

  it("matches Heather Gray to Heather Grey", () => {
    const catalog = [
      { id: 1, title: "Heather Gray / XL", option1: "Heather Gray", option2: "XL" },
    ];
    expect(
      matchShopifyVariantBySizeColor(catalog, "XL", "Heather Grey", true, "heather_grey"),
    ).toBe("1");
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

describe("matchShopifyVariantBySizeTitle", () => {
  const teeCatalog = [
    { id: 27, title: "Navy / XL", option1: "Navy", option2: "XL", price: "27.00" },
    { id: 18, title: "Heather Grey / XL", option1: "Heather Grey", option2: "XL", price: "18.95" },
    { id: 9, title: "Heather Grey / S", option1: "Heather Grey", option2: "S", price: "18.95" },
  ];

  it("picks Heather Grey / XL, not the first XL row", () => {
    expect(
      matchShopifyVariantBySizeTitle(teeCatalog, "XL", "Heather Grey", "heather_grey"),
    ).toBe("18");
  });

  it("does not fall back to a different colour when the requested colour is absent", () => {
    expect(
      matchShopifyVariantBySizeTitle(teeCatalog, "XL", "Does Not Exist", "missing"),
    ).toBeNull();
  });
});

describe("filterFrameColorsToShopifyCatalog", () => {
  const catalog = [
    { id: 1, title: "Navy / M", option1: "M", option2: "Navy" },
    { id: 2, title: "Heather Grey / M", option1: "M", option2: "Heather Grey" },
  ];
  const frameColors = [
    { id: "navy", name: "Navy" },
    { id: "heather_grey", name: "Heather Grey" },
    { id: "military-green", name: "Military Green" },
    { id: "gold", name: "Solid Gold" },
  ];

  it("keeps only colours that exist on minted Shopify rows", () => {
    expect(filterFrameColorsToShopifyCatalog(frameColors, catalog).map((c) => c.id)).toEqual([
      "navy",
      "heather_grey",
    ]);
  });

  it("returns no colours when the Shopify catalog is empty — never the full Printify list", () => {
    expect(filterFrameColorsToShopifyCatalog(frameColors, [])).toEqual([]);
    expect(filterFrameColorsToShopifyCatalog(frameColors, null)).toEqual([]);
  });

  it("shopifyVariantIds path drops unpublished tail colours", () => {
    const ids = {
      "M:Navy": 1,
      "M:Heather Grey": 2,
      "L:Navy": 3,
    };
    expect(
      filterFrameColorsToMintedShopify(frameColors, { shopifyVariantIds: ids }).map((c) => c.id),
    ).toEqual(["navy", "heather_grey"]);
  });

  it("empty shopifyVariantIds offers nothing — not selectedColorIds / full Printify", () => {
    expect(filterFrameColorsToMintedShopify(frameColors, { shopifyVariantIds: {} })).toEqual([]);
    expect(filterFrameColorsToMintedShopify(frameColors, {})).toEqual([]);
  });
});

describe("comboIsMinted", () => {
  const ids = {
    "M:Solid Maroon": 1,
    "L:Solid Maroon": 2,
    "XL:Solid Maroon": 3,
    "XS:Solid Black": 4,
    "5XL:Solid Black": 5,
  };

  it("Maroon is minted at M but not XS", () => {
    const catalog = catalogFromShopifyVariantIds(ids);
    expect(comboIsMinted(catalog, "M", "Solid Maroon", "solid_maroon")).toBe(true);
    expect(comboIsMinted(catalog, "XS", "Solid Maroon", "solid_maroon")).toBe(false);
    expect(comboIsMinted(catalog, "5XL", "Solid Black", "solid_black")).toBe(true);
    expect(comboIsMinted(catalog, "5XL", "Solid Maroon", "solid_maroon")).toBe(false);
  });

  it("empty catalog is not minted", () => {
    expect(comboIsMinted([], "M", "Solid Maroon")).toBe(false);
    expect(comboIsMinted(null, "M", "Solid Maroon")).toBe(false);
  });
});
