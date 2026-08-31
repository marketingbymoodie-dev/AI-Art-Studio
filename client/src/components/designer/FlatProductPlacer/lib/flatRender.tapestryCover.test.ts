import { describe, expect, it } from "vitest";
import {
  ART_COVER_ALPHA,
  MASK_ALPHA_OVERFLOW_THRESHOLD,
  MASK_ALPHA_THRESHOLD,
  maskCoreOutlineFromRgba,
  maskCoreUncoveredFromRgba,
  pointInMask,
  tapestryCoverageSampleStep,
  TAPESTRY_COVERAGE_MAX_STEP_PX,
  TAPESTRY_COVERAGE_MIN_AXIS,
} from "./flatRender";

function rgba(w: number, h: number, fillA: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4 + 3] = fillA;
  }
  return data;
}

function setAlpha(
  data: Uint8ClampedArray,
  w: number,
  x: number,
  y: number,
  a: number,
) {
  data[(y * w + x) * 4 + 3] = a;
}

describe("pointInMask (shared overflow + 241 lookup)", () => {
  const w = 10;
  const h = 10;
  const data = rgba(w, h, 0);
  setAlpha(data, w, 4, 4, 200);
  setAlpha(data, w, 5, 5, 16);
  setAlpha(data, w, 6, 6, 128);

  it("overflow threshold: alpha 16 is outside (historical <= 16)", () => {
    expect(
      pointInMask(data, w, h, 5.2, 5.2, w, h, MASK_ALPHA_OVERFLOW_THRESHOLD + 1),
    ).toBe(false);
  });

  it("overflow threshold: alpha 200 is inside", () => {
    expect(
      pointInMask(data, w, h, 4.2, 4.2, w, h, MASK_ALPHA_OVERFLOW_THRESHOLD + 1),
    ).toBe(true);
  });

  it("core threshold 128 treats feather (80) as outside and 128 as inside", () => {
    setAlpha(data, w, 2, 2, 80);
    expect(pointInMask(data, w, h, 2.2, 2.2, w, h, MASK_ALPHA_THRESHOLD)).toBe(
      false,
    );
    expect(pointInMask(data, w, h, 6.2, 6.2, w, h, MASK_ALPHA_THRESHOLD)).toBe(
      true,
    );
  });

  it("out of canvas is not in the mask", () => {
    expect(pointInMask(data, w, h, -1, 4, w, h, MASK_ALPHA_THRESHOLD)).toBe(
      false,
    );
    expect(pointInMask(data, w, h, 10, 4, w, h, MASK_ALPHA_THRESHOLD)).toBe(
      false,
    );
  });
});

describe("tapestryCoverageSampleStep", () => {
  it("never exceeds 2 mockup px and is at least 256 samples on a 1024 AABB", () => {
    const step = tapestryCoverageSampleStep(1024, 1024);
    expect(step).toBeLessThanOrEqual(TAPESTRY_COVERAGE_MAX_STEP_PX);
    expect(1024 / step).toBeGreaterThanOrEqual(TAPESTRY_COVERAGE_MIN_AXIS);
    // 2px on a 1024 catalog blank ≈ 3.0 mm on 50×60 (60") and ≈ 5.2 mm on 104".
    const mmOn50x60 = (60 * 25.4 * step) / 1024;
    expect(mmOn50x60).toBeLessThanOrEqual(6);
  });
});

