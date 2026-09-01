import { describe, expect, it, vi } from "vitest";
import {
  applyBeaniePreviewPlacementRect,
  clipFlatArtToPrintArea,
  flatArtBox,
  flatDefaultPlacementScale,
  flatOverflows,
  flatShouldFitToSafeArea,
} from "./flatRender";
import { flatArtFitForBlueprint } from "@shared/hoodieTemplate";

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

describe("576 beanie contain-fit", () => {
  const square = { x: 0, y: 0, width: 200, height: 200 };
  const tallArt = { w: 100, h: 200 };
  const place = { scale: 1, offsetX: 0, offsetY: 0, rotationDeg: 0 };

  it("contain-fits tall art inside the print rect — no top/bottom crop", () => {
    const box = flatArtBox(square, place, tallArt.w, tallArt.h, "contain");
    expect(box.width).toBeCloseTo(100, 5);
    expect(box.height).toBeCloseTo(200, 5);
    expect(box.x).toBeCloseTo(50, 5);
    expect(box.y).toBeCloseTo(0, 5);
    expect(flatOverflows(square, box, 0.5)).toBe(false);
  });

  it("cover still crops tall art (non-contain flats); 241 is contain", () => {
    const box = flatArtBox(square, place, tallArt.w, tallArt.h, "cover");
    expect(box.width).toBeCloseTo(200, 5);
    expect(box.height).toBeCloseTo(400, 5);
    expect(flatOverflows(square, box, 0.5)).toBe(true);
    expect(flatArtFitForBlueprint(241)).toBe("contain");
  });

  it("+15% preview grows the contain box but does not overflow the display rect", () => {
    const harvest = { x: 20, y: 20, width: 160, height: 160 };
    const display = applyBeaniePreviewPlacementRect(576, harvest);
    const box = flatArtBox(display, place, tallArt.w, tallArt.h, "contain");
    expect(box.height).toBeCloseTo(display.height, 5);
    expect(box.width).toBeCloseTo(display.height / 2, 5);
    expect(flatOverflows(display, box, 0.5)).toBe(false);
    expect(box.height).toBeGreaterThan(harvest.height);
  });

  it("skips cover-relative first-open fit and seeds scale 1", () => {
    expect(flatShouldFitToSafeArea({ blueprintId: 576 })).toBe(false);
    expect(flatDefaultPlacementScale({ blueprintId: 576 })).toBe(1);
    expect(flatShouldFitToSafeArea({ probeCatalogGuide: true })).toBe(false);
    expect(flatDefaultPlacementScale({ probeCatalogGuide: true })).toBe(1);
  });
});

describe("576 beanie clip restores dome destination-in on art+fill", () => {
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
    expect(actx.drawImage).toHaveBeenCalled();
  });
});
