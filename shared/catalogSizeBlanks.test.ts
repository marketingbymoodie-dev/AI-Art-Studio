import { describe, expect, it } from "vitest";
import {
  applyCatalogSizeBlanks,
  CATALOG_SIZE_BLANK_BLUEPRINTS,
  CATALOG_SIZE_BLANK_PRINT_INSET,
  isCatalogSizeBlankBlueprint,
  resolveBlankUrlForSize,
  visibleRectForCatalogSizeAspect,
  visibleRectForCatalogSizeBlank,
} from "./catalogSizeBlanks";

describe("catalogSizeBlanks", () => {
  const blanksBySize = {
    "68x88": "https://cdn.example/68x88.png",
    "104x88": "https://cdn.example/104x88.png",
    "88x88": "https://cdn.example/88x88.png",
  };

  it("resolves exact size key from id/name", () => {
    const images = { blanksBySize };
    expect(
      resolveBlankUrlForSize(images, { id: "68x88", name: '68" x 88"' }),
    ).toBe(blanksBySize["68x88"]);
    expect(
      resolveBlankUrlForSize(images, {
        id: `104''_x_88"`,
        name: `104'' x 88"`,
      }),
    ).toBe(blanksBySize["104x88"]);
  });

  it("falls back by orientation when exact size missing", () => {
    const images = { blanksBySize };
    expect(
      resolveBlankUrlForSize(images, { id: "88x68", name: '88" x 68"' }),
    ).toBe(blanksBySize["104x88"]);
  });

  it("applies primary + gallery covering orientations", () => {
    const next = applyCatalogSizeBlanks({}, blanksBySize);
    expect(next.primary).toBe(blanksBySize["68x88"]);
    expect(next.blanksBySize).toEqual(blanksBySize);
    expect(next.gallery).toContain(blanksBySize["104x88"]);
    expect(next.gallery).toContain(blanksBySize["88x88"]);
  });

  it("synthesizes wall-decal sheet guides for 3:4 and 4:3 (not 2:3 landscape swap)", () => {
    const p18x24 = visibleRectForCatalogSizeAspect("3:4");
    expect(p18x24).toBeTruthy();
    expect(p18x24!.width / p18x24!.height).toBeCloseTo(0.75, 2);
    // Outer sheet is 0.75; print inset (0.965) excludes drop-shadow fringe.
    expect(p18x24!.height).toBeCloseTo(0.75 * 0.965, 3);

    const l24x18 = visibleRectForCatalogSizeAspect("4:3");
    expect(l24x18).toBeTruthy();
    expect(l24x18!.width / l24x18!.height).toBeCloseTo(4 / 3, 2);
    expect(l24x18!.width).toBeCloseTo(0.75 * 0.965, 3);

    // Must NOT match 2:3 / 3:2 (the shared-harvest failure mode).
    expect(p18x24!.width / p18x24!.height).not.toBeCloseTo(2 / 3, 2);
    expect(l24x18!.width / l24x18!.height).not.toBeCloseTo(3 / 2, 2);

    const p12x18 = visibleRectForCatalogSizeAspect("2:3");
    expect(p12x18!.width).toBeCloseTo((2 / 3) * 0.75 * 0.965, 3);
    expect(p12x18!.height).toBeCloseTo(0.75 * 0.965, 3);
  });

  it("can skip print inset when measuring the outer sheet bbox", () => {
    const outer = visibleRectForCatalogSizeAspect("4:3", 0.75, 1);
    expect(outer!.width).toBeCloseTo(0.75, 3);
  });

  it("treats indoor wall tapestry (241) as a catalog size-blank blueprint", () => {
    expect(isCatalogSizeBlankBlueprint(241)).toBe(true);
    expect(isCatalogSizeBlankBlueprint(CATALOG_SIZE_BLANK_BLUEPRINTS.indoorWallTapestry)).toBe(
      true,
    );
    expect(isCatalogSizeBlankBlueprint(1649)).toBe(false);
  });

  it("uses measured fabric bbox per tapestry size (not one shared letterbox)", () => {
    const portrait = visibleRectForCatalogSizeBlank(241, "26x36", "26:36");
    const large = visibleRectForCatalogSizeBlank(241, "88x104", "88:104");
    const landscape = visibleRectForCatalogSizeBlank(241, "36x26", "36:26");
    expect(portrait).toBeTruthy();
    expect(large).toBeTruthy();
    expect(landscape).toBeTruthy();
    expect(portrait!.height).toBeCloseTo(0.74512 * CATALOG_SIZE_BLANK_PRINT_INSET, 4);
    expect(large!.height).toBeCloseTo(0.82324 * CATALOG_SIZE_BLANK_PRINT_INSET, 4);
    expect(large!.height).toBeGreaterThan(portrait!.height);
    expect(landscape!.width).toBeGreaterThan(portrait!.width);
    const letterbox26 = visibleRectForCatalogSizeAspect("26:36");
    expect(portrait!.width / portrait!.height).not.toBeCloseTo(
      letterbox26!.width / letterbox26!.height,
      2,
    );
  });

  it("resolves tapestry portrait vs landscape size keys", () => {
    const blanksBySize = {
      "26x36": "https://cdn.example/26x36.png",
      "36x26": "https://cdn.example/36x26.png",
    };
    const images = { blanksBySize };
    expect(
      resolveBlankUrlForSize(images, { id: "26x36", name: '26" × 36"' }),
    ).toBe(blanksBySize["26x36"]);
    expect(
      resolveBlankUrlForSize(images, { id: "36x26", name: '36" × 26"' }),
    ).toBe(blanksBySize["36x26"]);
  });
});
