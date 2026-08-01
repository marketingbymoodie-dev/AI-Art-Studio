import { describe, expect, it } from "vitest";
import {
  cacheCoversVariantIds,
  extractCostsFromCatalogVariants,
  extractCostsFromPrintifyProduct,
  extractPrintifyVariantCostCents,
  filterCostsToPrintifyVariantIds,
  parsePrintifyCostsCache,
  serializePrintifyCostsCache,
} from "./printifyProductionCosts";

describe("printifyProductionCosts", () => {
  it("reads direct cost on catalog variants", () => {
    const costs = extractCostsFromCatalogVariants([
      { id: 101, title: "Black / S", cost: 899 },
      { id: 102, title: "Black / M", cost: 949 },
    ]);
    expect(costs).toEqual({ "101": 899, "102": 949 });
  });

  it("reads priceTag.cost when present", () => {
    expect(extractPrintifyVariantCostCents({ id: 1, priceTag: { cost: 1234 } })).toBe(1234);
    expect(extractPrintifyVariantCostCents({ variant_id: 2, price_tag: { cost: "567" } })).toBe(567);
  });

  it("extracts costs from shop product payloads", () => {
    const costs = extractCostsFromPrintifyProduct({
      variants: [{ id: 55, cost: 400, price: 1999 }],
    });
    expect(costs).toEqual({ "55": 400 });
  });

  it("round-trips cache serialization (front-only → tiered shape)", () => {
    const raw = serializePrintifyCostsCache({ "1": 500 });
    const { costs, front, both, fetchedAt } = parsePrintifyCostsCache(raw);
    expect(costs).toEqual({ "1": 500 });
    expect(front).toEqual({ "1": 500 });
    expect(both).toEqual({});
    expect(fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("round-trips front + both tiered cache", () => {
    const raw = serializePrintifyCostsCache({
      front: { "1": 900 },
      both: { "1": 1500 },
    });
    const parsed = parsePrintifyCostsCache(raw);
    expect(parsed.front).toEqual({ "1": 900 });
    expect(parsed.both).toEqual({ "1": 1500 });
    expect(parsed.costs).toEqual({ "1": 900 });
  });

  it("reads legacy flat cache as front-only", () => {
    const parsed = parsePrintifyCostsCache(JSON.stringify({ "9": 111, _fetchedAt: "2026-01-01T00:00:00.000Z" }));
    expect(parsed.front).toEqual({ "9": 111 });
    expect(parsed.both).toEqual({});
  });

  it("filters cached costs to active variant IDs", () => {
    const filtered = filterCostsToPrintifyVariantIds({ "1": 100, "2": 200, "3": 300 }, [2, 3]);
    expect(filtered).toEqual({ "2": 200, "3": 300 });
  });

  it("detects when cache covers active variants", () => {
    expect(cacheCoversVariantIds({ "10": 500 }, [10, 11])).toBe(true);
    expect(cacheCoversVariantIds({ "10": 500 }, [20])).toBe(false);
    expect(cacheCoversVariantIds({}, [10])).toBe(false);
  });
});
