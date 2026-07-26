import { describe, expect, it } from "vitest";
import {
  bakeArtworkPlacementRotation,
  buildFlatMeshTargetPoints,
  leggingsArtworkFallingOffUnseenSide,
  leggingsPanelHorizontalArtCoverage,
  meshSourceFlipXForPanel,
  normalizeRotationDeg,
  printPanelOutputScale,
  sleevePanelHalfSourceRect,
  synthesiseLeggingsMirroredSourceRect,
  type DesignRectInfo,
} from "./aopPreview";

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
});

describe("buildFlatMeshTargetPoints", () => {
  it("maps mesh corners to the full flat canvas", () => {
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
    const flat = buildFlatMeshTargetPoints(mesh, 400, 200);
    expect(flat).toHaveLength(6);
    expect(flat[0]).toEqual({ x: 0, y: 0 });
    expect(flat[2]).toEqual({ x: 400, y: 0 });
    expect(flat[3]).toEqual({ x: 0, y: 200 });
    expect(flat[5]).toEqual({ x: 400, y: 200 });
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
