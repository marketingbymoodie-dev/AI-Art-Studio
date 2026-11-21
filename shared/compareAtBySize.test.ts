import { describe, expect, it } from "vitest";
import {
  TYPE_54_COMPARE_AT_BY_SIZE,
  compareAtForSize,
  matchedSizeName,
  normaliseCompareAtBySize,
  parseCompareAtBySize,
} from "./compareAtBySize";

describe("compare-at by size", () => {
  it("keeps the old type 54 Softstyle compare-at prices", () => {
    expect(TYPE_54_COMPARE_AT_BY_SIZE).toEqual({
      XS: "34.95",
      S: "34.95",
      M: "34.95",
      L: "34.95",
      XL: "34.95",
      "2XL": "39.50",
      "3XL": "39.50",
    });
    expect(parseCompareAtBySize(JSON.stringify(TYPE_54_COMPARE_AT_BY_SIZE)).M).toBe("34.95");
  });

  it("treats a blank size as no crossed-out price", () => {
    const saved = normaliseCompareAtBySize({ S: "34.95", M: "", L: "  " });
    expect(saved).toEqual({ ok: true, value: { S: "34.95" }, json: "{\"S\":\"34.95\"}" });
    if (!saved.ok) return;
    expect(compareAtForSize(saved.value, "M")).toBe("");
    expect(compareAtForSize(saved.value, "s")).toBe("34.95");
    expect(parseCompareAtBySize(null)).toEqual({});
  });

  it("rejects a compare-at that is not a price", () => {
    expect(normaliseCompareAtBySize({ XL: "free" }).ok).toBe(false);
    expect(normaliseCompareAtBySize({ XL: "0" }).ok).toBe(false);
  });

  it("matches a variant option to the type's size name", () => {
    expect(matchedSizeName(["Black", "2XL", "Front"], ["S", "2XL"])).toBe("2XL");
    expect(matchedSizeName(["Front"], ["S"])).toBeNull();
  });
});
