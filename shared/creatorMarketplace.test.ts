import { describe, expect, it } from "vitest";
import {
  clampFreeGensPerCustomer,
  clampMonthlyGenerationAllowance,
  extractSubdomainFromHost,
  extractUsernameFromPath,
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

describe("host / path resolution", () => {
  it("parses creator subdomains", () => {
    expect(extractSubdomainFromHost("max.aiartstudio.app")).toBe("max");
    expect(extractSubdomainFromHost("aiartstudio.app")).toBeNull();
    expect(extractSubdomainFromHost("ai-art-studio-staging.up.railway.app")).toBeNull();
  });

  it("parses /c/:username paths", () => {
    expect(extractUsernameFromPath("/c/max")).toBe("max");
    expect(extractUsernameFromPath("/c/skate-king/products")).toBe("skate-king");
  });
});
