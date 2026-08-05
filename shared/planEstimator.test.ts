import { describe, expect, it } from "vitest";
import {
  collapseToPriceDriverVariants,
  estimateMonthlyGenerations,
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
      "M — front",
      "XL — front",
      "M — front+back",
    ]);
  });
});

describe("priceDriversFromCostsPayload / One size filter", () => {
  it("builds front and front+back from costs payload", () => {
    const drivers = priceDriversFromCostsPayload({
      costs: { "1": 1174, "2": 1174 },
      costsBoth: { "1": 1500 },
      printifyVariantLabels: {
        "1": "M / Black",
        "2": "L / White",
      },
    });
    expect(drivers.map((d) => d.label).sort()).toEqual([
      "L — front",
      "M — front",
      "M — front+back",
    ]);
  });

  it("drops One size when real sizes exist", () => {
    expect(
      filterSpuriousOneSize([
        {
          key: "a",
          label: "One size — front",
          size: "One size",
          printAreaKey: "front",
          cogsCents: 100,
          shippingCents: null,
        },
        {
          key: "b",
          label: "M — front",
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
});
