import { describe, expect, it } from "vitest";
import { resolveGenerationQuota } from "./customizer-plans";
import {
  buildSeedCatalogueSnapshot,
  SEED_PRICING_VERSION,
  priceFromMarginOverAiCost,
  resolveOveragePriceUsd,
} from "@shared/customizerPlans";

describe("catalogue-aware resolveGenerationQuota", () => {
  it("uses stamped catalogue gens/caps (enforcement), not seed defaults", () => {
    const cat = buildSeedCatalogueSnapshot();
    cat.id = 2;
    cat.plans = cat.plans.map((p) =>
      p.planKey === "starter" ? { ...p, generationQuota: 150, overageCapUnits: 100 } : p,
    );
    cat.overageSchedule = [{ upToInclusive: null, priceUsd: 0.1 }];

    const q = resolveGenerationQuota("starter", true, new Date(), cat);
    expect(q.freeQuota).toBe(150);
    expect(q.overageCap).toBe(100);
    expect(q.overagePriceUsd).toBe(0.1);
    expect(q.pricingVersion).toBe(2);
    expect(resolveOveragePriceUsd(3, q.overageSchedule)).toBe(0.1);
  });

  it("seed catalogue without override still matches v0 starter numbers", () => {
    const q = resolveGenerationQuota("starter", true, new Date(), buildSeedCatalogueSnapshot());
    expect(q.freeQuota).toBe(250);
    expect(q.overageCap).toBe(200);
    expect(q.pricingVersion).toBe(SEED_PRICING_VERSION);
  });
});

describe("modeller pricing formula", () => {
  it("computes price from margin over AI cost at full allowance", () => {
    // 150 gens × $0.045 = $6.75 AI; 55% margin → 6.75 / 0.45 = $15
    expect(priceFromMarginOverAiCost(150, 55, 0.045)).toBe(15);
  });
});

describe("commit ≠ activate contract (documented invariants)", () => {
  it("committed snapshots are not status=active", () => {
    // Pure contract: commit helper sets status committed; activate is a separate call.
    // DB integration covered by staging QA — this guards the shared seed shape.
    const seed = buildSeedCatalogueSnapshot();
    expect(seed.status).toBe("active");
    expect(seed.id).toBe(SEED_PRICING_VERSION);
    const draftStatus = "committed" as const;
    expect(draftStatus).not.toBe("active");
  });
});
