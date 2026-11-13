import { describe, expect, it, vi } from "vitest";
import {
  fetchPrintifyProviderVariantsDual,
  printifyProviderVariantsUrl,
} from "./printifyCatalogVariantsFetch";

describe("printifyProviderVariantsUrl", () => {
  it("adds show-out-of-stock for the full catalog", () => {
    expect(printifyProviderVariantsUrl(79, 6, false)).toContain("/variants.json");
    expect(printifyProviderVariantsUrl(79, 6, false)).not.toContain("show-out-of-stock");
    expect(printifyProviderVariantsUrl(79, 6, true)).toContain("show-out-of-stock=1");
  });
});

describe("fetchPrintifyProviderVariantsDual", () => {
  it("prefers the full catalog body when present", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      const full = String(url).includes("show-out-of-stock=1");
      return {
        ok: true,
        json: async () => ({
          variants: full
            ? [{ id: 1 }, { id: 2 }, { id: 3 }]
            : [{ id: 1 }, { id: 2 }],
          views: full ? [{ position: "front" }] : [],
        }),
      } as Response;
    });

    const dual = await fetchPrintifyProviderVariantsDual(79, 99, "token", { fetchFn: fetchFn as any });
    expect(dual.usedFullCatalog).toBe(true);
    expect(dual.variants).toHaveLength(3);
    expect(dual.inStockVariantIds).toEqual([1, 2]);
    expect(dual.payload.views).toHaveLength(1);
  });

  it("falls back to in-stock when full catalog fails", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      const full = String(url).includes("show-out-of-stock=1");
      if (full) return { ok: false, status: 500, json: async () => ({}) } as Response;
      return {
        ok: true,
        json: async () => ({ variants: [{ id: 10 }] }),
      } as Response;
    });

    const dual = await fetchPrintifyProviderVariantsDual(79, 99, "token", { fetchFn: fetchFn as any });
    expect(dual.usedFullCatalog).toBe(false);
    expect(dual.variants).toEqual([{ id: 10 }]);
    expect(dual.inStockVariantIds).toEqual([10]);
  });

  it("retries a 429 then accepts the catalog", async () => {
    const calls = new Map<string, number>();
    const fetchFn = vi.fn(async (url: string) => {
      const n = (calls.get(url) || 0) + 1;
      calls.set(url, n);
      if (n === 1) return { ok: false, status: 429, json: async () => ({}) } as Response;
      return {
        ok: true,
        status: 200,
        json: async () => ({ variants: [{ id: 7 }] }),
      } as Response;
    });
    const dual = await fetchPrintifyProviderVariantsDual(79, 99, "token", {
      fetchFn: fetchFn as any,
      sleep: async () => {},
    });
    expect(dual.inStockVariantIds).toEqual([7]);
    expect(fetchFn.mock.calls.length).toBe(4);
  });
});
