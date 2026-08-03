import { describe, expect, it } from "vitest";
import {
  computeProductHealth,
  isNonPositiveRetailPrice,
  merchantMarginPercent,
  merchantProfitCents,
  resolveEffectivePricingStrategy,
  roundUpTo95,
  suggestedRetailCents,
  unavailableVariantKeys,
} from "./productIntelligence";

describe("roundUpTo95 / suggestedRetailCents", () => {
  it("rounds up to .95", () => {
    expect(roundUpTo95(12.01)).toBeCloseTo(12.95);
    expect(roundUpTo95(12.95)).toBeCloseTo(12.95);
    expect(roundUpTo95(34.95 * 1.6)).toBeCloseTo(55.95);
  });

  it("applies 60% markup and refuses non-positive COGS", () => {
    // 1000¢ = $10 → $16.00 → ceil-0.05 → $15.95 (same as ResyncPricesDialog)
    expect(suggestedRetailCents(1000, 60)).toBe(1595);
    expect(suggestedRetailCents(0, 60)).toBeNull();
    expect(suggestedRetailCents(null, 60)).toBeNull();
    expect(suggestedRetailCents(-5, 60)).toBeNull();
  });
});

describe("zero-price guardrail", () => {
  it("flags empty and zero retail strings", () => {
    expect(isNonPositiveRetailPrice("0.00")).toBe(true);
    expect(isNonPositiveRetailPrice("0")).toBe(true);
    expect(isNonPositiveRetailPrice("")).toBe(true);
    expect(isNonPositiveRetailPrice("19.95")).toBe(false);
  });
});

describe("margin / profit", () => {
  it("computes profit and margin", () => {
    expect(merchantProfitCents(1695, 1000)).toBe(695);
    expect(merchantMarginPercent(1695, 1000)).toBeCloseTo((695 / 1695) * 100);
  });
});

describe("pricing strategy safety", () => {
  it("forces notify_only when markup unknown", () => {
    expect(resolveEffectivePricingStrategy("maintain_margin", null)).toBe("notify_only");
    expect(resolveEffectivePricingStrategy("maintain_margin", 60)).toBe("maintain_margin");
    expect(resolveEffectivePricingStrategy("maintain_price", null)).toBe("maintain_price");
  });
});

describe("product health", () => {
  it("escalates sync failure and fully OOS", () => {
    expect(computeProductHealth({ syncFailed: true })).toBe("attention_required");
    expect(computeProductHealth({ fullyOos: true })).toBe("attention_required");
    expect(computeProductHealth({ priceChanged: true })).toBe("needs_review");
    expect(computeProductHealth({})).toBe("healthy");
  });
});

describe("unavailableVariantKeys", () => {
  it("lists OOS and removed only", () => {
    expect(
      unavailableVariantKeys({
        "s:black": "in_stock",
        "xl:black": "out_of_stock",
        "xxl:black": "removed",
      }),
    ).toEqual(["xl:black", "xxl:black"]);
  });
});
