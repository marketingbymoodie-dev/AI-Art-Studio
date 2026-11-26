import { describe, expect, it } from "vitest";
import {
  backsolveVisitorsFromSales,
  blendedCostPerGenUsd,
  collapseToPriceDriverVariants,
  estimateCustomizerFunnel,
  estimateMonthlyGenerations,
  estimateSalesFromVisitors,
  estimateVisitorFunnelGens,
  expectedSalesFromFunnel,
  filterSpuriousOneSize,
  pagesNeededFromMix,
  platformAiCostUsd,
  priceDriversFromCostsPayload,
  recommendPlan,
  scaleUnitsToTotal,
  stripProviderSuffix,
  buildShadowProductTitle,
  totalMonthlyUnits,
} from "./planEstimator";

describe("mix totals", () => {
  it("sums units and counts pages with positive units", () => {
    const lines = [
      { id: "1", label: "Tee", monthlyUnits: 10 },
      { id: "2", label: "Hoodie", monthlyUnits: 5 },
      { id: "3", label: "", monthlyUnits: 3 },
      { id: "4", label: "Skip", monthlyUnits: 0 },
    ];
    expect(totalMonthlyUnits(lines)).toBe(18);
    expect(pagesNeededFromMix(lines)).toBe(2);
  });
});

describe("generation / cost estimates", () => {
  it("estimates gens and platform AI cost at $0.05", () => {
    expect(estimateMonthlyGenerations({ totalUnits: 10, gensPerSale: 4 })).toBe(40);
    expect(platformAiCostUsd(40, 0.05)).toBe(2);
  });

  it("estimates legacy visitor-funnel gens and sales", () => {
    expect(estimateVisitorFunnelGens({ monthlyVisitors: 100, freeGensPerVisitor: 5 })).toBe(500);
    expect(estimateSalesFromVisitors({ monthlyVisitors: 100, conversionRate: 0.05 })).toBe(5);
  });

  it("blends base + vectorize cost", () => {
    expect(blendedCostPerGenUsd(0.04, 0.5)).toBe(0.045);
  });

  it("estimates customizer funnel on credits spent (live ladder grants)", () => {
    // 100 visitors × 25% engaged = 25
    // free: 25 × 1.5 = 37.5
    // email: 25 × 12% × 1 = 3 (Studio-funded — not in shop quota)
    // share: 25 × 3% × 1 = 0.75
    // purchase: 25 × 5% × 1 × 40% = 0.5
    // shop quota = 38.75 → ceil 39
    const f = estimateCustomizerFunnel({
      monthlyVisitors: 100,
      engagementRate: 0.25,
      grants: {
        freeGensPerVisitor: 2,
        emailCredits: 1,
        shareCredits: 1,
        purchaseCredits: 1,
        emailEnabled: true,
        shareEnabled: true,
        purchaseEnabled: true,
      },
    });
    expect(f.engaged).toBe(25);
    expect(f.totalGensSpent).toBe(39);
    expect(f.emailGensSpent).toBe(3);
    expect(f.orders).toBe(1); // floor(25 × 0.05)
    expect(f.leadsCaptured).toBe(3); // floor(25 × 0.12)
    expect(f.blendedCostPerGen).toBe(0.045);
    expect(f.aiCostUsd).toBe(Math.round(39 * 0.045 * 100) / 100);
    expect(f.costPerLeadUsd).toBe(Math.round((f.aiCostUsd / 3) * 100) / 100);
  });

  it("skips disabled reward rungs and clamps avg used to grant", () => {
    const f = estimateCustomizerFunnel({
      monthlyVisitors: 100,
      engagementRate: 0.25,
      avgEmailGensUsed: 10,
      grants: {
        freeGensPerVisitor: 2,
        emailCredits: 1,
        shareCredits: 5,
        purchaseCredits: 10,
        emailEnabled: true,
        shareEnabled: false,
        purchaseEnabled: false,
      },
    });
    expect(f.shareGensSpent).toBe(0);
    expect(f.purchaseGensSpent).toBe(0);
    // email avg clamped to 1 credit grant
    expect(f.emailGensSpent).toBe(3); // 25 × 0.12 × 1
  });
});

