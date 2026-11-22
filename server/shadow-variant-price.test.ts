import { describe, expect, it } from "vitest";
import { pickShadowShopPrice } from "./shadow-variant-price";

describe("pickShadowShopPrice", () => {
  it("writes the catalogue shop-currency price and ignores any client amount", () => {
    expect(pickShadowShopPrice("29.95", null, false)).toEqual({
      front: "29.95",
      written: "29.95",
      source: "catalogue-variant",
    });
  });

  it("does not treat a client-shaped both amount as the price unless applyBothTier is set by the server", () => {
    expect(pickShadowShopPrice("29.95", "45.00", false)).toEqual({
      front: "29.95",
      written: "29.95",
      source: "catalogue-variant",
    });
  });

  it("uses the server both-tier shop price when the selection is both and the variant is still front", () => {
    expect(pickShadowShopPrice("29.95", "34.95", true)).toEqual({
      front: "29.95",
      written: "34.95",
      source: "catalogue-variant",
    });
  });

  it("stays on the catalogue price when the both-tier lookup is empty", () => {
    expect(pickShadowShopPrice("18.95", null, true)).toEqual({
      front: "18.95",
      written: "18.95",
      source: "catalogue-variant",
    });
  });

  it("adds a shop-currency surcharge only when one is passed", () => {
    expect(pickShadowShopPrice("29.95", null, false, 100)).toEqual({
      front: "29.95",
      written: "30.95",
      source: "catalogue-variant",
    });
    expect(pickShadowShopPrice("29.95", "34.95", true, 100).written).toBe("35.95");
    expect(pickShadowShopPrice("29.95", null, false, 0).written).toBe("29.95");
  });

  it("rejects a zero catalogue price", () => {
    expect(pickShadowShopPrice("0", "34.95", true)).toEqual({
      front: null,
      written: "34.95",
      source: "catalogue-variant",
    });
    expect(pickShadowShopPrice("0", null, false)).toEqual({
      front: null,
      written: null,
      source: "catalogue-variant",
    });
  });
});
