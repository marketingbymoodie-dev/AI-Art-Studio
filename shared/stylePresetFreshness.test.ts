import { describe, expect, it } from "vitest";
import { shouldApplyParentStylePresets } from "./stylePresetFreshness";

describe("shouldApplyParentStylePresets", () => {
  it("accepts first paint before the iframe owns a fetch", () => {
    expect(
      shouldApplyParentStylePresets({
        owned: false,
        incomingProductTypeId: "13",
        currentProductTypeId: "13",
      }),
    ).toBe(true);
  });

  it("ignores parent dumps after the iframe owns a fetch", () => {
    expect(
      shouldApplyParentStylePresets({
        owned: true,
        incomingProductTypeId: "13",
        currentProductTypeId: "13",
      }),
    ).toBe(false);
  });

  it("accepts a product-type change even when owned", () => {
    expect(
      shouldApplyParentStylePresets({
        owned: true,
        incomingProductTypeId: "40",
        currentProductTypeId: "13",
      }),
    ).toBe(true);
  });
});
