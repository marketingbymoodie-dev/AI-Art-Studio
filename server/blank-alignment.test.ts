import { describe, expect, it } from "vitest";
import { measureGarmentAlignment } from "./blank-alignment";

function frame(shiftX = 0): { master: Uint8Array; upload: Uint8Array; mask: Uint8Array } {
  const w = 24;
  const h = 24;
  const master = new Uint8Array(w * h * 4);
  const upload = new Uint8Array(w * h * 4);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const shirt = x >= 6 && x < 18 && y >= 4 && y < 20;
      const o = (y * w + x) * 4;
      const shade = shirt ? 230 - (y - 4) * 4 : 40;
      master[o] = master[o + 1] = master[o + 2] = shade;
      master[o + 3] = 255;
      if (shirt) mask[y * w + x] = 1;
      const x2 = x - shiftX;
      const shirt2 = x2 >= 6 && x2 < 18 && y >= 4 && y < 20;
      const shade2 = shirt2 ? 180 - (y - 4) * 3 : 40;
      upload[o] = shade2 + 20;
      upload[o + 1] = shade2;
      upload[o + 2] = shade2 - 10;
      upload[o + 3] = 255;
    }
  }
  return { master, upload, mask };
}

describe("blank alignment", () => {
  it("reports a matched shirt as aligned", () => {
    const { master, upload, mask } = frame(0);
    const report = measureGarmentAlignment(master, upload, mask, 24, 24);
    expect(report.shiftX).toBe(0);
    expect(report.shiftY).toBe(0);
    expect(report.edgeOffsetPx).toBeLessThanOrEqual(3);
    expect(report.warning).toBeNull();
    expect(report.overlap).toBe(1);
  });

  it("warns when the shirt has moved more than a few pixels", () => {
    const { master, upload, mask } = frame(6);
    const report = measureGarmentAlignment(master, upload, mask, 24, 24);
    expect(Math.abs(report.shiftX)).toBeGreaterThan(3);
    expect(report.warning).toMatch(/wrong place/);
    expect(report.overlap).toBeLessThan(0.9);
  });
});