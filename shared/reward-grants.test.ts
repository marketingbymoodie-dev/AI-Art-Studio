import { describe, expect, it } from "vitest";
import {
  canonicalOrderId,
  formatPurchaseThresholdDisplay,
  purchaseRelatedEntityId,
  shareDesignRelatedEntityId,
  shareGrantMatchesShareId,
  shopCentsToUsdCents,
} from "./reward-grants";

describe("share_design related entity", () => {
  it("keys on share id only — not visitor/session", () => {
    expect(shareDesignRelatedEntityId("abc-share")).toBe("abc-share");
  });

  it("treats legacy shareId:visitor rows as the same share (no re-grant)", () => {
    expect(shareGrantMatchesShareId("abc-share:anon-1", "abc-share")).toBe(true);
    expect(shareGrantMatchesShareId("abc-share", "abc-share")).toBe(true);
    expect(shareGrantMatchesShareId("other:anon-1", "abc-share")).toBe(false);
  });
});

describe("purchase_threshold related entity", () => {
  it("collapses GID and numeric order ids", () => {
    expect(canonicalOrderId("gid://shopify/Order/998877")).toBe("998877");
    expect(purchaseRelatedEntityId(998877)).toBe("998877");
    expect(purchaseRelatedEntityId("998877")).toBe("998877");
  });
});

describe("USD-equivalent purchase rule", () => {
  it("compares shop cents through the pinned rate, not raw presentment", () => {
    // AUD 76.00 at 1.52 AUD/USD → 5000 USD cents
    expect(shopCentsToUsdCents(7600, 1.52)).toBe(5000);
    // AUD 75.00 at 1.5174 → floors below $50
    expect(shopCentsToUsdCents(7500, 1.5174)).toBeLessThan(5000);
  });

  it("returns null when the pin is missing (do not treat raw cents as USD)", () => {
    expect(shopCentsToUsdCents(7600, null)).toBeNull();
  });
});

describe("purchase threshold display (ceil in shopper favour)", () => {
  it("AU 1.5174 → AUD $76 so spending the label clears $50 USD", () => {
    const d = formatPurchaseThresholdDisplay({
      shopperCurrency: "AUD",
      usdToShopperRate: 1.5174,
    });
    expect(d).toMatchObject({ currency: "AUD", amount: 76, label: "AUD $76", usedPinnedRate: true });
    expect(shopCentsToUsdCents(d.amount * 100, 1.5174)).toBeGreaterThanOrEqual(5000);
  });

  it("GBP 0.79 → £40", () => {
    const d = formatPurchaseThresholdDisplay({
      shopperCurrency: "GBP",
      usdToShopperRate: 0.79,
    });
    expect(d.label).toBe("£40");
  });

  it("falls back to $50 USD when the pin is missing", () => {
    const d = formatPurchaseThresholdDisplay({
      shopperCurrency: "AUD",
      usdToShopperRate: null,
    });
    expect(d).toMatchObject({ currency: "USD", label: "$50 USD", usedPinnedRate: false });
  });
});
