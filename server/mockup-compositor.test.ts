import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { renderArtworkOnPanel } from "./mockup-library";
import {
  compositePlacedInk,
  inkRegionPercentile92,
  shadingModulateFactor,
} from "./mockup-compositor";

const GARMENTS: Array<[string, number, number, number]> = [
  ["white", 255, 255, 255],
  ["light grey", 0x97, 0x99, 0x9b],
  ["sage", 0x81, 0x9e, 0x87],
  ["red", 0xac, 0x2b, 0x37],
  ["black", 0x25, 0x28, 0x2a],
];

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number } {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    if (h < 0) h += 6;
    h *= 60;
  }
  return { h, s: max === 0 ? 0 : d / max };
}

function circularSpread(degrees: number[]): number {
  let worst = 0;
  for (let i = 0; i < degrees.length; i++) {
    for (let j = i + 1; j < degrees.length; j++) {
      const d = Math.abs(degrees[i] - degrees[j]) % 360;
      worst = Math.max(worst, Math.min(d, 360 - d));
    }
  }
  return worst;
}

function flatRgba(w: number, h: number, r: number, g: number, b: number): Buffer {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = 255;
  }
  return buf;
}

describe("mockup compositor ink", () => {
  it("keeps white ink within 6 levels across garment colours", () => {
    const width = 24;
    const height = 24;
    const shading = flatRgba(width, height, 230, 230, 230);
    const inkW = 12;
    const inkH = 12;
    const ink = flatRgba(inkW, inkH, 255, 255, 255);
    const left = 6;
    const top = 6;
    const p92s = GARMENTS.map(([, r, g, b]) => {
      const garment = flatRgba(width, height, r, g, b);
      const out = compositePlacedInk({
        garment,
        shading,
        width,
        height,
        ink,
        inkWidth: inkW,
        inkHeight: inkH,
        left,
        top,
      });
      return inkRegionPercentile92(out, width, ink, inkW, inkH, left, top);
    });

    for (const channel of ["r", "g", "b"] as const) {
      const levels = p92s.map((p) => p[channel]);
      const spread = Math.max(...levels) - Math.min(...levels);
      expect(spread).toBeLessThanOrEqual(6);
    }
  });

  it("keeps saturated ink hue and saturation across garment colours", () => {
    const width = 24;
    const height = 24;
    const shading = flatRgba(width, height, 230, 230, 230);
    const inkW = 12;
    const inkH = 12;
    // Ginger orange, well clear of the red hue wrap. S is about 0.84.
    const ink = flatRgba(inkW, inkH, 196, 78, 32);
    const left = 6;
    const top = 6;
    const samples = GARMENTS.map(([, r, g, b]) => {
      const out = compositePlacedInk({
        garment: flatRgba(width, height, r, g, b),
        shading,
        width,
        height,
        ink,
        inkWidth: inkW,
        inkHeight: inkH,
        left,
        top,
      });
      const o = ((top + 6) * width + (left + 6)) * 4;
      return rgbToHsv(out[o], out[o + 1], out[o + 2]);
    });

    expect(Math.min(...samples.map((s) => s.s))).toBeGreaterThan(0.6);
    const hues = samples.map((s) => s.h);
    const sats = samples.map((s) => s.s);
    expect(circularSpread(hues)).toBeLessThanOrEqual(3);
    expect(Math.max(...sats) - Math.min(...sats)).toBeLessThanOrEqual(0.03);
  });

  it("blends alpha 0.5 as normal alpha and clamps the 20–40 band at 30", () => {
    const width = 8;
    const height = 8;
    const shading = flatRgba(width, height, 230, 230, 230);
    const inkRgb = { r: 196, g: 78, b: 32 };
    const half = Buffer.alloc(4);
    half[0] = inkRgb.r;
    half[1] = inkRgb.g;
    half[2] = inkRgb.b;
    half[3] = 128;
    for (const [, gr, gg, gb] of GARMENTS) {
      const out = compositePlacedInk({
        garment: flatRgba(width, height, gr, gg, gb),
        shading,
        width,
        height,
        ink: half,
        inkWidth: 1,
        inkHeight: 1,
        left: 1,
        top: 1,
      });
      const o = (1 * width + 1) * 4;
      const expected = rgbToHsv(
        Math.round(inkRgb.r * 0.5 + gr * 0.5),
        Math.round(inkRgb.g * 0.5 + gg * 0.5),
        Math.round(inkRgb.b * 0.5 + gb * 0.5),
      );
      const actual = rgbToHsv(out[o], out[o + 1], out[o + 2]);
      expect(Math.abs(out[o] - Math.round(inkRgb.r * 0.5 + gr * 0.5))).toBeLessThanOrEqual(1);
      expect(Math.abs(out[o + 1] - Math.round(inkRgb.g * 0.5 + gg * 0.5))).toBeLessThanOrEqual(1);
      expect(Math.abs(out[o + 2] - Math.round(inkRgb.b * 0.5 + gb * 0.5))).toBeLessThanOrEqual(1);
      expect(circularSpread([actual.h, expected.h])).toBeLessThanOrEqual(3);
      expect(Math.abs(actual.s - expected.s)).toBeLessThanOrEqual(0.03);
    }

    const low = Buffer.from(half);
    low[3] = 20;
    const high = Buffer.from(half);
    high[3] = 40;
    const garment = flatRgba(width, height, 0x25, 0x28, 0x2a);
    const dropped = compositePlacedInk({
      garment,
      shading,
      width,
      height,
      ink: low,
      inkWidth: 1,
      inkHeight: 1,
      left: 1,
      top: 1,
    });
    const kept = compositePlacedInk({
      garment,
      shading,
      width,
      height,
      ink: high,
      inkWidth: 1,
      inkHeight: 1,
      left: 1,
      top: 1,
    });
    const o = (1 * width + 1) * 4;
    expect([dropped[o], dropped[o + 1], dropped[o + 2]]).toEqual([0x25, 0x28, 0x2a]);
    expect(kept[o]).not.toBe(0x25);
  });

  it("does not shear when the fitted artwork is one pixel narrower than requested", async () => {
    const artW = 868;
    const artH = 1425;
    const rgba = Buffer.alloc(artW * artH * 4);
    const paint = (x: number, y: number) => {
      const o = (y * artW + x) * 4;
      rgba[o] = 255;
      rgba[o + 1] = 255;
      rgba[o + 2] = 255;
      rgba[o + 3] = 255;
    };
    for (let y = 0; y < artH; y++) {
      for (let x = 430; x < 438; x++) paint(x, y);
    }
    for (let x = 0; x < artW; x++) {
      paint(x, 0);
      paint(x, artH - 1);
    }
    for (let y = 0; y < artH; y++) {
      paint(0, y);
      paint(artW - 1, y);
    }
    const artwork = await sharp(rgba, { raw: { width: artW, height: artH, channels: 4 } }).png().toBuffer();
    const requestedWidth = 324;
    const requestedHeight = 531;
    const fittedBuf = await sharp(artwork).resize(requestedWidth, requestedHeight, { fit: "inside" }).png().toBuffer();
    const fitted = await sharp(fittedBuf).metadata();
    expect(fitted.width).toBe(requestedWidth - 1);
    expect(fitted.height).toBe(requestedHeight);

    const photoW = 1400;
    const photoH = 1240;
    const photo = await sharp({
      create: { width: photoW, height: photoH, channels: 3, background: { r: 0x97, g: 0x99, b: 0x9b } },
    }).png().toBuffer();
    const mask = await sharp({
      create: { width: photoW, height: photoH, channels: 3, background: { r: 255, g: 255, b: 255 } },
    }).png().toBuffer();
    const png = await renderArtworkOnPanel({
      photo,
      maskPng: mask,
      artwork,
      mode: "produced",
      hex: "97999B",
    });
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const white: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const o = (y * info.width + x) * 4;
        if (data[o] > 220 && data[o + 1] > 220 && data[o + 2] > 220) white.push({ x, y });
      }
    }
    expect(white.length).toBeGreaterThan(100);
    const minY = Math.min(...white.map((p) => p.y));
    const maxY = Math.max(...white.map((p) => p.y));
    const body = white.filter((point) => point.y > minY + 2 && point.y < maxY - 2);
    const medianX = body.map((point) => point.x).sort((a, b) => a - b)[Math.floor(body.length / 2)];
    const byY = new Map<number, number[]>();
    for (const point of body) {
      if (Math.abs(point.x - medianX) > 8) continue;
      const row = byY.get(point.y) || [];
      row.push(point.x);
      byY.set(point.y, row);
    }
    const rows = [...byY.entries()].sort((a, b) => a[0] - b[0]);
    expect(rows.length).toBeGreaterThan(40);
    const centers: number[] = [];
    for (const [, xs] of rows) {
      xs.sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeLessThanOrEqual(2);
      centers.push(xs[Math.floor(xs.length / 2)]);
    }
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(1);
  });

  it("uses fold variation around the shading median, not a garment scale", () => {
    expect(shadingModulateFactor(219, 219)).toBeCloseTo(1, 5);
    const brighter = shadingModulateFactor(240, 219);
    expect(brighter).toBeGreaterThan(1);
    expect(brighter).toBeLessThan(1.2);
  });
});
