import { describe, expect, it } from "vitest";
import {
  artworkSizeAfterPlacementRotation,
  bakeArtworkPlacementRotation,
  remapSourceRectForPlacementRotation,
  buildFlatMeshTargetPoints,
  ARTWORK_SLICE_MIN_COVERAGE,
  artworkSliceMuralCoverage,
  artworkSliceSamplesMural,
  artworkSourceRectForPanel,
  clipSampleBbToSeamHalf,
  computeGroupRects,
  leggingsArtworkFallingOffUnseenSide,
  leggingsPanelHorizontalArtCoverage,
  meshSourceFlipXForPanel,
  normalizeRotationDeg,
  printPanelLongEdgeCaps,
  printPanelOutputScale,
  shouldComposePillowWrapPrintFile,
  sleevePanelHalfSourceRect,
  synthesiseLeggingsMirroredSourceRect,
  type DesignRectInfo,
} from "./aopPreview";
import {
  BODY_PILLOW_WRAP_BLUEPRINT_ID,
  createFreshAopTemplate,
  FAUX_SUEDE_PILLOW_WRAP_BLUEPRINT_ID,
  ZIP_HOODIE_BLUEPRINT_ID,
  type MaskLayer,
} from "@shared/hoodieTemplate";

describe("normalizeRotationDeg / bakeArtworkPlacementRotation", () => {
  it("normalizes to (-180, 180]", () => {
    expect(normalizeRotationDeg(270)).toBe(-90);
    expect(normalizeRotationDeg(-270)).toBe(90);
    expect(normalizeRotationDeg(180)).toBe(180);
  });

  it("is a no-op at 0° (same object reference)", () => {
    const src = document.createElement("canvas");
    src.width = 40;
    src.height = 20;
    expect(bakeArtworkPlacementRotation(src, 40, 20, 0)).toBe(src);
    expect(bakeArtworkPlacementRotation(src, 40, 20, 360)).toBe(src);
  });

  it("swaps canvas size at 90° so portrait art is not clipped", () => {
    expect(artworkSizeAfterPlacementRotation(20, 54, 90)).toEqual({
      width: 54,
      height: 20,
    });
    expect(artworkSizeAfterPlacementRotation(20, 54, -90)).toEqual({
      width: 54,
      height: 20,
    });
    expect(artworkSizeAfterPlacementRotation(20, 54, 180)).toEqual({
      width: 20,
      height: 54,
    });
  });

  it("remaps a full-frame sourceRect through 90° CW", () => {
    expect(remapSourceRectForPlacementRotation({ x: 0, y: 0, width: 20, height: 54 }, 20, 54, 90)).toEqual({
      x: 0,
      y: 0,
      width: 54,
      height: 20,
    });
  });

  it("remaps a full-frame sourceRect through 90° CCW", () => {
    expect(remapSourceRectForPlacementRotation({ x: 0, y: 0, width: 20, height: 54 }, 20, 54, -90)).toEqual({
      x: 0,
      y: 0,
      width: 54,
      height: 20,
    });
  });

  it("sizes the body-pillow place box from baked landscape art at 90°", () => {
    const template = createFreshAopTemplate({
      name: "body-pillow-rects",
      blueprintId: BODY_PILLOW_WRAP_BLUEPRINT_ID,
    });
    const layer: MaskLayer = {
      id: "front",
      view: "front",
      panelKey: "front",
      kind: "panel",
      name: "Front",
      visible: true,
      locked: false,
      zIndex: 1,
      opacity: 1,
      blendMode: "normal",
      maskPath: "M0,0 L540,0 L540,200 L0,200 Z",
      cornerPins: null,
      mesh: null,
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
      productionPanelAssignment: null,
      productionPanelSrc: null,
      isExclusion: false,
    };
    template.views.front.layers = [layer];
    const artwork = {
      naturalWidth: 20,
      naturalHeight: 54,
      width: 20,
      height: 54,
    } as HTMLImageElement;
    const map = computeGroupRects(template, "front", artwork, {
      placementOverrides: {
        "front-face": {
          front: { scale: 1, offsetX: 0, offsetY: 0, rotationDeg: 90 },
          back: { scale: 1, offsetX: 0, offsetY: 0, rotationDeg: 90 },
        },
      },
    });
    const rect = map.get("front-face");
    expect(rect).toBeDefined();
    expect(rect!.effective.width / rect!.effective.height).toBeCloseTo(54 / 20, 2);
    expect(rect!.effective.width).toBeGreaterThan(rect!.effective.height);
    const nudged = computeGroupRects(template, "front", artwork, {
      placementOverrides: {
        "front-face": {
          front: { scale: 1, offsetX: 40, offsetY: 0, rotationDeg: 90 },
          back: { scale: 1, offsetX: 0, offsetY: 0, rotationDeg: 90 },
        },
      },
    }).get("front-face");
    expect(nudged!.effective.x).toBeCloseTo(rect!.effective.x + 40, 5);
    expect(nudged!.effective.y).toBeCloseTo(rect!.effective.y, 5);
  });
});

