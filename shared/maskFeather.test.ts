import { describe, expect, it } from "vitest";
import {
  featherMaskAlphaFromRgba,
  maskAlphaLooksBinary,
  TAPESTRY_MASK_FEATHER_RADIUS_PX,
} from "./maskFeather";

function hardRect(w: number, h: number, x0: number, y0: number, x1: number, y1: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 255;
    }
  }
  return data;
}

describe("maskAlphaLooksBinary", () => {
  it("detects a hard magenta mask", () => {
    expect(maskAlphaLooksBinary(hardRect(16, 16, 4, 4, 12, 12), 16, 16)).toBe(true);
  });

  it("detects an already-soft ramp", () => {
    const data = hardRect(16, 16, 4, 4, 12, 12);
    for (let x = 3; x < 13; x++) {
      data[(4 * 16 + x) * 4 + 3] = 80;
    }
    expect(maskAlphaLooksBinary(data, 16, 16)).toBe(false);
  });
});

describe("featherMaskAlphaFromRgba", () => {
  it("keeps the core at 255 and adds a mid-alpha perimeter", () => {
    const w = 32;
    const h = 32;
    const src = hardRect(w, h, 8, 8, 24, 24);
    const out = featherMaskAlphaFromRgba(src, w, h, TAPESTRY_MASK_FEATHER_RADIUS_PX);
    expect(out[(16 * w + 16) * 4 + 3]).toBeGreaterThanOrEqual(200);
    let mid = 0;
    for (let i = 0; i < w * h; i++) {
      const a = out[i * 4 + 3];
      if (a > 10 && a < 200) mid += 1;
    }
    expect(mid).toBeGreaterThan(8);
  });

  it("does not invent alpha far from the silhouette", () => {
    const w = 32;
    const h = 32;
    const src = hardRect(w, h, 8, 8, 24, 24);
    const out = featherMaskAlphaFromRgba(src, w, h, 2);
    expect(out[(1 * w + 1) * 4 + 3]).toBeLessThan(8);
  });
});
