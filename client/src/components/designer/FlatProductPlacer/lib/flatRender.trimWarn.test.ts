import { describe, expect, it } from "vitest";
import {
  expandPrintGuideToPrintFileAspect,
  flatApparelArtworkTrimmed,
  flatApparelGuideTrimmed,
  flatArtBox,
  flatArtBoxAxisAligned,
  flatArtContentSubRect,
  flatOverflows,
  flatRotatedAabbAround,
  FLAT_APPAREL_PRINT_GUIDE_HEIGHT_BOOST,
} from "./flatRender";

describe("flatApparelGuideTrimmed", () => {
  const guide = { x: 100, y: 100, width: 200, height: 300 };

  it("stays quiet when art is inside the dashed guide", () => {
    expect(
      flatApparelGuideTrimmed(guide, { x: 110, y: 120, width: 180, height: 260 }),
    ).toBe(false);
  });

  it("warns on any overhang past the dashed guide (slack is 0)", () => {
    expect(
      flatApparelGuideTrimmed(guide, {
        x: guide.x - 1,
        y: 120,
        width: 180,
        height: 260,
      }),
    ).toBe(true);
  });

  it("stays quiet when art is flush with the guide edge", () => {
    expect(
      flatApparelGuideTrimmed(guide, {
        x: guide.x,
        y: guide.y,
        width: guide.width,
        height: guide.height,
      }),
    ).toBe(false);
  });
});

describe("flatApparelArtworkTrimmed", () => {
  const harvest = { x: 300, y: 400, width: 400, height: 480 };
  const canvasW = 1000;
  const canvasH = 1200;
  const guide = expandPrintGuideToPrintFileAspect(
    harvest,
    { width: 4500, height: 5400 },
    canvasW,
    canvasH,
  );

  it("expands the guide above the harvest AABB", () => {
    expect(guide.height).toBeGreaterThan(harvest.height);
    expect(guide.y).toBeLessThan(harvest.y);
    expect(guide.height).toBeCloseTo(
      harvest.height * FLAT_APPAREL_PRINT_GUIDE_HEIGHT_BOOST,
      5,
    );
  });

  it("warns when art sits between harvest top and expanded guide top", () => {
    const artBox = {
      x: 320,
      y: guide.y + 4,
      width: 360,
      height: 200,
    };
    expect(artBox.y).toBeLessThan(harvest.y);
    expect(flatOverflows(guide, artBox)).toBe(false);
    expect(flatOverflows(harvest, artBox)).toBe(true);
    expect(flatApparelArtworkTrimmed(harvest, guide, artBox)).toBe(true);
  });

  it("warns when art extends past the expanded Printify guide", () => {
    const artBox = {
      x: 320,
      y: guide.y - 20,
      width: 360,
      height: 200,
    };
    expect(flatApparelArtworkTrimmed(harvest, guide, artBox)).toBe(true);
  });

  it("stays quiet when art is fully inside the harvest AABB", () => {
    const artBox = {
      x: 320,
      y: 420,
      width: 360,
      height: 200,
    };
    expect(flatApparelArtworkTrimmed(harvest, guide, artBox)).toBe(false);
  });
});
describe("flatArtBoxAxisAligned", () => {
  const rect = { x: 0, y: 0, width: 200, height: 200 };

  it("matches flatArtBox when unrotated", () => {
    const placement = { scale: 0.5, offsetX: 0, offsetY: 0, rotationDeg: 0 };
    const a = flatArtBox(rect, placement, 100, 100);
    const b = flatArtBoxAxisAligned(rect, placement, 100, 100);
    expect(b).toEqual(a);
  });

  it("grows the AABB when artwork is rotated 45°", () => {
    const placement = { scale: 1, offsetX: 0, offsetY: 0, rotationDeg: 45 };
    const plain = flatArtBox(rect, placement, 100, 100);
    const rotated = flatArtBoxAxisAligned(rect, placement, 100, 100);
    expect(rotated.width).toBeGreaterThan(plain.width);
    expect(rotated.height).toBeGreaterThan(plain.height);
  });
});

describe("flatArtContentSubRect", () => {
  const fullBox = { x: 100, y: 200, width: 400, height: 300 };

  it("returns the full box when content fractions are null (CORS fallback)", () => {
    expect(flatArtContentSubRect(fullBox, null)).toEqual(fullBox);
  });

  it("maps opaque-content fractions into the placed box", () => {
    // PNG with 25% padding left, 10% top; content covers 50% x 80%.
    const sub = flatArtContentSubRect(fullBox, {
      left: 0.25,
      top: 0.1,
      width: 0.5,
      height: 0.8,
    });
    expect(sub).toEqual({ x: 200, y: 230, width: 200, height: 240 });
  });
});

describe("flatRotatedAabbAround", () => {
  it("is identity at 0°", () => {
    const r = { x: 10, y: 20, width: 30, height: 40 };
    expect(flatRotatedAabbAround(r, 25, 40, 0)).toEqual(r);
  });

  it("rotates around an external pivot (full-image centre), not the rect centre", () => {
    // Content rect sits right of the pivot; 90° rotation should move it below.
    const r = { x: 100, y: -10, width: 20, height: 20 };
    const aabb = flatRotatedAabbAround(r, 0, 0, 90);
    expect(aabb.x).toBeCloseTo(-10, 5);
    expect(aabb.y).toBeCloseTo(100, 5);
    expect(aabb.width).toBeCloseTo(20, 5);
    expect(aabb.height).toBeCloseTo(20, 5);
  });
});