describe("printPanelOutputScale", () => {
  it("upscales mockup-sized sourceRect toward 3200 (not placeholder 12k)", () => {
    // Leggings bug: scale was computed from Printify 12441px, then applied to
    // ~750px sourceRect → ~290px (~7 DPI). Scale must use the mesh base.
    const sourceRectLong = 750;
    const placeholderLong = 12441;
    const broken = printPanelOutputScale(placeholderLong);
    const fixed = printPanelOutputScale(sourceRectLong);
    expect(Math.round(sourceRectLong * broken)).toBeLessThan(400);
    expect(Math.round(sourceRectLong * fixed)).toBe(3200);
  });

  it("caps above-target bases at maxLongEdge", () => {
    expect(Math.round(5000 * printPanelOutputScale(5000))).toBe(4800);
  });

  it("leaves mid-size bases (≥3200, ≤4800) at scale 1", () => {
    expect(printPanelOutputScale(4000)).toBe(1);
  });

  it("body pillow targets 150 DPI on the 54in long edge", () => {
    const { target, max } = printPanelLongEdgeCaps(BODY_PILLOW_WRAP_BLUEPRINT_ID);
    expect(target).toBe(8100);
    expect(max).toBe(8100);
    const sourceRectLong = 750;
    expect(
      Math.round(sourceRectLong * printPanelOutputScale(sourceRectLong, max, target)),
    ).toBe(8100);
    expect(printPanelLongEdgeCaps(ZIP_HOODIE_BLUEPRINT_ID).target).toBe(3200);
  });
});

describe("buildFlatMeshTargetPoints", () => {
  const mesh = {
    cols: 3,
    rows: 2,
    targetPoints: [
      { x: 10, y: 20 },
      { x: 30, y: 20 },
      { x: 50, y: 20 },
      { x: 10, y: 80 },
      { x: 30, y: 80 },
      { x: 50, y: 80 },
    ],
  };

  it("maps mesh corners to the full flat canvas", () => {
    const flat = buildFlatMeshTargetPoints(mesh, 400, 200);
    expect(flat).toHaveLength(6);
    expect(flat[0]).toEqual({ x: 0, y: 0 });
    expect(flat[2]).toEqual({ x: 400, y: 0 });
    expect(flat[3]).toEqual({ x: 0, y: 200 });
    expect(flat[5]).toEqual({ x: 400, y: 200 });
  });

  it("maps UV 0–1 onto a Safe dest rect when insets are supplied", () => {
    const flat = buildFlatMeshTargetPoints(mesh, 400, 200, {
      x: 40,
      y: 20,
      width: 320,
      height: 160,
    });
    expect(flat[0]).toEqual({ x: 40, y: 20 });
    expect(flat[2]).toEqual({ x: 360, y: 20 });
    expect(flat[3]).toEqual({ x: 40, y: 180 });
    expect(flat[5]).toEqual({ x: 360, y: 180 });
  });
});

