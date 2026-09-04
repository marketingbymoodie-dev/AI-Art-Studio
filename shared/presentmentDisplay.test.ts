import { describe, expect, it } from "vitest";
import {
  formatPresentmentMoney,
  formatStorefrontHeadlineDisplay,
  isShopCurrencyPresentment,
} from "./presentmentDisplay";

describe("isShopCurrencyPresentment", () => {
  it("treats missing active currency as shop currency", () => {
    expect(isShopCurrencyPresentment(null, "USD", 0.87)).toBe(true);
  });

  it("treats USD shop + USD active as shop currency", () => {
    expect(isShopCurrencyPresentment("USD", "USD", 1)).toBe(true);
  });

  it("treats EUR vs USD as converted", () => {
    expect(isShopCurrencyPresentment("EUR", "USD", 0.87325322)).toBe(false);
  });
});

describe("formatPresentmentMoney", () => {
  it("formats EUR for AT with comma decimals", () => {
    const text = formatPresentmentMoney(1695, "EUR", "AT", "en");
    expect(text.replace(/\s/g, "")).toMatch(/€16,95/);
  });
});

describe("formatStorefrontHeadlineDisplay", () => {
  it("USD shop currency is byte-identical to today's headline", () => {
    const out = formatStorefrontHeadlineDisplay({
      shopAmount: 18.95,
      showFrom: false,
      variantId: "1",
      activeCurrency: "USD",
      shopCurrency: "USD",
      rate: 1,
      pricesByVariantId: { "1": 1695 },
      allowAjaxPresentment: true,
    });
    expect(out).toEqual({ text: "$18.95", converted: false });
  });

  it("from-prefix USD is unchanged", () => {
    const out = formatStorefrontHeadlineDisplay({
      shopAmount: 18.95,
      showFrom: true,
      variantId: "1",
      activeCurrency: "USD",
      shopCurrency: "USD",
      rate: 1,
      pricesByVariantId: {},
      allowAjaxPresentment: true,
    });
    expect(out.text).toBe("from $18.95");
  });

  it("uses Ajax presentment cents, not rate × shop", () => {
    const out = formatStorefrontHeadlineDisplay({
      shopAmount: 18.95,
      showFrom: false,
      variantId: "555",
      activeCurrency: "EUR",
      shopCurrency: "USD",
      rate: 0.87325322,
      pricesByVariantId: { "555": 1695 },
      country: "AT",
      locale: "en",
      allowAjaxPresentment: true,
    });
    expect(out.converted).toBe(true);
    expect(out.text).toContain("≈");
    expect(out.text.replace(/\s/g, "")).toMatch(/€16,95/);
    expect(out.text).not.toContain("16,55");
    expect(out.text).not.toContain("16.55");
  });

  it("both-tier ignores Ajax front cents and falls back to rate", () => {
    const out = formatStorefrontHeadlineDisplay({
      shopAmount: 27,
      showFrom: false,
      variantId: "555",
      activeCurrency: "EUR",
      shopCurrency: "USD",
      rate: 0.87325322,
      pricesByVariantId: { "555": 1695 },
      country: "AT",
      locale: "en",
      allowAjaxPresentment: false,
    });
    expect(out.converted).toBe(true);
    expect(out.text.replace(/\s/g, "")).toMatch(/€23,58/);
  });
});
