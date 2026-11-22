import { describe, expect, it } from "vitest";
import { classifyShippingCoverageGaps } from "./shipping-desired-state";

describe("classifyShippingCoverageGaps", () => {
  const covered = new Set(["s:black", "m:black"]);

  it("ignores blanks the shipping table covers", () => {
    const gaps = classifyShippingCoverageGaps(["s:black", "m:black"], covered, {});
    expect(gaps).toEqual({ unavailable: [], missingInStock: [] });
  });

  it("buckets uncovered blanks by Printify availability", () => {
    const gaps = classifyShippingCoverageGaps(
      ["s:black", "l:navy", "xl:navy", "2xl:smoke", "3xl:smoke"],
      covered,
      { "l:navy": "out_of_stock", "xl:navy": "removed", "2xl:smoke": "in_stock" },
    );
    expect(gaps.unavailable).toEqual(["l:navy", "xl:navy"]);
    expect(gaps.missingInStock).toEqual(["2xl:smoke", "3xl:smoke"]);
  });

  it("is keyed on the blank, so duplicate tiers of one blank classify together", () => {
    const gaps = classifyShippingCoverageGaps(["l:navy", "l:navy"], covered, { "l:navy": "out_of_stock" });
    expect(gaps.unavailable).toEqual(["l:navy", "l:navy"]);
    expect(gaps.missingInStock).toEqual([]);
  });
});