describe("funnel sync helpers", () => {
  it("back-solves visitors from sales holding engagement and conversion", () => {
    // 5 sales / (35% × 4%) = 5 / 0.014 ≈ 357.14 → 358
    const visitors = backsolveVisitorsFromSales({
      sales: 5,
      engagementRate: 0.35,
      conversionRate: 0.04,
    });
    expect(visitors).toBe(358);
    expect(
      expectedSalesFromFunnel({
        monthlyVisitors: visitors!,
        engagementRate: 0.35,
        conversionRate: 0.04,
      }),
    ).toBe(5);
  });

  it("scales units proportionally to an exact total", () => {
    const scaled = scaleUnitsToTotal(
      [
        { id: "a", monthlyUnits: 3 },
        { id: "b", monthlyUnits: 1 },
      ],
      10,
    );
    expect(scaled.map((r) => r.monthlyUnits)).toEqual([8, 2]);
    expect(scaled.reduce((s, r) => s + r.monthlyUnits, 0)).toBe(10);
  });

  it("puts all units on the first row when current total is zero", () => {
    const scaled = scaleUnitsToTotal(
      [
        { id: "a", monthlyUnits: 0 },
        { id: "b", monthlyUnits: 0 },
      ],
      7,
    );
    expect(scaled.map((r) => r.monthlyUnits)).toEqual([7, 0]);
  });
});

describe("recommendPlan", () => {
  it("picks cheapest plan that fits pages and gens", () => {
    // 2 pages, 40 gens → Starter now includes 2 pages
    const r = recommendPlan({ pagesNeeded: 2, estimatedGens: 40 });
    expect(r.fits).toBe(true);
    expect(r.planName).toBe("starter");
  });

  it("with overage on, Starter covers gens up to quota + cap", () => {
    const r = recommendPlan({ pagesNeeded: 1, estimatedGens: 400, includeOverage: true });
    expect(r.planName).toBe("starter");
    const starter = r.comparisons.find((c) => c.planName === "starter")!;
    expect(starter.overageGens).toBe(150);
    expect(starter.overageCostUsd).toBe(12);
    expect(starter.uncoveredGens).toBe(0);
  });

  it("with overage on, gens beyond cap remain uncovered", () => {
    const r = recommendPlan({ pagesNeeded: 1, estimatedGens: 500, includeOverage: true });
    const starter = r.comparisons.find((c) => c.planName === "starter")!;
    expect(starter.gensOk).toBe(false);
    expect(starter.overageGens).toBe(200);
    expect(starter.uncoveredGens).toBe(50);
    expect(r.planName).toBe("dabbler");
  });

  it("flags when even Pro Plus is short", () => {
    const r = recommendPlan({ pagesNeeded: 50, estimatedGens: 10_000 });
    expect(r.fits).toBe(false);
    expect(r.planName).toBeNull();
  });
});

describe("collapseToPriceDriverVariants", () => {
  it("collapses colours with same size and print area", () => {
    const rows = [
      {
        supplierVariantId: "1",
        size: "M",
        color: "Black",
        printAreaKey: "front",
        baseCogsCents: 1200,
      },
      {
        supplierVariantId: "2",
        size: "M",
        color: "White",
        printAreaKey: "front",
        baseCogsCents: 1200,
      },
      {
        supplierVariantId: "3",
        size: "M",
        color: "Black",
        printAreaKey: "both",
        baseCogsCents: 1800,
      },
      {
        supplierVariantId: "4",
        size: "XL",
        color: "Black",
        printAreaKey: "front",
        baseCogsCents: 1300,
      },
    ];
    const collapsed = collapseToPriceDriverVariants(rows);
    expect(collapsed.map((c) => c.label)).toEqual([
      "Med — Front",
      "XL — Front",
      "Med — Front/Back",
    ]);
  });

  it("drops colour names mistaken for sizes", () => {
    const collapsed = collapseToPriceDriverVariants([
      {
        supplierVariantId: "1",
        size: "Storm Grey",
        color: null,
        printAreaKey: "front",
        baseCogsCents: 1556,
      },
      {
        supplierVariantId: "2",
        size: "L",
        color: "Black",
        printAreaKey: "front",
        baseCogsCents: 1162,
      },
      {
        supplierVariantId: "3",
        size: "S",
        color: "White",
        printAreaKey: "front",
        baseCogsCents: 1162,
      },
    ]);
    expect(collapsed.map((c) => c.label)).toEqual(["Small — Front", "Lge — Front"]);
  });
});

