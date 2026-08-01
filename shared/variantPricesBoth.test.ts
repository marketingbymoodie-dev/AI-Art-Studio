import { describe, expect, it } from "vitest";
import {
  expandVariantPricesBothMap,
  resolveBothRetailDollarsFromMap,
} from "./variantPricesBoth";

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
});
