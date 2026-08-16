import { describe, expect, it } from "vitest";
import {
  capVariantSelectionForShopifyLimit,
  countActiveVariantMapKeys,
  normalizeSelectionId,
  resolveVariantForSizeOnly,
  resolveVariantFromMap,
  SHOPIFY_MAX_VARIANTS_PER_PRODUCT,
} from "./variantMapResolve";

describe("normalizeSelectionId", () => {
  it("treats pillow dimension id formats as the same size", () => {
    expect(normalizeSelectionId("14x14")).toBe("14-14");
    expect(normalizeSelectionId("14-x-14")).toBe("14-14");
    expect(normalizeSelectionId("14-14")).toBe("14-14");
    expect(normalizeSelectionId("14 x 14")).toBe("14-14");
  });

  it("does not rewrite apparel sizes that contain an x", () => {
    expect(normalizeSelectionId("xl")).toBe("xl");
    expect(normalizeSelectionId("2xl")).toBe("2xl");
  });
});

describe("resolveVariantForSizeOnly", () => {
  const phoneMap = {
    "iphone_13:black": { printifyVariantId: 101, providerId: 1 },
    "iphone_13:clear": { printifyVariantId: 102, providerId: 1 },
    "iphone_14_pro:black": { printifyVariantId: 201, providerId: 1 },
  };

  it("finds any colour for a phone model size", () => {
    const hit = resolveVariantForSizeOnly(phoneMap, "iphone_13");
    expect(hit?.entry.printifyVariantId).toBe(101);
    expect(hit?.key).toBe("iphone_13:black");
  });

  it("returns null when size is missing", () => {
    expect(resolveVariantForSizeOnly(phoneMap, "galaxy_s23")).toBeNull();
  });
});

describe("resolveVariantFromMap vs junk phone colour", () => {
  const phoneMap = {
    "iphone_13:black": { printifyVariantId: 101, providerId: 1 },
  };

  it("exact lookup fails for Model fragment colour", () => {
    expect(resolveVariantFromMap(phoneMap, "iphone_13", "12_pro")).toBeNull();
  });

  it("size-only helper recovers the variant", () => {
    expect(resolveVariantForSizeOnly(phoneMap, "iphone_13")?.entry.printifyVariantId).toBe(101);
  });
});

describe("capVariantSelectionForShopifyLimit", () => {
  function denseMap(sizes: string[], colors: string[]) {
    const map: Record<string, { printifyVariantId: number; providerId: number }> = {};
    let id = 1;
    for (const s of sizes) {
      for (const c of colors) {
        map[`${s}:${c}`] = { printifyVariantId: id++, providerId: 1 };
      }
    }
    return map;
  }

  it("keeps all sizes and trims colors to stay under 100", () => {
    const sizes = ["xs", "s", "m", "l", "xl", "2xl"];
    const colors = Array.from({ length: 20 }, (_, i) => `c${i}`);
    const map = denseMap(sizes, colors);
    expect(countActiveVariantMapKeys(map, sizes, colors)).toBe(120);

    const capped = capVariantSelectionForShopifyLimit(sizes, colors, map);
    expect(capped.capped).toBe(true);
    expect(capped.variantCount).toBeLessThanOrEqual(SHOPIFY_MAX_VARIANTS_PER_PRODUCT);
    expect(capped.sizeIds).toEqual(sizes);
    expect(capped.colorIds.length).toBe(16); // 6 * 16 = 96
  });

  it("no-ops when already under the limit", () => {
    const sizes = ["s", "m"];
    const colors = ["black", "white"];
    const map = denseMap(sizes, colors);
    const capped = capVariantSelectionForShopifyLimit(sizes, colors, map);
    expect(capped.capped).toBe(false);
    expect(capped.variantCount).toBe(4);
  });
});
