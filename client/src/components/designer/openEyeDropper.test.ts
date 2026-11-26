import { describe, expect, it } from "vitest";
import {
  clampToRect,
  clientPointToSnapshotPixel,
  followArtworkPoint,
  hexFromRgb,
  sampleSnapshotHex,
  shadeSpectrum,
  type CanvasSnapshot,
} from "./openEyeDropper";

function snap(pixels: number[][]): CanvasSnapshot {
  const height = pixels.length;
  const width = pixels[0]?.length ?? 0;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const [r, g, b, a = 255] = pixels[y][x];
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { data, width, height };
}

describe("artwork eyedropper sampling", () => {
  it("maps a client point to a snapshot pixel", () => {
    const rect = { left: 100, top: 50, width: 200, height: 100 } as DOMRect;
    const image = snap([
      [[255, 0, 0], [0, 255, 0]],
      [[0, 0, 255], [255, 255, 0]],
    ]);
    expect(clientPointToSnapshotPixel(100, 50, rect, image)).toEqual({ x: 0, y: 0 });
    expect(clientPointToSnapshotPixel(199, 99, rect, image)).toEqual({ x: 0, y: 0 });
    expect(clientPointToSnapshotPixel(250, 120, rect, image)).toEqual({ x: 1, y: 1 });
    expect(clientPointToSnapshotPixel(50, 50, rect, image)).toBeNull();
  });

  it("samples opaque pixels and skips near-clear ones", () => {
    const image = snap([
      [
        [17, 34, 51, 255],
        [9, 9, 9, 4],
      ],
    ]);
    expect(sampleSnapshotHex(image, 0, 0)).toBe("#112233");
    expect(sampleSnapshotHex(image, 1, 0)).toBeNull();
  });

  it("damps follow so the loupe eases toward the pointer", () => {
    const next = followArtworkPoint(0, 0, 100, 50, 0.2);
    expect(next.x).toBeCloseTo(20);
    expect(next.y).toBeCloseTo(10);
  });

  it("clamps the sample point to the canvas rect", () => {
    const rect = { left: 10, top: 20, right: 110, bottom: 120 };
    expect(clampToRect(0, 0, rect)).toEqual({ x: 10.5, y: 20.5 });
    expect(clampToRect(200, 200, rect)).toEqual({ x: 109.5, y: 119.5 });
  });

  it("formats rgb as uppercase hex", () => {
    expect(hexFromRgb(255, 128, 0)).toBe("#FF8000");
  });

  it("builds a darker-to-lighter spectrum around the picked colour", () => {
    const shades = shadeSpectrum("#C45A3A");
    expect(shades.length).toBeGreaterThanOrEqual(3);
    expect(shades).toContain("#C45A3A");
    const mid = shades.indexOf("#C45A3A");
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(shades.length - 1);
  });
});
