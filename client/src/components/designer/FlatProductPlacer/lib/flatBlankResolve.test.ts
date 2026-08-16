import { describe, expect, it } from "vitest";
import {
  blanksLookLikeApparelSizeColor,
  harvestBlankMatchesSelection,
  productLooksLikeApparel,
  resolveFlatBlankColorId,
  resolveFlatPlacementGeometryKey,
} from "./flatBlankResolve";
import type { FlatCalibrationManifest } from "@/pages/embed-design";

function decorManifest(
  blanks: Record<string, { front?: string }>,
): FlatCalibrationManifest {
  return {
    productTypeId: 1,
    name: "Framed Vertical Poster",
    blueprintId: 1,
    providerId: 1,
    tier: "flat",
    views: { front: {} as any },
    blanks,
    representativeGeometry: true,
    decorPerSize: true,
    generatedAt: new Date().toISOString(),
  };
}

describe("flatBlankResolve", () => {
  it("does not treat framed-poster size:color keys as apparel", () => {
    const manifest = decorManifest({
      "16x20:black": { front: "https://example.com/b.png" },
      "16x20:white": { front: "https://example.com/w.png" },
      "16x16:black": { front: "https://example.com/sb.png" },
      "16x16:white": { front: "https://example.com/sw.png" },
    });
    expect(blanksLookLikeApparelSizeColor(manifest)).toBe(false);
  });

  it("still detects legacy apparel size:color harvest keys", () => {
    const manifest = decorManifest({
      "s:black": { front: "https://example.com/s-b.png" },
      "m:white": { front: "https://example.com/m-w.png" },
    });
    expect(blanksLookLikeApparelSizeColor(manifest)).toBe(true);
  });

  it("resolves decor blank as size:color before bare colour", () => {
    const manifest = decorManifest({
      "16x20:black": { front: "https://example.com/b.png" },
      "16x20:white": { front: "https://example.com/w.png" },
      "16x16:black": { front: "https://example.com/sb.png" },
      "16x16:white": { front: "https://example.com/sw.png" },
    });
    expect(
      resolveFlatBlankColorId(manifest, {
        sizeId: "16x16",
        frameColorId: "white",
      }),
    ).toBe("16x16:white");
    expect(
      resolveFlatBlankColorId(manifest, {
        sizeId: "16x20",
        frameColorId: "black",
      }),
    ).toBe("16x20:black");
  });

  it("matches Dark Heather to a dark_heather harvest blank", () => {
    const manifest = decorManifest({
      maroon: { front: "https://example.com/maroon.png" },
      dark_heather: { front: "https://example.com/dh.png" },
      navy: { front: "https://example.com/navy.png" },
    });
    expect(
      resolveFlatBlankColorId(manifest, {
        frameColorId: "dark-heather",
        frameColorName: "Dark Heather",
        isApparel: true,
      }),
    ).toBe("dark_heather");
  });

  it("does not fall back to the first blank for an unmatched apparel colour", () => {
    const manifest = decorManifest({
      maroon: { front: "https://example.com/maroon.png" },
      navy: { front: "https://example.com/navy.png" },
    });
    expect(
      resolveFlatBlankColorId(manifest, {
        frameColorId: "dark_heather",
        frameColorName: "Dark Heather",
        isApparel: true,
      }),
    ).toBe("dark_heather");
    expect(
      harvestBlankMatchesSelection(manifest, {
        frameColorId: "dark_heather",
        frameColorName: "Dark Heather",
        isApparel: true,
      }),
    ).toBeNull();
  });

  it("treats hoodies imported as generic as apparel", () => {
    expect(
      productLooksLikeApparel({
        designerType: "generic",
        name: "Heavy Blend Full Zip Hooded Sweatshirt",
        sizes: [{ id: "s", name: "S" }, { id: "m", name: "M" }],
      }),
    ).toBe(true);
    expect(
      productLooksLikeApparel({
        designerType: "framed-print",
        name: "Framed Vertical Poster",
        sizes: [{ id: "16x20", name: "16x20" }],
      }),
    ).toBe(false);
  });

  it("uses size-only geometry key for decorPerSize frame colour swaps", () => {
    const manifest = decorManifest({
      "16x16:black": { front: "https://example.com/sb.png" },
      "16x16:white": { front: "https://example.com/sw.png" },
    });
    expect(
      resolveFlatPlacementGeometryKey(manifest, {
        sizeId: "16x16",
        frameColorId: "white",
      }),
    ).toBe("16x16");
  });
});