describe("meshSourceFlipXForPanel", () => {
  it("XORs calibration flip on right_sleeve when sleevesMirrored", () => {
    expect(meshSourceFlipXForPanel("right_sleeve", false, true)).toBe(true);
    expect(meshSourceFlipXForPanel("right_sleeve", true, true)).toBe(false);
    expect(meshSourceFlipXForPanel("right_sleeve", false, false)).toBe(false);
    expect(meshSourceFlipXForPanel("left_sleeve", false, true)).toBe(false);
    expect(meshSourceFlipXForPanel("left_sleeve", true, true)).toBe(true);
  });

  it("flips both leggings sides vs calibration; legsMirrored XORs left_side", () => {
    expect(meshSourceFlipXForPanel("left_side", false, false, false)).toBe(true);
    expect(meshSourceFlipXForPanel("right_side", false, false, false)).toBe(true);
    expect(meshSourceFlipXForPanel("left_side", true, false, false)).toBe(false);
    expect(meshSourceFlipXForPanel("left_side", false, false, true)).toBe(false);
    expect(meshSourceFlipXForPanel("right_side", false, false, true)).toBe(true);
  });

  it("Link-sides pattern symmetry XORs left_side the same as Mirror", () => {
    expect(meshSourceFlipXForPanel("left_side", false, false, false, true)).toBe(false);
    expect(meshSourceFlipXForPanel("right_side", false, false, false, true)).toBe(true);
  });
});

describe("leggingsPanelHorizontalArtCoverage", () => {
  const panel = { x: 100, y: 50, width: 200, height: 400 };
  const centeredBase = { x: 100, y: 150, width: 200, height: 200 };

  function rect(effective: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): DesignRectInfo {
    return {
      union: panel,
      base: centeredBase,
      effective,
      anchor: { x: 200, y: 250 },
      hasSeamPair: false,
      anchorIsSeam: false,
      seamAllowance: 0,
      groupId: "right-leg",
      enabled: true,
      rotationDeg: 0,
    };
  }

  it("stays at 1 when scale is high but art stays centered", () => {
    // 3× contain-fit centered: panel UV samples ~[0.33, 0.67] of the art.
    const eff = { x: 200 - 300, y: 250 - 300, width: 600, height: 600 };
    expect(leggingsPanelHorizontalArtCoverage(rect(eff))).toBeCloseTo(1, 5);
    expect(leggingsArtworkFallingOffUnseenSide([rect(eff)])).toBe(false);
  });

  it("drops when art is nudged so a panel edge samples past the art", () => {
    // At 3×, need a large X shift before a panel edge leaves artwork UV [0,1].
    const eff = { x: 200 - 300 - 250, y: 250 - 300, width: 600, height: 600 };
    const coverage = leggingsPanelHorizontalArtCoverage(rect(eff));
    expect(coverage).toBeLessThan(0.98);
    expect(leggingsArtworkFallingOffUnseenSide([rect(eff)])).toBe(true);
  });

  it("ignores disabled legs", () => {
    const eff = { x: 200 - 300 - 250, y: 250 - 300, width: 600, height: 600 };
    expect(
      leggingsArtworkFallingOffUnseenSide([{ ...rect(eff), enabled: false }]),
    ).toBe(false);
  });
});

describe("synthesiseLeggingsMirroredSourceRect", () => {
  it("maps each leg panel to the full artwork at scale 1 (matched copies)", () => {
    const panelBb = { x: 100, y: 50, width: 200, height: 400 };
    const fitted = { x: 100, y: 150, width: 200, height: 200 }; // square art in tall panel
    const groupRect: DesignRectInfo = {
      union: panelBb,
      base: fitted,
      effective: { ...fitted },
      anchor: { x: 200, y: 250 },
      hasSeamPair: false,
      anchorIsSeam: false,
      seamAllowance: 0,
      groupId: "legs",
      enabled: true,
      rotationDeg: 0,
    };
    // Tall artwork 200×400 — fits the panel exactly.
    const left = synthesiseLeggingsMirroredSourceRect(
      panelBb,
      groupRect,
      200,
      400,
    );
    const rightPanel = { x: 400, y: 50, width: 200, height: 400 };
    const right = synthesiseLeggingsMirroredSourceRect(
      rightPanel,
      groupRect,
      200,
      400,
    );
    // Both legs sample essentially the full artwork (matched size).
    expect(left.width).toBeCloseTo(200, 0);
    expect(left.height).toBeCloseTo(400, 0);
    expect(right.width).toBeCloseTo(200, 0);
    expect(right.height).toBeCloseTo(400, 0);
    expect(left.x).toBeCloseTo(right.x, 0);
    expect(left.y).toBeCloseTo(right.y, 0);
  });
});

