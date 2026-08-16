import { describe, expect, it } from "vitest";
import {
  coerceVariantPricesBothMap,
  expandVariantPricesBothMap,
  minBothRetailDollarsFromMap,
  resolveBothRetailDollarsFromMap,
  resolveDesignerVariantPricesBoth,
  bothRetailAboveFront,
} from "./variantPricesBoth";

describe("coerceVariantPricesBothMap", () => {
  it("parses JSON strings and ignores invalid payloads", () => {
    expect(coerceVariantPricesBothMap('{"S:Black":"29.95"}')).toEqual({
      "S:Black": "29.95",
    });
    expect(coerceVariantPricesBothMap("{")).toEqual({});
    expect(coerceVariantPricesBothMap(null)).toEqual({});
  });
});

describe("expandVariantPricesBothMap", () => {
  const ctx = {
    variantMap: {
      "s-xl:ash": { printifyVariantId: 4011 },
    },
    shopifyVariantIds: {
      "s-xl:ash": 99887766,
    },
    sizes: [{ id: "s-xl", name: "XL" }],
    frameColors: [{ id: "ash", name: "Ash" }],
  };

  it("expands printify: blank keys to Shopify id and size:color aliases", () => {
    const expanded = expandVariantPricesBothMap(
      { "printify:4011": "34.95" },
      ctx,
    );
    expect(expanded["printify:4011"]).toBe("34.95");
    expect(expanded["99887766"]).toBe("34.95");
    expect(expanded["XL:Ash"]).toBe("34.95");
    expect(expanded["XL / Ash"]).toBe("34.95");
    expect(expanded["s-xl:ash"]).toBe("34.95");
  });

  it("lets storefront resolve by Shopify variant id after expand", () => {
    const expanded = expandVariantPricesBothMap(
      { "printify:4011": "34.95" },
      ctx,
    );
    expect(
      resolveBothRetailDollarsFromMap(expanded, {
        sizeName: "XL",
        colorName: "Ash",
        shopifyVariantId: "99887766",
      }),
    ).toBe(34.95);
  });
});

describe("resolveBothRetailDollarsFromMap", () => {
  it("returns null for empty map", () => {
    expect(resolveBothRetailDollarsFromMap({}, { shopifyVariantId: "1" })).toBeNull();
  });

  it("matches size / color title keys", () => {
    expect(
      resolveBothRetailDollarsFromMap(
        { "XL / Ash": "34.95" },
        { sizeName: "XL", colorName: "Ash" },
      ),
    ).toBe(34.95);
  });

  it("matches Shopify GID variant ids", () => {
    expect(
      resolveBothRetailDollarsFromMap(
        { "99887766": "29.95" },
        { shopifyVariantId: "gid://shopify/ProductVariant/99887766" },
      ),
    ).toBe(29.95);
  });

  it("does not treat S as a substring of XS", () => {
    expect(
      resolveBothRetailDollarsFromMap(
        { "XS:Black": "24.95", "2XL:Black": "26.95" },
        { sizeName: "S", colorName: "Black" },
      ),
    ).toBeNull();
  });

  it("returns the cheapest both-tier price from the map", () => {
    expect(
      minBothRetailDollarsFromMap({
        "S:Black": "32.95",
        "3XL:Black": "40.95",
      }),
    ).toBe(32.95);
  });

  it("matches Solid-prefixed colours to the storefront colour name", () => {
    expect(
      resolveBothRetailDollarsFromMap(
        { "S:Solid Navy": "54.95" },
        { sizeName: "S", colorName: "Navy" },
      ),
    ).toBe(54.95);
  });

  it("resolves Dark Heather via printify slug aliases", () => {
    expect(
      resolveBothRetailDollarsFromMap(
        { "S:dark_heather": "54.95" },
        { sizeName: "S", colorName: "Dark Heather" },
      ),
    ).toBe(54.95);
  });

  it("uses the only both-tier price when keys do not match", () => {
    expect(
      resolveBothRetailDollarsFromMap(
        { "printify:4011": "29.95", "printify:4012": "29.95" },
        { sizeName: "S", colorName: "Black", shopifyVariantId: "123" },
      ),
    ).toBe(29.95);
  });
});

describe("resolveDesignerVariantPricesBoth", () => {
  const ctx = {
    variantMap: {
      "s:dark_heather": { printifyVariantId: 8801 },
    },
    shopifyVariantIds: {
      "s:dark_heather": 112233,
    },
    sizes: [{ id: "s", name: "S" }],
    frameColors: [{ id: "dark_heather", name: "Dark Heather" }],
  };

  it("synthesizes both-tier retail from cached both-side costs when the saved map is empty", () => {
    const map = resolveDesignerVariantPricesBoth(
      {},
      JSON.stringify({
        front: { "8801": 2000 },
        both: { "8801": 3500 },
      }),
      70,
      ctx,
    );
    expect(map["S:Dark Heather"]).toBe("59.95");
    expect(map["112233"]).toBe("59.95");
  });

  it("keeps a merchant-saved both-tier map", () => {
    const map = resolveDesignerVariantPricesBoth(
      { "printify:8801": "61.95" },
      JSON.stringify({
        front: { "8801": 2000 },
        both: { "8801": 3500 },
      }),
      70,
      ctx,
    );
    expect(map["S:Dark Heather"]).toBe("61.95");
  });
});

describe("bothRetailAboveFront", () => {
  it("keeps a both-tier price that is already above front", () => {
    expect(bothRetailAboveFront(54.95, 48.95)).toBe(54.95);
  });

  it("steps up when both-tier is missing a surcharge vs live front", () => {
    expect(bothRetailAboveFront(47.95, 48.95)).toBe(49.95);
  });
});