describe("maskCoreUncoveredFromRgba", () => {
  const w = 64;
  const h = 64;
  const bounds = { x: 10, y: 10, width: 40, height: 40 };

  it("stays quiet when every core mask pixel is covered by opaque art", () => {
    const mask = rgba(w, h, 0);
    const art = rgba(w, h, 0);
    for (let y = 12; y < 48; y++) {
      for (let x = 12; x < 48; x++) {
        setAlpha(mask, w, x, y, 255);
        setAlpha(art, w, x, y, 255);
      }
    }
    expect(
      maskCoreUncoveredFromRgba(mask, w, h, art, w, h, w, h, bounds, 1),
    ).toBe(false);
  });

  it("ignores a feather rim (alpha 80) so a soft edge is not a perpetual gap", () => {
    const mask = rgba(w, h, 0);
    const art = rgba(w, h, 0);
    for (let y = 10; y < 50; y++) {
      for (let x = 10; x < 50; x++) {
        const core = x >= 12 && x < 48 && y >= 12 && y < 48;
        setAlpha(mask, w, x, y, core ? 255 : 80);
        if (core) setAlpha(art, w, x, y, 255);
      }
    }
    expect(
      maskCoreUncoveredFromRgba(mask, w, h, art, w, h, w, h, bounds, 1),
    ).toBe(false);
  });

  it("fires on a 2px bare strip along one edge (thin-gap)", () => {
    const mask = rgba(w, h, 0);
    const art = rgba(w, h, 0);
    for (let y = 12; y < 48; y++) {
      for (let x = 12; x < 48; x++) {
        setAlpha(mask, w, x, y, 255);
        if (x >= 14) setAlpha(art, w, x, y, 255);
      }
    }
    expect(
      maskCoreUncoveredFromRgba(mask, w, h, art, w, h, w, h, bounds, 2),
    ).toBe(true);
  });

  it("fires on a bare corner (droop convex region)", () => {
    const mask = rgba(w, h, 0);
    const art = rgba(w, h, 0);
    for (let y = 12; y < 48; y++) {
      for (let x = 12; x < 48; x++) {
        setAlpha(mask, w, x, y, 255);
        setAlpha(art, w, x, y, 255);
      }
    }
    for (let y = 12; y < 16; y++) {
      for (let x = 12; x < 16; x++) {
        setAlpha(art, w, x, y, 0);
      }
    }
    expect(
      maskCoreUncoveredFromRgba(mask, w, h, art, w, h, w, h, bounds, 1),
    ).toBe(true);
  });

  it("does not treat art alpha 10 as coverage", () => {
    const mask = rgba(w, h, 0);
    const art = rgba(w, h, 0);
    setAlpha(mask, w, 20, 20, 255);
    setAlpha(art, w, 20, 20, ART_COVER_ALPHA);
    expect(
      maskCoreUncoveredFromRgba(
        mask,
        w,
        h,
        art,
        w,
        h,
        w,
        h,
        { x: 18, y: 18, width: 6, height: 6 },
        1,
      ),
    ).toBe(true);
  });
});

describe("maskCoreOutlineFromRgba (241 dashed droop)", () => {
  it("traces a filled rect and stays inside the core AABB", () => {
    const w = 32;
    const h = 32;
    const mask = rgba(w, h, 0);
    for (let y = 8; y < 24; y++) {
      for (let x = 6; x < 26; x++) {
        setAlpha(mask, w, x, y, 255);
      }
    }
    const pts = maskCoreOutlineFromRgba(mask, w, h, w, h);
    expect(pts).toBeTruthy();
    expect(pts!.length).toBeGreaterThan(4);
    for (const p of pts!) {
      expect(p.x).toBeGreaterThanOrEqual(5);
      expect(p.x).toBeLessThanOrEqual(27);
      expect(p.y).toBeGreaterThanOrEqual(7);
      expect(p.y).toBeLessThanOrEqual(25);
    }
  });

  it("ignores feather (alpha 80) so the outline hugs core printable, not the ramp", () => {
    const w = 24;
    const h = 24;
    const mask = rgba(w, h, 0);
    for (let y = 4; y < 20; y++) {
      for (let x = 4; x < 20; x++) {
        const core = x >= 6 && x < 18 && y >= 6 && y < 18;
        setAlpha(mask, w, x, y, core ? 255 : 80);
      }
    }
    const pts = maskCoreOutlineFromRgba(mask, w, h, w, h);
    expect(pts).toBeTruthy();
    for (const p of pts!) {
      expect(p.x).toBeGreaterThanOrEqual(5);
      expect(p.x).toBeLessThanOrEqual(19);
      expect(p.y).toBeGreaterThanOrEqual(5);
      expect(p.y).toBeLessThanOrEqual(19);
    }
  });

  it("returns null for an empty mask", () => {
    const w = 8;
    const h = 8;
    expect(maskCoreOutlineFromRgba(rgba(w, h, 0), w, h, w, h)).toBeNull();
  });
});