describe("sleevePanelHalfSourceRect", () => {
  const W = 400;
  const H = 800;

  it("maps left sleeve front to left half and back to right half", () => {
    expect(sleevePanelHalfSourceRect("left_sleeve", "front", W, H)).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 800,
    });
    expect(sleevePanelHalfSourceRect("left_sleeve", "back", W, H)).toEqual({
      x: 200,
      y: 0,
      width: 200,
      height: 800,
    });
  });

  it("maps right sleeve front to right half and back to left half", () => {
    expect(sleevePanelHalfSourceRect("right_sleeve", "front", W, H)).toEqual({
      x: 200,
      y: 0,
      width: 200,
      height: 800,
    });
    expect(sleevePanelHalfSourceRect("right_sleeve", "back", W, H)).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 800,
    });
  });

  it("returns null for non-sleeve panels", () => {
    expect(sleevePanelHalfSourceRect("left_hood", "front", W, H)).toBeNull();
    expect(sleevePanelHalfSourceRect("back", "back", W, H)).toBeNull();
  });
});

describe("shouldComposePillowWrapPrintFile", () => {
  const suede = createFreshAopTemplate({
    name: "faux-suede-square-pillow",
    blueprintId: FAUX_SUEDE_PILLOW_WRAP_BLUEPRINT_ID,
  });
  const body = createFreshAopTemplate({
    name: "body-pillow",
    blueprintId: BODY_PILLOW_WRAP_BLUEPRINT_ID,
  });
  const zip = createFreshAopTemplate({
    name: "zip-hoodie",
    blueprintId: ZIP_HOODIE_BLUEPRINT_ID,
  });

  it("composes wrap-single pillows when catalog dims are missing", () => {
    expect(shouldComposePillowWrapPrintFile(suede)).toBe(true);
    expect(shouldComposePillowWrapPrintFile(body)).toBe(false);
    expect(shouldComposePillowWrapPrintFile(zip)).toBe(false);
  });

  it("sends separate front/back files when the catalog has a back placeholder", () => {
    expect(
      shouldComposePillowWrapPrintFile(suede, [
        { position: "front", width: 3000, height: 3000 },
        { position: "back", width: 3000, height: 3000 },
      ]),
    ).toBe(false);
  });

  it("stitches side-by-side when the only placeholder is a wide wrap canvas", () => {
    expect(
      shouldComposePillowWrapPrintFile(suede, [
        { position: "front", width: 6000, height: 3000 },
      ]),
    ).toBe(true);
    expect(
      shouldComposePillowWrapPrintFile(body, [
        { position: "front", width: 8000, height: 3000 },
      ]),
    ).toBe(true);
  });
});

describe("artworkSourceRectForPanel pocket vs chest", () => {
  it("maps a lower pocket mask to a lower slice of the same front-body rect", () => {
    const frontRect: DesignRectInfo = {
      union: { x: 100, y: 50, width: 400, height: 500 },
      base: { x: 100, y: 50, width: 400, height: 500 },
      effective: { x: 100, y: 50, width: 400, height: 500 },
      anchor: { x: 300, y: 300 },
      hasSeamPair: false,
      anchorIsSeam: false,
      seamAllowance: 0,
      groupId: "front-body",
      enabled: true,
      rotationDeg: 0,
    };
    const chest = artworkSourceRectForPanel(
      { x: 100, y: 50, width: 400, height: 400 },
      "front",
      frontRect,
      1000,
      2000,
      "none",
    );
    const pocket = artworkSourceRectForPanel(
      { x: 150, y: 350, width: 300, height: 180 },
      "front_pocket",
      frontRect,
      1000,
      2000,
      "none",
    );
    expect(pocket.y).toBeGreaterThan(chest.y);
    expect(pocket.y / 2000).toBeCloseTo((350 - 50) / 500, 5);
  });
});

