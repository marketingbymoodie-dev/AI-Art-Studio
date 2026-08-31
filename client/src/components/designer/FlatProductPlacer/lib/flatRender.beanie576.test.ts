import { describe, expect, it, vi } from "vitest";
import {
  applyBeaniePreviewPlacementRect,
  clipFlatArtToPrintArea,
} from "./flatRender";

describe("576 beanie preview-only placement", () => {
  const rect = { x: 100, y: 100, width: 200, height: 200 };

  it("grows the placement rect 15% for blueprint 576 only", () => {
    const next = applyBeaniePreviewPlacementRect(576, rect);
    expect(next.width).toBeCloseTo(230, 5);
    expect(next.height).toBeCloseTo(230, 5);
    expect(next.x).toBeCloseTo(85, 5);
    expect(next.y).toBeCloseTo(85, 5);
  });

  it("does not change hood / tapestry / pullover rects", () => {
    expect(applyBeaniePreviewPlacementRect(450, rect)).toEqual(rect);
    expect(applyBeaniePreviewPlacementRect(241, rect)).toEqual(rect);
    expect(applyBeaniePreviewPlacementRect(null, rect)).toEqual(rect);
  });
});

describe("576 beanie clip skips harvest-rect destination-out", () => {
  it("full-canvas guide + mask does not erase a top inset band", () => {
    const fillRect = vi.fn();
    const actx = {
      globalCompositeOperation: "source-over" as GlobalCompositeOperation,
      fillStyle: "#000",
      fillRect,
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const mask = { naturalWidth: 1200, naturalHeight: 1200 } as HTMLImageElement;
    const mode = clipFlatArtToPrintArea(actx, {
      mask,
      rect: { x: 0, y: 0, width: 1200, height: 1200 },
      canvasW: 1200,
      canvasH: 1200,
    });
    expect(mode).toBe("mask+rect");
    expect(fillRect).not.toHaveBeenCalled();
  });
});
