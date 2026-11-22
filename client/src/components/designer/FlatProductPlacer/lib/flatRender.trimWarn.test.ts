import { describe, expect, it } from "vitest";
import {
  expandPrintGuideToPrintFileAspect,
  flatApparelArtworkTrimmed,
  flatApparelGuideTrimmed,
  flatArtBox,
  flatArtBoxAxisAligned,
  flatArtContentSubRect,
  flatOpaqueOutlineFromAlpha,
  flatOpaqueOutlineTrimmed,
  flatOverflows,
  flatRotatedAabbAround,
  FLAT_APPAREL_PRINT_GUIDE_HEIGHT_BOOST,
} from "./flatRender";

describe("flatApparelGuideTrimmed", () => {
  const guide = { x: 100, y: 100, width: 200, height: 300 };

  it("stays quiet when opaque art is inside the dashed guide with a gap", () => {
    expect(
      flatApparelGuideTrimmed(guide, { x: 110, y: 120, width: 180, height: 260 }),
    ).toBe(false);
  });

  it("stays quiet when opaque art is flush with the guide (fills it exactly)", () => {
    expect(
      flatApparelGuideTrimmed(guide, {
        x: guide.x,
        y: guide.y,
        width: guide.width,
        height: guide.height,
      }),
    ).toBe(false);
  });

  it("ignores sub-pixel overhang from rotation rounding", () => {
    expect(
      flatApparelGuideTrimmed(guide, {
        x: guide.x - 0.25,
        y: guide.y,
        width: guide.width,
        height: guide.height,
      }),
    ).toBe(false);
  });

  it("warns when opaque art crosses the guide", () => {
    expect(
      flatApparelGuideTrimmed(guide, {
        x: guide.x - 10,
        y: 120,
        width: 180,
        height: 260,
      }),
    ).toBe(true);
  });

  it("does not treat a small interior margin as touching", () => {
    expect(
      flatApparelGuideTrimmed(guide, {
        x: guide.x + 3,
        y: guide.y + 3,
        width: guide.width - 6,
        height: guide.height - 6,
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
    const sub = flatArtContentSubRect(fullBox, {
      left: 0.25,
      top: 0.1,
      width: 0.5,
      height: 0.8,
    });
    expect(sub).toEqual({ x: 200, y: 230, width: 200, height: 240 });
  });
});

describe("flatOpaqueOutlineFromAlpha", () => {
  /** 64×64 RGBA with an opaque square covering pixels [16,48) on both axes. */
  function centeredSquareAlpha(): Uint8ClampedArray {
    const size = 64;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 16; y < 48; y++) {
      for (let x = 16; x < 48; x++) {
        data[(y * size + x) * 4 + 3] = 255;
      }
    }
    return data;
  }

  it("returns null for fully transparent artwork", () => {
    expect(flatOpaqueOutlineFromAlpha(new Uint8ClampedArray(64 * 64 * 4), 64, 64)).toBeNull();
  });

  it("bounds the outline to the opaque region, in [0,1] image space", () => {
    const outline = flatOpaqueOutlineFromAlpha(centeredSquareAlpha(), 64, 64)!;
    expect(outline.length).toBeGreaterThan(0);
    const xs = outline.map((p) => p.x);
    const ys = outline.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(0.25, 5);
    expect(Math.max(...xs)).toBeCloseTo(0.75, 5);
    expect(Math.min(...ys)).toBeCloseTo(0.25, 5);
    expect(Math.max(...ys)).toBeCloseTo(0.75, 5);
  });

  it("drops interior cells — only the boundary ring is kept", () => {
    const outline = flatOpaqueOutlineFromAlpha(centeredSquareAlpha(), 64, 64)!;
    // A solid 32×32 block has 33×33 corners; only the ring's should survive.
    expect(outline.length).toBeLessThan(33 * 33);
  });
});

describe("flatOpaqueOutlineTrimmed", () => {
  const guide = { x: 0, y: 0, width: 200, height: 200 };
  /** Content filling the middle of the image but not its corners (the bird case). */
  const diamond = [
    { x: 0.5, y: 0 },
    { x: 1, y: 0.5 },
    { x: 0.5, y: 1 },
    { x: 0, y: 0.5 },
  ];

  it("does not warn on the hollow corners a rotation adds to the bounding box", () => {
    const placement = { scale: 1, offsetX: 0, offsetY: 0, rotationDeg: 45 };
    const fullBox = flatArtBox(guide, placement, 100, 100);
    // The box-based check fires: its rotated AABB pushes well past the guide.
    const aabb = flatArtBoxAxisAligned(guide, placement, 100, 100);
    expect(flatApparelGuideTrimmed(guide, aabb)).toBe(true);
    // The opaque footprint does not — those AABB corners are empty.
    expect(flatOpaqueOutlineTrimmed(guide, fullBox, 45, diamond)).toBe(false);
  });

  it("warns when rotation carries real opaque content past the guide", () => {
    const placement = { scale: 1.4, offsetX: 0, offsetY: 0, rotationDeg: 30 };
    const fullBox = flatArtBox(guide, placement, 100, 100);
    expect(flatOpaqueOutlineTrimmed(guide, fullBox, 30, diamond)).toBe(true);
  });

  it("warns when unrotated opaque content crosses the guide", () => {
    const fullBox = { x: -20, y: -20, width: 240, height: 240 };
    expect(flatOpaqueOutlineTrimmed(guide, fullBox, 0, diamond)).toBe(true);
  });

  it("stays quiet when opaque content is flush with the guide", () => {
    const fullBox = { x: 0, y: 0, width: 200, height: 200 };
    const edges = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    expect(flatOpaqueOutlineTrimmed(guide, fullBox, 0, edges)).toBe(false);
  });

  it("tests actual points, so a concave gap never warns on its own", () => {
    // Crescent: opaque along an arc, hollow across the chord.
    const crescent = Array.from({ length: 24 }, (_, i) => {
      const t = (i / 23) * Math.PI;
      return { x: 0.5 + 0.45 * Math.cos(t), y: 0.5 + 0.45 * Math.sin(t) };
    });
    const fullBox = { x: 0, y: 0, width: 200, height: 200 };
    expect(flatOpaqueOutlineTrimmed(guide, fullBox, 0, crescent)).toBe(false);
  });

  it("reprojects through the live rotation, never a cached one", () => {
    const fullBox = { x: 0, y: 0, width: 260, height: 260 };
    // Same outline, same box — only the angle differs, and it changes the answer.
    const flat = flatOpaqueOutlineTrimmed(guide, fullBox, 0, [{ x: 0.5, y: 1 }]);
    const turned = flatOpaqueOutlineTrimmed(guide, fullBox, 180, [{ x: 0.5, y: 1 }]);
    expect(flat).toBe(true);
    expect(turned).toBe(false);
  });
});

describe("flatRotatedAabbAround", () => {
  it("is identity at 0°", () => {
    const r = { x: 10, y: 20, width: 30, height: 40 };
    expect(flatRotatedAabbAround(r, 25, 40, 0)).toEqual(r);
  });

  it("rotates around an external pivot (full-image centre), not the rect centre", () => {
    const r = { x: 100, y: -10, width: 20, height: 20 };
    const aabb = flatRotatedAabbAround(r, 0, 0, 90);
    expect(aabb.x).toBeCloseTo(-10, 5);
    expect(aabb.y).toBeCloseTo(100, 5);
    expect(aabb.width).toBeCloseTo(20, 5);
    expect(aabb.height).toBeCloseTo(20, 5);
  });
});