describe("artworkSliceSamplesMural", () => {
  it("uses a 15% height-coverage threshold, not a 1px overlap", () => {
    expect(ARTWORK_SLICE_MIN_COVERAGE).toBe(0.15);
    // Fully inside — bridging / real pocket fill.
    expect(artworkSliceMuralCoverage({ x: 10, y: 10, width: 80, height: 80 }, 100, 100)).toBe(1);
    expect(artworkSliceSamplesMural({ x: 10, y: 10, width: 80, height: 80 }, 100, 100)).toBe(
      true,
    );
    // Past the mural — this design's pocket (artV > 1).
    expect(artworkSliceSamplesMural({ x: 0, y: 108, width: 100, height: 40 }, 100, 100)).toBe(
      false,
    );
    // Last-row sliver: 3% of a 200px window (the 6px-on-2048 warp case).
    expect(artworkSliceMuralCoverage({ x: 0, y: 97, width: 100, height: 100 }, 100, 100)).toBeCloseTo(
      0.03,
      5,
    );
    expect(artworkSliceSamplesMural({ x: 0, y: 97, width: 100, height: 100 }, 100, 100)).toBe(
      false,
    );
    // Just below threshold (14%) still skip; 15% draws.
    expect(artworkSliceSamplesMural({ x: 0, y: 86, width: 100, height: 100 }, 100, 100)).toBe(
      false,
    );
    expect(artworkSliceSamplesMural({ x: 0, y: 85, width: 100, height: 100 }, 100, 100)).toBe(
      true,
    );
    // Bridging: most of the window is mural, a little past the hem.
    expect(
      artworkSliceMuralCoverage({ x: 0, y: 70, width: 100, height: 40 }, 100, 100),
    ).toBeCloseTo(0.75, 5);
    expect(artworkSliceSamplesMural({ x: 0, y: 70, width: 100, height: 40 }, 100, 100)).toBe(
      true,
    );
  });
});

describe("clipSampleBbToSeamHalf / hood print overlap", () => {
  const union = { x: 0, y: 0, width: 200, height: 200 };
  const aw = 1000;
  const ah = 1000;

  function hoodRect(overrides: Partial<DesignRectInfo> = {}): DesignRectInfo {
    return {
      union,
      base: union,
      effective: union,
      anchor: { x: 100, y: 100 },
      hasSeamPair: true,
      anchorIsSeam: true,
      seamAllowance: 0.08,
      groupId: "hood",
      enabled: true,
      rotationDeg: 0,
      ...overrides,
    };
  }

  it("trims an overlapping left hood AABB at the garment seam, not artwork UV 0.5", () => {
    const overlapping = { x: 0, y: 0, width: 120, height: 200 };
    const clipped = clipSampleBbToSeamHalf(overlapping, hoodRect(), "left", "left_hood");
    expect(clipped.x + clipped.width).toBeLessThan(100);
    expect(clipped.width).toBeGreaterThan(50);

    const slice = artworkSourceRectForPanel(
      overlapping,
      "left_hood",
      hoodRect(),
      aw,
      ah,
      "left",
    );
    const unclippedSlice = artworkSourceRectForPanel(
      overlapping,
      "front",
      hoodRect({ hasSeamPair: false, seamAllowance: 0 }),
      aw,
      ah,
      "none",
    );
    expect(slice.width).toBeLessThan(unclippedSlice.width);
    expect(slice.width / aw).toBeGreaterThan(0.2);
  });

  it("does not half a solo hood whose union is the panel itself", () => {
    const solo = { x: 0, y: 0, width: 200, height: 200 };
    const rect = hoodRect({
      union: solo,
      base: solo,
      effective: solo,
      hasSeamPair: false,
      anchorIsSeam: false,
      seamAllowance: 0,
    });
    const clipped = clipSampleBbToSeamHalf(solo, rect, "left", "left_hood");
    expect(clipped).toEqual(solo);
  });

  it("keeps a usable slice when Place scale moves artwork UV 0.5 off the hood AABB", () => {
    // Regression: UV-clamping left panels to [0, 0.5] of `effective`
    // collapsed this to a ~0-width column → banded legs on the hood.
    const overlapping = { x: 0, y: 0, width: 120, height: 80 };
    const effective = { x: -80, y: 40, width: 360, height: 360 };
    const rect = hoodRect({
      effective,
      base: union,
      hasSeamPair: true,
      seamAllowance: 0.08,
    });
    const slice = artworkSourceRectForPanel(
      overlapping,
      "left_hood",
      rect,
      aw,
      ah,
      "left",
    );
    expect(slice.width / aw).toBeGreaterThan(0.15);
    expect(slice.height / ah).toBeGreaterThan(0.1);
  });
});
