import { describe, expect, it } from "vitest";
import {
  INTERNAL_FUNNEL_RATES,
  cheapestFittingPlan,
  computePageMetrics,
  computeStoreProfit,
  rescalePageOrders,
  totalOrdersFromFunnel,
  visitorsFromOrders,
} from "./profitInsightsModel";
import { PAID_PLAN_DEFINITIONS } from "./customizerPlans";

const grants = {
  freeGensPerVisitor: 2,
  emailCredits: 1,
  shareCredits: 1,
  purchaseCredits: 3,
  emailEnabled: true,
  shareEnabled: true,
  purchaseEnabled: true,
};

describe("funnel two-way binding", () => {
  it("computes total orders from visitors × engagement × conversion", () => {
    expect(totalOrdersFromFunnel({ visitors: 667, engagementPct: 30, conversionPct: 5 })).toBe(10);
  });

  it("rescales page orders proportionally when funnel changes", () => {
    const pages = [
      { id: "a", orders: 2 },
      { id: "b", orders: 8 },
    ];
    const next = rescalePageOrders(pages, 20);
    expect(next[0]!.orders + next[1]!.orders).toBe(20);
    expect(next[0]!.orders).toBe(4);
    expect(next[1]!.orders).toBe(16);
  });

  it("re-derives visitors from page orders", () => {
    expect(visitorsFromOrders(10, 30, 5)).toBe(667);
  });
});

describe("consumed gens (worked example)", () => {
  it("pools per-page gens for a page with 2 orders", () => {
    // 667 visitors, 30% eng → 200 engaged; one page with all 10 orders share=1
    // but we use a single page with 2 orders and visitors back-solved.
    const funnel = { visitors: visitorsFromOrders(2, 30, 5), engagementPct: 30, conversionPct: 5 };
    const pages = [
      {
        id: "1",
        label: "Tee",
        cogsUsd: 10,
        orders: 2,
        unitsPerOrder: 1,
        crossSellPct: 0,
      },
    ];
    const metrics = computePageMetrics({
      pages,
      funnel,
      marginTargetPct: 65,
      grants,
    });
    const m = metrics[0]!;
    // engaged ≈ visitors×0.3; visitors = 2/(0.3*0.05) = 133.33 → 133
    const engaged = Math.round(funnel.visitors * 0.3);
    expect(m.engaged).toBe(engaged);
    const expected =
      engaged * Math.min(INTERNAL_FUNNEL_RATES.freeGensPer, 2) +
      engaged * (INTERNAL_FUNNEL_RATES.shareTakePct / 100) * 1 +
      2 * (INTERNAL_FUNNEL_RATES.purchaseRedeemPct / 100) * 3;
    expect(m.gens).toBeCloseTo(expected, 5);
    const store = computeStoreProfit(metrics, 65);
    expect(store.gensDemand).toBe(Math.round(expected));
    expect(store.totalOrders).toBe(2);
  });
});

describe("plan fit climbing", () => {
  it("picks cheapest plan that covers gens + pages (overage off)", () => {
    const plan = cheapestFittingPlan({
      gensDemand: 400,
      pagesNeeded: 3,
      previewOverage: false,
      plans: PAID_PLAN_DEFINITIONS,
    });
    // Starter 250 gens / 2 pages — fails pages + gens
    // Dabbler 600 / 5 — fits
    expect(plan?.planName).toBe("dabbler");
  });

  it("with overage on, can fit a cheaper plan when gens exceed included but stay in cap", () => {
    const without = cheapestFittingPlan({
      gensDemand: 400,
      pagesNeeded: 2,
      previewOverage: false,
    });
    expect(without?.planName).toBe("dabbler"); // starter included 250

    const withOverage = cheapestFittingPlan({
      gensDemand: 400,
      pagesNeeded: 2,
      previewOverage: true,
    });
    // Starter: 400-250=150 overage ≤ 200 cap, 2 pages ok
    expect(withOverage?.planName).toBe("starter");
  });

  it("flags pages shortfall (no fit on starter for 3 pages)", () => {
    const plan = cheapestFittingPlan({
      gensDemand: 100,
      pagesNeeded: 3,
      previewOverage: false,
    });
    expect(plan?.planName).not.toBe("starter");
    expect(plan?.pageLimit).toBeGreaterThanOrEqual(3);
  });
});
