import { describe, expect, it } from "vitest";
import { resolveShadowSellPrice } from "./shadow-variant-price";

describe("resolveShadowSellPrice", () => {
  it("writes live front when there is no both-tier override", () => {
    expect(resolveShadowSellPrice("18.95", null)).toEqual({
      front: "18.95",
      written: "18.95",
      source: "front",
    });
  });

  it("applies both-tier after the front read and does not wipe it back to front", () => {
    expect(resolveShadowSellPrice("18.95", "34.00")).toEqual({
      front: "18.95",
      written: "34.00",
      source: "both",
    });
  });

  it("falls back to both-tier when live front is missing", () => {
    expect(resolveShadowSellPrice(null, "33.95")).toEqual({
      front: null,
      written: "33.95",
      source: "both",
    });
  });

  it("ignores zero / blank override so a stale $27 can be rewritten to live front", () => {
    expect(resolveShadowSellPrice("18.95", "0")).toEqual({
      front: "18.95",
      written: "18.95",
      source: "front",
    });
  });
});
