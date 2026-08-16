import { describe, expect, it } from "vitest";
import {
  currentGenerationMonthKey,
  peekCreatorMonthlyAllowance,
} from "./creator-quota";
import {
  clampFreeGensPerCustomer,
  clampMonthlyGenerationAllowance,
} from "@shared/creatorMarketplace";

describe("creator-quota helpers", () => {
  it("formats UTC month key", () => {
    expect(currentGenerationMonthKey(new Date("2026-08-12T01:00:00Z"))).toBe("2026-08");
  });

  it("clamps free gens and monthly allowance", () => {
    expect(clampFreeGensPerCustomer(2)).toBe(2);
    expect(clampFreeGensPerCustomer(99)).toBe(10);
    expect(clampFreeGensPerCustomer(-1)).toBe(0);
    expect(clampMonthlyGenerationAllowance(250)).toBe(250);
    expect(clampMonthlyGenerationAllowance(0)).toBe(0);
  });

  it("peeks monthly allowance with month roll", () => {
    const peek = peekCreatorMonthlyAllowance({
      id: "c1",
      monthlyGenerationAllowance: 10,
      generationMonth: "2020-01",
      monthlyGenerationsUsed: 10,
    } as any);
    return peek.then((r) => {
      expect(r.allowed).toBe(true);
      expect(r.used).toBe(0);
      expect(r.remaining).toBe(10);
    });
  });

  it("blocks when monthly exhausted in current month", async () => {
    const month = currentGenerationMonthKey();
    const r = await peekCreatorMonthlyAllowance({
      id: "c1",
      monthlyGenerationAllowance: 5,
      generationMonth: month,
      monthlyGenerationsUsed: 5,
    } as any);
    expect(r.allowed).toBe(false);
    expect(r.error).toBe("CREATOR_MONTHLY_EXHAUSTED");
  });
});
