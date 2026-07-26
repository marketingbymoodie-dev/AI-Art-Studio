import { describe, expect, it } from "vitest";
import {
  expandPrintGuideToPrintFileAspect,
  flatApparelArtworkTrimmed,
  flatArtBox,
  flatArtBoxAxisAligned,
  flatOverflows,
  FLAT_APPAREL_PRINT_GUIDE_HEIGHT_BOOST,
} from "./flatRender";

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
    // Art top is above harvest (mask clip) but still inside the taller guide.
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
