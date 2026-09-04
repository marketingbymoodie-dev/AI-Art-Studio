import { describe, expect, it } from "vitest";
import {
  appendIsoCurrencyCode,
  ceilPresentmentEstimateCents,
  formatPresentmentMoney,
  formatShopCurrencyDropdownPrice,
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
    expect(out.text).not.toContain("USD");
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
    expect(out.text).not.toContain("USD");
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
    expect(out.text.replace(/\s/g, "")).toMatch(/€16,95EUR/);
    expect(out.text).toMatch(/EUR/);
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
    expect(out.text.replace(/\s/g, "")).toMatch(/€23,95EUR/);
  });

  it("ceils a raw AUD rate estimate up to the next whole dollar", () => {
    const out = formatStorefrontHeadlineDisplay({
      shopAmount: 32.95,
      showFrom: false,
      variantId: "1",
      activeCurrency: "AUD",
      shopCurrency: "USD",
      rate: 1.22,
      pricesByVariantId: {},
      country: "AU",
      locale: "en",
      allowAjaxPresentment: false,
    });
    expect(out.converted).toBe(true);
    expect(out.text).toContain("≈");
    expect(out.text.replace(/\s/g, "")).toMatch(/\$41\.00AUD|A\$41\.00AUD/);
    expect(out.text).toContain("AUD");
  });

  it("appends NZD after a dollar-symbol estimate", () => {
    const out = formatStorefrontHeadlineDisplay({
      shopAmount: 40.95,
      showFrom: false,
      variantId: "1",
      activeCurrency: "NZD",
      shopCurrency: "USD",
      rate: 1.73,
      pricesByVariantId: { "1": 7100 },
      country: "NZ",
      locale: "en",
      allowAjaxPresentment: true,
    });
    expect(out.converted).toBe(true);
    expect(out.text).toContain("≈");
    expect(out.text).toContain("NZD");
    expect(out.text.replace(/\s/g, "")).toMatch(/\$71\.00NZD|NZ\$71\.00NZD/);
  });
});

describe("appendIsoCurrencyCode", () => {
  it("places ISO after the figure", () => {
    expect(appendIsoCurrencyCode("$71.00", "NZD")).toBe("$71.00 NZD");
    expect(appendIsoCurrencyCode("€16,95", "EUR")).toBe("€16,95 EUR");
  });
});

describe("formatShopCurrencyDropdownPrice", () => {
  it("stays a bare shop dollar when presentment is shop currency", () => {
    expect(formatShopCurrencyDropdownPrice(4095, "USD", false)).toBe("$40.95");
  });

  it("labels shop USD when presentment is another currency", () => {
    expect(formatShopCurrencyDropdownPrice(4095, "USD", true)).toBe("$40.95 USD");
  });
});

describe("ceilPresentmentEstimateCents", () => {
  it("AUD ceils up and does not bump an exact dollar", () => {
    expect(ceilPresentmentEstimateCents(4025, "AUD")).toBe(4100);
    expect(ceilPresentmentEstimateCents(6100, "AUD")).toBe(6100);
  });

  it("EUR ceils to the next .95 ending and does not bump .95", () => {
    expect(ceilPresentmentEstimateCents(2810, "EUR")).toBe(2895);
    expect(ceilPresentmentEstimateCents(2895, "EUR")).toBe(2895);
    expect(ceilPresentmentEstimateCents(2896, "EUR")).toBe(2995);
  });

  it("CZK and GBP ceil up to the whole major unit", () => {
    expect(ceilPresentmentEstimateCents(86398, "CZK")).toBe(86400);
    expect(ceilPresentmentEstimateCents(86400, "CZK")).toBe(86400);
    expect(ceilPresentmentEstimateCents(1234, "GBP")).toBe(1300);
    expect(ceilPresentmentEstimateCents(1300, "GBP")).toBe(1300);
  });

  it("JPY ceils forced-cents up to the next 100 yen", () => {
    expect(ceilPresentmentEstimateCents(647500, "JPY")).toBe(650000);
    expect(ceilPresentmentEstimateCents(650000, "JPY")).toBe(650000);
    expect(ceilPresentmentEstimateCents(300000, "JPY")).toBe(300000);
  });

  it("leaves unverified currencies including KRW unrounded", () => {
    expect(ceilPresentmentEstimateCents(1500000, "KRW")).toBe(1500000);
    expect(ceilPresentmentEstimateCents(2347, "CHF")).toBe(2347);
  });
});
