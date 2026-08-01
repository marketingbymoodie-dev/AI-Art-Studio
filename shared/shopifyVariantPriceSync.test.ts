import { describe, expect, it } from "vitest";
import { buildPrintifyToShopifyVariantIdMap } from "./shopifyVariantPriceSync";

describe("buildPrintifyToShopifyVariantIdMap", () => {
  it("maps printify ids via size:color name keys on shopifyVariantIds", () => {
    const map = buildPrintifyToShopifyVariantIdMap({
      variantMap: { "s:heather-grey": { printifyVariantId: 111 } },
      shopifyVariantIds: { "S:Heather Grey": 9001 },
      sizes: [{ id: "s", name: "S" }],
      frameColors: [{ id: "heather-grey", name: "Heather Grey" }],
      shopifyVariants: [],
    });
    expect(map["111"]).toBe(9001);
  });

  it("fills gaps via Shopify title when slash color spacing differs", () => {
    const map = buildPrintifyToShopifyVariantIdMap({
      variantMap: {
        "s:black-red": { printifyVariantId: 4011 },
        "s:white-black": { printifyVariantId: 4012 },
      },
      shopifyVariantIds: {
        // Only one mapped via stored ids — other must come from live titles
        "S:BLACK/ RED": 5001,
      },
      sizes: [{ id: "s", name: "S" }],
      frameColors: [
        { id: "black-red", name: "BLACK/ RED" },
        { id: "white-black", name: "WHITE/ BLACK" },
      ],
      shopifyVariants: [
        { id: 5001, title: "S / BLACK/ RED", option1: "S", option2: "BLACK/ RED" },
        // Shopify collapsed slash spacing vs Printify frame color
        { id: 5002, title: "S / WHITE/BLACK", option1: "S", option2: "WHITE/BLACK" },
      ],
    });
    expect(map["4011"]).toBe(5001);
    expect(map["4012"]).toBe(5002);
  });

  it("still maps remaining ids when a partial map already exists", () => {
    const map = buildPrintifyToShopifyVariantIdMap({
      variantMap: {
        "s:a": { printifyVariantId: 1 },
        "s:b": { printifyVariantId: 2 },
      },
      shopifyVariantIds: { "S:Ash": 10 },
      sizes: [{ id: "s", name: "S" }],
      frameColors: [
        { id: "a", name: "Ash" },
        { id: "b", name: "Black" },
      ],
      shopifyVariants: [
        { id: 10, title: "S / Ash", option1: "S", option2: "Ash" },
        { id: 20, title: "S / Black", option1: "S", option2: "Black" },
      ],
    });
    expect(map["1"]).toBe(10);
    expect(map["2"]).toBe(20);
  });

  it("maps Solid-prefixed Printify colors to Shopify titles without Solid", () => {
    const map = buildPrintifyToShopifyVariantIdMap({
      variantMap: { "s:solid-black": { printifyVariantId: 77 } },
      shopifyVariantIds: {},
      sizes: [{ id: "s", name: "S" }],
      frameColors: [{ id: "solid-black", name: "Solid Black" }],
      shopifyVariants: [
        { id: 7001, title: "S / Black", option1: "S", option2: "Black" },
      ],
    });
    expect(map["77"]).toBe(7001);
  });
});
