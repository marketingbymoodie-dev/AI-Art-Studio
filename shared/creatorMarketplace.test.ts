import { describe, expect, it } from "vitest";
import {
  clampFreeGensPerCustomer,
  clampMonthlyGenerationAllowance,
  normalizeCreatorUsername,
} from "./creatorMarketplace";

describe("normalizeCreatorUsername", () => {
  it("normalizes and accepts valid handles", () => {
    expect(normalizeCreatorUsername("MaxPets")).toBe("maxpets");
    expect(normalizeCreatorUsername("skate-king")).toBe("skate-king");
  });

  it("rejects reserved and invalid names", () => {
    expect(normalizeCreatorUsername("www")).toBeNull();
    expect(normalizeCreatorUsername("a")).toBeNull();
    expect(normalizeCreatorUsername("admin")).toBeNull();
    expect(normalizeCreatorUsername("")).toBeNull();
    // Leading/trailing hyphens are stripped → valid "bad"
    expect(normalizeCreatorUsername("-bad-")).toBe("bad");
  });
});

describe("quota clamps", () => {
  it("clamps free gens 0–10", () => {
    expect(clampFreeGensPerCustomer(2)).toBe(2);
    expect(clampFreeGensPerCustomer(99)).toBe(10);
    expect(clampFreeGensPerCustomer(-1)).toBe(0);
  });

  it("clamps monthly allowance", () => {
    expect(clampMonthlyGenerationAllowance(250)).toBe(250);
    expect(clampMonthlyGenerationAllowance(-5)).toBe(0);
  });
});