describe("priceDriversFromCostsPayload / One size filter", () => {
  it("builds front and front+back sorted Small→XL then Front/Back", () => {
    const drivers = priceDriversFromCostsPayload({
      costs: { "1": 1174, "2": 1174, "3": 1300 },
      costsBoth: { "1": 1500, "3": 1800 },
      printifyVariantLabels: {
        "1": "M / Black",
        "2": "L / White",
        "3": "Storm Grey / XL",
      },
    });
    expect(drivers.map((d) => d.label)).toEqual([
      "Med — Front",
      "Lge — Front",
      "XL — Front",
      "Med — Front/Back",
      "XL — Front/Back",
    ]);
  });

  it("synthesizes Front/Back rows when supportsBothSides but costsBoth empty", () => {
    const drivers = priceDriversFromCostsPayload({
      costs: { "1": 2024, "2": 2024 },
      costsBoth: {},
      supportsBothSides: true,
      printifyVariantLabels: {
        "1": "S / White/ Navy",
        "2": "M / White/ Navy",
      },
    });
    expect(drivers.map((d) => d.label)).toEqual([
      "Small — Front",
      "Med — Front",
      "Small — Front/Back",
      "Med — Front/Back",
    ]);
    expect(drivers.filter((d) => d.printAreaKey === "both").every((d) => d.cogsCents == null)).toBe(
      true,
    );
  });

  it("drops One size when real sizes exist", () => {
    expect(
      filterSpuriousOneSize([
        {
          key: "a",
          label: "One size — Front",
          size: "One size",
          printAreaKey: "front",
          cogsCents: 100,
          shippingCents: null,
        },
        {
          key: "b",
          label: "Med — Front",
          size: "M",
          printAreaKey: "front",
          cogsCents: 100,
          shippingCents: null,
        },
      ]).map((v) => v.size),
    ).toEqual(["M"]);
  });

  it("strips provider suffixes", () => {
    expect(stripProviderSuffix("Unisex Cotton Crew Tee — Printify Choice")).toBe(
      "Unisex Cotton Crew Tee",
    );
    expect(
      stripProviderSuffix("Custom Unisex Cotton Crew Tee — Printify Choice — XL / Heather Grey"),
    ).toBe("Custom Unisex Cotton Crew Tee — XL / Heather Grey");
    expect(
      buildShadowProductTitle("Unisex Cotton Crew Tee — Printify Choice", "XL / Heather Grey"),
    ).toBe("Unisex Cotton Crew Tee — XL / Heather Grey");
  });

  it("builds size rows from labels when COGS are missing", () => {
    const drivers = priceDriversFromCostsPayload({
      costs: {},
      printifyVariantLabels: {
        "1": "S / Black",
        "2": "M / Black",
      },
    });
    expect(drivers.map((d) => d.label)).toEqual(["Small — Front", "Med — Front"]);
    expect(drivers.every((d) => d.cogsCents == null)).toBe(true);
  });

  it("keeps comforter 104x88 when Printify uses '' / _x_ tokens", () => {
    const drivers = priceDriversFromCostsPayload({
      costs: {
        "1": 11882,
        "2": 12544,
        "3": 13511,
        "4": 16000,
      },
      printifyVariantLabels: {
        "1": `68" x 88"`,
        "2": `68" x 92"`,
        "3": `88" x 88"`,
        "4": `104''_x_88"`,
      },
    });
    expect(drivers.map((d) => d.label)).toEqual([
      `68" x 88" — Front`,
      `68" x 92" — Front`,
      `88" x 88" — Front`,
      `104" x 88" — Front`,
    ]);
    expect(drivers.find((d) => d.size === "104x88")?.cogsCents).toBe(16000);
  });

  it("unions a label-only comforter size when COGS skipped that variant", () => {
    const drivers = priceDriversFromCostsPayload({
      costs: {
        "1": 11882,
        "2": 12544,
        "3": 13511,
      },
      printifyVariantLabels: {
        "1": `68" x 88"`,
        "2": `68" x 92"`,
        "3": `88" x 88"`,
        "4": `104'' x 88''`,
      },
    });
    expect(drivers.map((d) => d.label)).toEqual([
      `68" x 88" — Front`,
      `68" x 92" — Front`,
      `88" x 88" — Front`,
      `104" x 88" — Front`,
    ]);
    expect(drivers.find((d) => d.size === "104x88")?.cogsCents).toBeNull();
  });
});
