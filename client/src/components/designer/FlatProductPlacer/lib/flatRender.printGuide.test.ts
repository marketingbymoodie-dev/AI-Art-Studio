import { describe, expect, it } from "vitest";
import {
  expandPrintGuideToPrintFileAspect,
  flatPlacementRectPx,
  scaleRectToCanvas,
  FLAT_APPAREL_PRINT_GUIDE_HEIGHT_BOOST,
} from "./flatRender";
import type { FlatViewCalibration } from "@/pages/embed-design";

describe("scaleRectToCanvas", () => {
  it("maps mask-native bounds into blank/canvas pixels", () => {
    const native = { x: 100, y: 200, width: 400, height: 600 };
    const next = scaleRectToCanvas(native, 1000, 1000, 2000, 2000);
    expect(next).toEqual({ x: 200, y: 400, width: 800, height: 1200 });
  });
});

describe("expandPrintGuideToPrintFileAspect", () => {
  const canvasW = 1000;
  const canvasH = 1200;

  it("grows height by overscan boost even when printFileDims AR already matches", () => {
    // AABB already matches print AR — previous fix was a no-op; boost still grows.
    const rect = { x: 300, y: 400, width: 400, height: 480 };
    const pf = { width: 4500, height: 5400 }; // same AR as 400×480
    const next = expandPrintGuideToPrintFileAspect(rect, pf, canvasW, canvasH);
    expect(next.width).toBe(400);
    expect(next.x).toBe(300);
    expect(next.height).toBeCloseTo(480 * FLAT_APPAREL_PRINT_GUIDE_HEIGHT_BOOST, 5);
    // Most of the growth goes upward (smaller y).
    expect(next.y).toBeLessThan(rect.y);
  });

  it("uses the taller of boost vs printFileDims aspect", () => {
    const rect = { x: 300, y: 400, width: 400, height: 280 };
    const pf = { width: 4500, height: 5400 }; // aspect → 480; boost → 280*1.18
    const next = expandPrintGuideToPrintFileAspect(rect, pf, canvasW, canvasH);
    expect(next.height).toBeCloseTo(480, 5);
  });

  it("clamps to mockup when expanded height would leave the canvas", () => {
    const rect = { x: 300, y: 50, width: 400, height: 200 };
    const pf = { width: 1000, height: 3000 };
    const next = expandPrintGuideToPrintFileAspect(rect, pf, canvasW, canvasH);
    expect(next.y).toBe(0);
    expect(next.height).toBe(canvasH);
    expect(next.width).toBe(400);
  });

  it("still boosts when printFileDims missing", () => {
    const rect = { x: 10, y: 20, width: 100, height: 50 };
    const next = expandPrintGuideToPrintFileAspect(rect, null, canvasW, canvasH);
    expect(next.height).toBeCloseTo(50 * FLAT_APPAREL_PRINT_GUIDE_HEIGHT_BOOST, 5);
    expect(next.y).toBeLessThan(rect.y);
  });
});

describe("flatPlacementRectPx 759 Preview Studio fallback", () => {
  const canvasW = 1000;
  const canvasH = 1000;
  const harvest = { x: 200, y: 150, width: 600, height: 500 };
  const view = {
    visibleRectNormalized: {
      x: harvest.x / canvasW,
      y: harvest.y / canvasH,
      width: harvest.width / canvasW,
      height: harvest.height / canvasH,
    },
    printFileDims: { width: 1800, height: 2400 },
  } as FlatViewCalibration;

  it("does not apply apparel 1.2 boost when 759 has no mask", () => {
    const next = flatPlacementRectPx(view, null, canvasW, canvasH, {
      skipApparelPrintGuideBoost: true,
    });
    expect(next).toEqual(harvest);
  });

  it("still applies apparel 1.2 boost when no-mask fallback is not skipped", () => {
    const next = flatPlacementRectPx(view, null, canvasW, canvasH, {});
    const apparel = expandPrintGuideToPrintFileAspect(
      harvest,
      view.printFileDims,
      canvasW,
      canvasH,
    );
    expect(next).toEqual(apparel);
    expect(next.height).toBeGreaterThan(harvest.height);
  });
});
