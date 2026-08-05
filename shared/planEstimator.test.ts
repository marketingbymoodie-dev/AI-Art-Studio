import { describe, expect, it } from "vitest";
import {
  collapseToPriceDriverVariants,
  estimateMonthlyGenerations,
  estimateSalesFromVisitors,
  estimateVisitorFunnelGens,
  filterSpuriousOneSize,
  pagesNeededFromMix,
  platformAiCostUsd,
  priceDriversFromCostsPayload,
  recommendPlan,
  stripProviderSuffix,
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

  it("estimates visitor-funnel gens and sales", () => {
    expect(estimateVisitorFunnelGens({ monthlyVisitors: 100, freeGensPerVisitor: 5 })).toBe(500);
    expect(estimateSalesFromVisitors({ monthlyVisitors: 100, conversionRate: 0.05 })).toBe(5);
  });
});

describe("recommendPlan", () => {
  it("picks cheapest plan that fits pages and gens", () => {
    // 2 pages, 40 gens → Starter fails pages; Dabbler fits
    const r = recommendPlan({ pagesNeeded: 2, estimatedGens: 40 });
    expect(r.fits).toBe(true);
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
