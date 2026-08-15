import { describe, expect, it } from "vitest";
import {
  comboSetFromPairs,
  countExistingVariantCombos,
  isAllowedVariantCombo,
  variantComboKey,
} from "./variantCombinations";

describe("variant combinations", () => {
  const pairs = [
    { sizeId: "XS", colorId: "solid_black" },
    { sizeId: "XS", colorId: "solid_white" },
    { sizeId: "4XL", colorId: "solid_black" },
    { sizeId: "S", colorId: "solid_black" },
    { sizeId: "S", colorId: "solid_white" },
    { sizeId: "S", colorId: "solid_indigo" },
  ];
  const set = comboSetFromPairs(pairs);

  it("normalizes size ids in keys", () => {
    expect(variantComboKey("4XL", "solid_black")).toBe(variantComboKey("4xl", "solid_black"));
  });

  it("rejects colours Printify does not sell in that size", () => {
    expect(isAllowedVariantCombo("XS", "solid_indigo", set)).toBe(false);
    expect(isAllowedVariantCombo("XS", "solid_black", set)).toBe(true);
    expect(isAllowedVariantCombo("4XL", "solid_white", set)).toBe(false);
  });

  it("counts only existing combos among the current picks", () => {
    expect(
      countExistingVariantCombos(["XS", "S", "4XL"], ["solid_black", "solid_white", "solid_indigo"], set),
    ).toBe(6);
    expect(countExistingVariantCombos(["XS"], ["solid_black", "solid_white", "solid_indigo"], set)).toBe(2);
  });

  it("falls back to cartesian when no combo list is available", () => {
    expect(countExistingVariantCombos(["XS", "S"], ["black", "white"], new Set())).toBe(4);
  });
});
