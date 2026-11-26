import { describe, expect, it } from "vitest";
import { shadowDeleteDecision, type LiveShadowProduct } from "./shadow-delete-guard";

function product(overrides: Partial<LiveShadowProduct> = {}): LiveShadowProduct {
  return {
    id: "1",
    title: "Custom Design",
    tags: ["appai-shadow"],
    productType: "",
    hasDesignCandidate: false,
    ...overrides,
  };
}

describe("shadowDeleteDecision", () => {
  it("deletes a tagged shadow with no catalogue metafield", () => {
    expect(shadowDeleteDecision(product(), { requireProductType: false })).toBe("delete");
  });

  it("requires product_type appai-shadow only when that cleanup created one", () => {
    expect(shadowDeleteDecision(product(), { requireProductType: true })).toBe("skip");
    expect(shadowDeleteDecision(product({ productType: "appai-shadow" }), { requireProductType: true })).toBe("delete");
  });

  it("refuses a catalogue listing even if it is tagged as a shadow", () => {
    expect(shadowDeleteDecision(
      product({ title: "Love What You've Done With The Place", tags: ["appai-shadow"], hasDesignCandidate: true }),
      { requireProductType: false },
    )).toBe("skip");
  });

  it("treats a missing product as already gone", () => {
    expect(shadowDeleteDecision(null, { requireProductType: false })).toBe("missing");
  });
});
