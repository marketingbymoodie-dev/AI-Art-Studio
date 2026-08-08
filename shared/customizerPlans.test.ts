import { describe, expect, it } from "vitest";
import {
  OVERAGE_PRICE_SCHEDULE,
  OVERAGE_PRICE_USD,
  PAID_PLAN_DEFINITIONS,
  getPlanOverageCappedAmountUsd,
  overageCostForUnitsUsd,
  resolveOveragePriceUsd,
  type OveragePriceTier,
} from "./customizerPlans";

/** Two-tier fixture — not live; proves volume walks the schedule. */
const TWO_TIER: readonly OveragePriceTier[] = [
  { upToInclusive: 2, priceUsd: 0.1 },
  { upToInclusive: null, priceUsd: 0.06 },
];

describe("resolveOveragePriceUsd", () => {
  it("returns the headline flat rate when volume is omitted", () => {
    expect(resolveOveragePriceUsd()).toBe(OVERAGE_PRICE_USD);
    expect(resolveOveragePriceUsd()).toBe(OVERAGE_PRICE_SCHEDULE[0]!.priceUsd);
  });

  it("keeps today's flat schedule for any volume", () => {
    expect(resolveOveragePriceUsd(1)).toBe(0.08);
    expect(resolveOveragePriceUsd(999)).toBe(0.08);
  });

  it("selects tiers by 1-based overage volume on a two-tier schedule", () => {
    expect(resolveOveragePriceUsd(1, TWO_TIER)).toBe(0.1);
    expect(resolveOveragePriceUsd(2, TWO_TIER)).toBe(0.1);
    expect(resolveOveragePriceUsd(3, TWO_TIER)).toBe(0.06);
    expect(resolveOveragePriceUsd(100, TWO_TIER)).toBe(0.06);
  });
});

describe("overageCostForUnitsUsd / cappedAmount", () => {
  it("sums flat schedule as units × headline rate", () => {
    expect(overageCostForUnitsUsd(200)).toBe(16);
    expect(getPlanOverageCappedAmountUsd("starter")).toBe(16);
    expect(getPlanOverageCappedAmountUsd("pro_plus")).toBe(80);
  });

  it("sums a two-tier schedule correctly", () => {
    // 2 × $0.10 + 3 × $0.06 = $0.38
    expect(overageCostForUnitsUsd(5, TWO_TIER)).toBe(0.38);
  });
});

describe("PAID_PLAN_DEFINITIONS SSOT", () => {
  it("exposes four paid plans with consistent fields", () => {
    expect(PAID_PLAN_DEFINITIONS.map((p) => p.planName)).toEqual([
      "starter",
      "dabbler",
      "pro",
      "pro_plus",
    ]);
    const starter = PAID_PLAN_DEFINITIONS[0]!;
    expect(starter.priceUsd).toBe(29);
    expect(starter.generationQuota).toBe(250);
    expect(starter.pageLimit).toBe(2);
    expect(starter.overageCap).toBe(200);
  });
});
