import { describe, expect, it } from "vitest";
import {
  clampFreeGensPerCustomer,
  clampMonthlyGenerationAllowance,
  computeCreatorOrderPnl,
  computeTransactionFeeCents,
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

describe("Phase 5 P&L math", () => {
  it("computes Shopify-style transaction fees", () => {
    // 2.9% of $100 + 30¢ = $2.90 + $0.30
    expect(computeTransactionFeeCents({ amountCents: 10000 })).toBe(320);
    expect(computeTransactionFeeCents({ amountCents: 0 })).toBe(0);
    expect(
      computeTransactionFeeCents({ amountCents: 10000, feePct: 0, feeFixedCents: 0 }),
    ).toBe(0);
  });

  it("matches the plan example ($100 gross − $50 COGS − $3 txn − $4.50 AI)", () => {
    const fee = computeTransactionFeeCents({
      amountCents: 10000,
      feePct: 2.7,
      feeFixedCents: 30,
    }); // 270 + 30 = 300
    expect(fee).toBe(300);
    const pnl = computeCreatorOrderPnl({
      grossCents: 10000,
      discountCents: 0,
      fulfilmentCostCents: 5000,
      transactionFeeCents: fee,
      aiGenCostCents: 450,
      shareBasis: "net_contribution",
      revenueShareCreatorPct: 100,
      revenueShareAasPct: 0,
    });
    expect(pnl.productProfitCents).toBe(4700);
    expect(pnl.netContributionCents).toBe(4250);
    expect(pnl.creatorShareCents).toBe(4250);
    expect(pnl.aasShareCents).toBe(0);
  });

  it("applies refunds and share basis product_profit", () => {
    const pnl = computeCreatorOrderPnl({
      grossCents: 10000,
      discountCents: 500,
      fulfilmentCostCents: 4000,
      transactionFeeCents: 300,
      aiGenCostCents: 200,
      refundCents: 2000,
      shareBasis: "product_profit",
      revenueShareCreatorPct: 80,
      revenueShareAasPct: 20,
    });
    // 10000 - 500 - 4000 - 300 - 2000 = 3200 product profit
    expect(pnl.productProfitCents).toBe(3200);
    expect(pnl.netContributionCents).toBe(3000);
    expect(pnl.creatorShareCents).toBe(2560);
    expect(pnl.aasShareCents).toBe(640);
  });
});
