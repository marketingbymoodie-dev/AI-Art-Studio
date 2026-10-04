import { describe, expect, it } from "vitest";
import {
  catalogHasPrintSides,
  isPrintSidesValue,
  printSidesEnabledForProductType,
  printSidesOfValue,
  printSidesOfVariant,
  printSidesTierCounts,
  productTypeHasBothSideCosts,
  sizeColorOptionValues,
  printSidesTwinVariant,
  splitShopifyVariantIdsBySides,
  variantServesPrintSides,
} from "./printSides";
import { filterCatalogByPrintSides, matchShopifyVariantBySizeColor, matchShopifyVariantBySizeTitle } from "./shopifyVariantMatch";
import {
  buildPrintifyToShopifyVariantIdMap,
  resolveStorefrontHeadlinePrice,
} from "./shopifyVariantPriceSync";

const sidesCatalog = [
  { id: "1", title: "S / Black / Front", option1: "S", option2: "Black", option3: "Front", price: "20.00" },
  { id: "2", title: "M / Black / Front", option1: "M", option2: "Black", option3: "Front", price: "22.00" },
  { id: "11", title: "S / Black / Front + Back", option1: "S", option2: "Black", option3: "Front + Back", price: "26.95" },
  { id: "12", title: "M / Black / Front + Back", option1: "M", option2: "Black", option3: "Front + Back", price: "28.95" },
];
const legacyCatalog = [
  { id: "1", title: "S / Black", option1: "S", option2: "Black", price: "20.00" },
  { id: "2", title: "M / Black", option1: "M", option2: "Black", price: "22.00" },
];

describe("print sides values", () => {
  it("recognises Front and Front + Back spellings, nothing else", () => {
    expect(printSidesOfValue("Front")).toBe("front");
    expect(printSidesOfValue("front + back")).toBe("both");
    expect(printSidesOfValue("Front+Back")).toBe("both");
    expect(printSidesOfValue("Front & Back")).toBe("both");
    expect(printSidesOfValue("Black")).toBeNull();
    expect(printSidesOfValue("")).toBeNull();
    expect(isPrintSidesValue("S")).toBe(false);
  });

  it("reads sides from option3, selectedOptions, or the title", () => {
    expect(printSidesOfVariant(sidesCatalog[2])).toBe("both");
    expect(printSidesOfVariant({ title: "S / Black / Front + Back" })).toBe("both");
    expect(
      printSidesOfVariant({ selectedOptions: [{ name: "Print sides", value: "Front" }] }),
    ).toBe("front");
    // size-only product: sides sit in option2
    expect(printSidesOfVariant({ option1: "11oz", option2: "Front + Back" })).toBe("both");
    expect(printSidesOfVariant(legacyCatalog[0])).toBeNull();
  });

  it("treats legacy variants as Front-only", () => {
    expect(variantServesPrintSides(legacyCatalog[0], "front")).toBe(true);
    expect(variantServesPrintSides(legacyCatalog[0], "both")).toBe(false);
    expect(catalogHasPrintSides(legacyCatalog)).toBe(false);
    expect(catalogHasPrintSides(sidesCatalog)).toBe(true);
  });

  it("strips sides from size/colour option values", () => {
    expect(sizeColorOptionValues(sidesCatalog[2])).toEqual(["S", "Black"]);
    expect(sizeColorOptionValues({ option1: "11oz", option2: "Front" })).toEqual(["11oz"]);
  });
});

describe("splitShopifyVariantIdsBySides", () => {
  it("keys both tiers size:color, legacy shape", () => {
    expect(splitShopifyVariantIdsBySides(sidesCatalog)).toEqual({
      front: { "S:Black": 1, "M:Black": 2 },
      both: { "S:Black": 11, "M:Black": 12 },
    });
  });

  it("puts every legacy variant in front", () => {
    expect(splitShopifyVariantIdsBySides(legacyCatalog)).toEqual({
      front: { "S:Black": 1, "M:Black": 2 },
      both: {},
    });
  });

  it("uses :default for size-only products", () => {
    const r = splitShopifyVariantIdsBySides([
      { id: "gid://shopify/ProductVariant/5", option1: "11oz", option2: "Front" },
      { id: "gid://shopify/ProductVariant/6", option1: "11oz", option2: "Front + Back" },
    ]);
    expect(r).toEqual({ front: { "11oz:default": 5 }, both: { "11oz:default": 6 } });
  });
});

describe("printSidesTierCounts", () => {
  it("counts each tier; legacy counts as front", () => {
    expect(printSidesTierCounts(sidesCatalog)).toEqual({ front: 2, both: 2 });
    expect(printSidesTierCounts(legacyCatalog)).toEqual({ front: 2, both: 0 });
    expect(printSidesTierCounts(null)).toEqual({ front: 0, both: 0 });
  });
});

