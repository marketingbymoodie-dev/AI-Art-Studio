import { describe, expect, it } from "vitest";
import {
  buildFlatMeshTargetPoints,
  meshSourceFlipXForPanel,
  sleevePanelHalfSourceRect,
  synthesiseLeggingsMirroredSourceRect,
  type DesignRectInfo,
} from "./aopPreview";

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
