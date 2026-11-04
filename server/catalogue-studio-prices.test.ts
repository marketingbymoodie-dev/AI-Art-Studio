import { describe, expect, it } from "vitest";
import { applySoftstyleCataloguePrices } from "@shared/softstyleCataloguePrices";

describe("applySoftstyleCataloguePrices", () => {
  it("prices XS through XL at 29.95 and 2XL and 3XL at 33.95, with compare-at on every size", () => {
    const discovered = {
      XS: "29.95",
      S: "29.95",
      M: "29.95",
      L: "29.95",
      XL: "29.95",
      "2XL": "33.95",
      "3XL": "37.95",
    };
    const applied = applySoftstyleCataloguePrices(discovered);
    expect(applied.pricesBySize).toEqual({
      XS: "29.95",
      S: "29.95",
      M: "29.95",
      L: "29.95",
      XL: "29.95",
      "2XL": "33.95",
      "3XL": "33.95",
    });
    expect(applied.compareAtBySize).toEqual({
      XS: "34.95",
      S: "34.95",
      M: "34.95",
      L: "34.95",
      XL: "34.95",
      "2XL": "39.50",
      "3XL": "39.50",
    });
  });

  it("leaves a size the table does not name on its discovered price", () => {
    const applied = applySoftstyleCataloguePrices({ "4XL": "41.95", M: "10.00" });
    expect(applied.pricesBySize["4XL"]).toBe("41.95");
    expect(applied.compareAtBySize["4XL"]).toBeUndefined();
    expect(applied.pricesBySize.M).toBe("29.95");
    expect(applied.compareAtBySize.M).toBe("34.95");
  });
});