describe("printSidesEnabledForProductType (derived default + override)", () => {
  const bothCosts = JSON.stringify({ front: { "100": 1000 }, both: { "100": 1500 } });
  const frontOnlyCosts = JSON.stringify({ front: { "100": 1000 }, both: {} });

  it("is on where front+back costs exist", () => {
    expect(productTypeHasBothSideCosts({ printifyCosts: bothCosts })).toBe(true);
    expect(printSidesEnabledForProductType({ printifyCosts: bothCosts })).toBe(true);
  });

  it("is off without both-side costs, even if forced true", () => {
    expect(printSidesEnabledForProductType({ printifyCosts: frontOnlyCosts })).toBe(false);
    expect(printSidesEnabledForProductType({ printifyCosts: frontOnlyCosts, printSidesEnabled: true })).toBe(false);
  });

  it("a saved both-tier retail map counts as costs", () => {
    expect(printSidesEnabledForProductType({ variantPricesBoth: { "S:Black": "29.95" } })).toBe(true);
  });

  it("operator override false wins", () => {
    expect(printSidesEnabledForProductType({ printifyCosts: bothCosts, printSidesEnabled: false })).toBe(false);
  });

  it("never applies to AOP", () => {
    expect(printSidesEnabledForProductType({ printifyCosts: bothCosts, isAllOverPrint: true })).toBe(false);
  });
});

describe("variant matching prefers Front", () => {
  it("filterCatalogByPrintSides leaves legacy catalogs untouched", () => {
    expect(filterCatalogByPrintSides(legacyCatalog)).toBe(legacyCatalog);
    expect(filterCatalogByPrintSides(sidesCatalog).map((v) => v.id)).toEqual(["1", "2"]);
    expect(filterCatalogByPrintSides(sidesCatalog, "both").map((v) => v.id)).toEqual(["11", "12"]);
  });

  it("size+colour match returns the Front variant by default", () => {
    expect(matchShopifyVariantBySizeColor(sidesCatalog, "M", "Black", true)).toBe("2");
    expect(matchShopifyVariantBySizeColor(sidesCatalog, "M", "Black", true, undefined, "both")).toBe("12");
    expect(matchShopifyVariantBySizeColor(legacyCatalog, "M", "Black", true)).toBe("2");
  });

  it("title fallback also returns Front", () => {
    expect(matchShopifyVariantBySizeTitle(sidesCatalog, "S", "Black")).toBe("1");
  });
});

describe("price-sync mapper is tier-aware", () => {
  const productType = {
    variantMap: { "s:black": { printifyVariantId: 100 }, "m:black": { printifyVariantId: 101 } },
    sizes: [
      { id: "s", name: "S" },
      { id: "m", name: "M" },
    ],
    frameColors: [{ id: "black", name: "Black" }],
  };

  it("maps Printify ids to Front variants only", () => {
    const map = buildPrintifyToShopifyVariantIdMap({
      ...productType,
      shopifyVariantIds: { "S:Black": 1, "M:Black": 2 },
      shopifyVariants: sidesCatalog,
    });
    expect(map).toEqual({ "100": 1, "101": 2 });
  });

  it("maps to Front + Back variants when asked with the both map", () => {
    const map = buildPrintifyToShopifyVariantIdMap({
      ...productType,
      shopifyVariantIds: { "S:Black": 11, "M:Black": 12 },
      shopifyVariants: sidesCatalog,
      sides: "both",
    });
    expect(map).toEqual({ "100": 11, "101": 12 });
  });
});

describe("storefront headline price", () => {
  it("does not show 'from' just because Front + Back variants cost more", () => {
    const oneSize = [sidesCatalog[0], sidesCatalog[2]];
    const r = resolveStorefrontHeadlinePrice({ variants: oneSize, sizeSelected: false });
    expect(r).toEqual({ amount: 20, showFrom: false });
  });

  it("still shows 'from' across Front sizes", () => {
    const r = resolveStorefrontHeadlinePrice({ variants: sidesCatalog, sizeSelected: false });
    expect(r).toEqual({ amount: 20, showFrom: true });
  });
});

describe("printSidesTwinVariant (ATC Front -> Front + Back)", () => {
  it("returns the Front + Back twin with the same size and colour", () => {
    expect(printSidesTwinVariant(sidesCatalog, sidesCatalog[1], "both")?.id).toBe("12");
    expect(printSidesTwinVariant(sidesCatalog, sidesCatalog[3], "front")?.id).toBe("2");
  });

  it("is null for a legacy catalog with no Print sides option", () => {
    const legacy = [
      { id: "1", title: "S / Black", option1: "S", option2: "Black" },
      { id: "2", title: "M / Black", option1: "M", option2: "Black" },
    ];
    expect(printSidesTwinVariant(legacy, legacy[0], "both")).toBeNull();
  });

  it("is null when the twin is missing (never another size)", () => {
    const partial = sidesCatalog.filter((v) => v.id !== "12");
    expect(printSidesTwinVariant(partial, sidesCatalog[1], "both")).toBeNull();
  });

  it("works for size-only products where Print sides is option2", () => {
    const sizeOnly = [
      { id: "1", option1: "11oz", option2: "Front" },
      { id: "2", option1: "15oz", option2: "Front" },
      { id: "3", option1: "15oz", option2: "Front + Back" },
    ];
    expect(printSidesTwinVariant(sizeOnly, sizeOnly[1], "both")?.id).toBe("3");
    expect(printSidesTwinVariant(sizeOnly, sizeOnly[0], "both")).toBeNull();
  });
});
