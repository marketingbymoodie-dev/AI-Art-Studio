import { describe, expect, it, vi } from "vitest";
import { clipFlatArtToPrintArea } from "./flatRender";

function mockCtx() {
  const calls: Array<{ op?: string; fillRect?: number[] }> = [];
  const actx = {
    globalCompositeOperation: "source-over" as GlobalCompositeOperation,
    fillStyle: "#000",
    fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
      calls.push({ fillRect: [x, y, w, h] });
    }),
    drawImage: vi.fn(),
  };
  return { actx: actx as unknown as CanvasRenderingContext2D, calls, raw: actx };
}

describe("clipFlatArtToPrintArea", () => {
  it("hard-clips to placement rect when mask is null (wall-decal catalog blanks)", () => {
    const { actx, calls, raw } = mockCtx();
    const rect = { x: 100, y: 50, width: 200, height: 400 };
    const mode = clipFlatArtToPrintArea(actx, {
      mask: null,
      rect,
      canvasW: 1024,
      canvasH: 1024,
    });
    expect(mode).toBe("rect");
    expect(raw.fillRect).toHaveBeenCalledWith(100, 50, 200, 400);
    expect(calls.some((c) => c.fillRect)).toBe(true);
    expect(raw.globalCompositeOperation).toBe("source-over");
  });

  it("uses pixel mask then erases the four margins outside the guide rect", () => {
    const { actx, raw } = mockCtx();
    const mask = { naturalWidth: 1024, naturalHeight: 1024 } as HTMLImageElement;
    const mode = clipFlatArtToPrintArea(actx, {
      mask,
      rect: { x: 10, y: 20, width: 100, height: 200 },
      canvasW: 1024,
      canvasH: 1024,
    });
    expect(mode).toBe("mask+rect");
    expect(raw.drawImage).toHaveBeenCalled();
    // destination-out margin erases: left, right, top, bottom of the rect.
    expect(raw.fillRect).toHaveBeenCalledWith(0, 0, 10, 1024); // left
    expect(raw.fillRect).toHaveBeenCalledWith(110, 0, 1024 - 110, 1024); // right
    expect(raw.fillRect).toHaveBeenCalledWith(0, 0, 1024, 20); // top
    expect(raw.fillRect).toHaveBeenCalledWith(0, 220, 1024, 1024 - 220); // bottom
    expect(raw.globalCompositeOperation).toBe("source-over");
  });

  it("skips margin erases that would be zero-sized (guide spans full canvas)", () => {
    const { actx, raw } = mockCtx();
    const mask = { naturalWidth: 512, naturalHeight: 512 } as HTMLImageElement;
    const mode = clipFlatArtToPrintArea(actx, {
      mask,
      rect: { x: 0, y: 0, width: 512, height: 512 },
      canvasW: 512,
      canvasH: 512,
    });
    expect(mode).toBe("mask+rect");
    expect(raw.fillRect).not.toHaveBeenCalled();
  });
});
