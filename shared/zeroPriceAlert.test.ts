import { describe, expect, it } from "vitest";
import {
  clearZeroPriceAlertIfPriced,
  formatZeroPriceAlertEmail,
  pagesNeedingZeroPriceAlert,
} from "./zeroPriceAlert";

const hoodie = {
  id: "1",
  shop: "demo.myshopify.com",
  title: "Heavy Blend Zip Hoodie",
  handle: "heavy-blend-full-zip-hooded-sweatshirt",
  status: "active",
  baseProductPrice: "0.00",
  zeroPriceAlertSentAt: null,
};

describe("pagesNeedingZeroPriceAlert", () => {
  it("alerts live $0 pages that have not been emailed yet", () => {
    expect(pagesNeedingZeroPriceAlert([hoodie]).map((p) => p.id)).toEqual(["1"]);
  });

  it("skips priced, disabled, and already-notified pages", () => {
    expect(
      pagesNeedingZeroPriceAlert([
        { ...hoodie, baseProductPrice: "29.95" },
        { ...hoodie, id: "2", status: "disabled" },
        { ...hoodie, id: "3", zeroPriceAlertSentAt: new Date() },
      ]),
    ).toEqual([]);
  });
});

describe("formatZeroPriceAlertEmail", () => {
  it("names the product and tells the merchant to resync", () => {
    const { subject, text } = formatZeroPriceAlertEmail([hoodie]);
    expect(subject).toContain("Heavy Blend Zip Hoodie");
    expect(text).toContain("Resync Prices");
    expect(text).toContain("/pages/heavy-blend-full-zip-hooded-sweatshirt");
  });
});

describe("clearZeroPriceAlertIfPriced", () => {
  it("clears the dedupe stamp only when a real price is written", () => {
    expect(clearZeroPriceAlertIfPriced({ title: "x" }, "0.00")).toEqual({ title: "x" });
    expect(clearZeroPriceAlertIfPriced({ title: "x" }, "18.95")).toEqual({
      title: "x",
      zeroPriceAlertSentAt: null,
    });
  });
});
