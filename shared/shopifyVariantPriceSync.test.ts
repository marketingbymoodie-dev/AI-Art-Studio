import { describe, expect, it } from "vitest";
import {
  buildPrintifyToShopifyVariantIdMap,
  displayRetailPrice,
  hasPositiveRetailPrice,
  minPositiveRetailPrice,
  pickLowestPricedShopifyVariant,
  resolveStorefrontHeadlinePrice,
} from "./shopifyVariantPriceSync";

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

describe("pickLowestPricedShopifyVariant", () => {
  it("picks the cheapest size, not Shopify's first variant", () => {
    const cheapest = pickLowestPricedShopifyVariant([
      { id: 1, title: `104" x 88"`, price: "254.95" },
      { id: 2, title: `88" x 88"`, price: "198.95" },
      { id: 3, title: `68" x 88"`, price: "164.95" },
    ]);
    expect(cheapest?.id).toBe(3);
    expect(cheapest?.price).toBe("164.95");
  });

  it("skips zero or invalid prices", () => {
    const cheapest = pickLowestPricedShopifyVariant([
      { id: 1, title: "Large", price: "0.00" },
      { id: 2, title: "Small", price: "21.95" },
    ]);
    expect(cheapest?.id).toBe(2);
  });
});

describe("displayRetailPrice / hasPositiveRetailPrice", () => {
  it("never treats zero or blank as a display price", () => {
    expect(displayRetailPrice("0.00")).toBeNull();
    expect(displayRetailPrice("$0.00")).toBeNull();
    expect(displayRetailPrice("")).toBeNull();
    expect(displayRetailPrice(null)).toBeNull();
    expect(hasPositiveRetailPrice("0.00")).toBe(false);
  });

  it("formats a real retail amount", () => {
    expect(displayRetailPrice("29.95")).toBe("29.95");
    expect(displayRetailPrice("$18.9")).toBe("18.90");
    expect(hasPositiveRetailPrice("29.95")).toBe(true);
  });

  it("picks the cheapest positive wizard price", () => {
    expect(minPositiveRetailPrice({ a: "0.00", b: "32.95", c: "29.95" })).toBe(29.95);
    expect(minPositiveRetailPrice({ a: "0", b: "" })).toBeNull();
  });
});

describe("resolveStorefrontHeadlinePrice", () => {
  const comforter = [
    { id: 1, price: "271.95" },
    { id: 2, price: "229.95" },
    { id: 3, price: "201.95" },
  ];

  it("shows from the cheapest size when none is selected", () => {
    const headline = resolveStorefrontHeadlinePrice({
      variants: comforter,
      sizeSelected: false,
      matchedVariantId: "1",
    });
    expect(headline).toEqual({ amount: 201.95, showFrom: true });
  });

  it("shows the selected size price without from", () => {
    const headline = resolveStorefrontHeadlinePrice({
      variants: comforter,
      sizeSelected: true,
      matchedVariantId: "1",
    });
    expect(headline).toEqual({ amount: 271.95, showFrom: false });
  });

  it("shows the both-tier price when Print on Back is on", () => {
    const headline = resolveStorefrontHeadlinePrice({
      variants: [{ id: 1, price: "21.95" }],
      sizeSelected: true,
      matchedVariantId: "1",
      bothPrice: 32.95,
      hasBothRetailPrices: true,
      printPlacementUsesBoth: true,
    });
    expect(headline).toEqual({ amount: 32.95, showFrom: false });
  });

  it("estimates a front+back headline when Print on Back is on but no both map exists", () => {
    const headline = resolveStorefrontHeadlinePrice({
      variants: [{ id: 1, price: "48.95" }],
      sizeSelected: true,
      matchedVariantId: "1",
      bothPrice: null,
      hasBothRetailPrices: false,
      printPlacementUsesBoth: true,
    });
    expect(headline?.amount).toBeGreaterThan(48.95);
    expect(headline?.showFrom).toBe(false);
  });

  it("steps the headline up when both-tier is not above the live front price", () => {
    const headline = resolveStorefrontHeadlinePrice({
      variants: [{ id: 1, price: "48.95" }],
      sizeSelected: true,
      matchedVariantId: "1",
      bothPrice: 47.95,
      hasBothRetailPrices: true,
      printPlacementUsesBoth: true,
    });
    expect(headline).toEqual({ amount: 49.95, showFrom: false });
  });

  it("shows from the cheapest both-tier price before a size is picked", () => {
    const headline = resolveStorefrontHeadlinePrice({
      variants: [
        { id: 1, price: "21.95" },
        { id: 2, price: "29.95" },
      ],
      sizeSelected: false,
      bothPrice: 32.95,
      hasBothRetailPrices: true,
      printPlacementUsesBoth: true,
    });
    expect(headline).toEqual({ amount: 32.95, showFrom: true });
  });
});
