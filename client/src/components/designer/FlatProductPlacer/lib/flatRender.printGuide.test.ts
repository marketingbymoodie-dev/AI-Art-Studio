import { describe, expect, it } from "vitest";
import { expandPrintGuideToPrintFileAspect } from "./flatRender";

describe("expandPrintGuideToPrintFileAspect", () => {
  const canvasW = 1000;
  const canvasH = 1200;

  it("grows a short magenta AABB to printFileDims aspect (keep width/X)", () => {
    // Harvested chest box: wider than tall; Printify placeholder is taller.
    const rect = { x: 300, y: 400, width: 400, height: 280 };
    const pf = { width: 4500, height: 5400 }; // AR 0.833 → targetH = 400 * 1.2 = 480
    const next = expandPrintGuideToPrintFileAspect(rect, pf, canvasW, canvasH);
    expect(next.width).toBe(400);
    expect(next.x).toBe(300);
    expect(next.height).toBeCloseTo(480, 5);
    expect(next.y + next.height / 2).toBeCloseTo(400 + 140, 5);
  });

  it("is a no-op when AABB is already tall enough", () => {
    const rect = { x: 300, y: 200, width: 400, height: 500 };
    const pf = { width: 4500, height: 5400 }; // targetH = 480 < 500
    expect(expandPrintGuideToPrintFileAspect(rect, pf, canvasW, canvasH)).toEqual(
      rect,
    );
  });

  it("clamps to mockup when expanded height would leave the canvas", () => {
    const rect = { x: 300, y: 50, width: 400, height: 200 };
    const pf = { width: 1000, height: 3000 }; // targetH = 1200 = full canvas
    const next = expandPrintGuideToPrintFileAspect(rect, pf, canvasW, canvasH);
    expect(next.y).toBe(0);
    expect(next.height).toBe(canvasH);
    expect(next.width).toBe(400);
  });

  it("returns input when printFileDims missing", () => {
    const rect = { x: 10, y: 20, width: 100, height: 50 };
    expect(expandPrintGuideToPrintFileAspect(rect, null, canvasW, canvasH)).toEqual(
      rect,
    );
  });
});
