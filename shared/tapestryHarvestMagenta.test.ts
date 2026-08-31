import { describe, expect, it } from "vitest";
import {
  expandTapestryMagentaMask,
  isLooseTapestryMagenta,
  isStrictHarvestMagenta,
} from "./tapestryHarvestMagenta";

function rgba(w: number, h: number): Uint8ClampedArray {
  return new Uint8ClampedArray(w * h * 4);
}

function setRgb(
  data: Uint8ClampedArray,
  w: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
) {
  const i = (y * w + x) * 4;
  data[i] = r;
  data[i + 1] = g;
  data[i + 2] = b;
  data[i + 3] = 255;
}

describe("isStrictHarvestMagenta", () => {
  it("keeps the historical hood/poster box", () => {
    expect(isStrictHarvestMagenta(255, 0, 255)).toBe(true);
    expect(isStrictHarvestMagenta(171, 94, 171)).toBe(true);
    expect(isStrictHarvestMagenta(140, 40, 140)).toBe(false);
  });
});

describe("isLooseTapestryMagenta", () => {
  it("accepts shaded rod-corner magenta that fails the strict box", () => {
    expect(isLooseTapestryMagenta(140, 40, 140)).toBe(true);
    expect(isLooseTapestryMagenta(110, 50, 130)).toBe(true);
  });

  it("rejects studio neutrals and greens", () => {
    expect(isLooseTapestryMagenta(200, 200, 200)).toBe(false);
    expect(isLooseTapestryMagenta(40, 180, 40)).toBe(false);
    expect(isLooseTapestryMagenta(20, 10, 20)).toBe(false);
  });
});

describe("expandTapestryMagentaMask", () => {
  it("recovers a connected shaded top-right corner from strict seeds", () => {
    const w = 16;
    const h = 16;
    const data = rgba(w, h);
    for (let y = 4; y < 12; y++) {
      for (let x = 4; x < 12; x++) {
        setRgb(data, w, x, y, 255, 0, 255);
      }
    }
    // Top-right of the print: shaded magenta (strict miss).
    setRgb(data, w, 12, 4, 140, 40, 140);
    setRgb(data, w, 13, 4, 130, 45, 135);
    setRgb(data, w, 12, 5, 125, 50, 128);

    const out = expandTapestryMagentaMask(data, w, h, 4);
    expect(out.maskRaw[(4 * w + 12) * 4 + 3]).toBe(255);
    expect(out.maskRaw[(4 * w + 13) * 4 + 3]).toBe(255);
    expect(out.maxX).toBe(13);
  });

  it("does not keep isolated studio pink away from the print blob", () => {
    const w = 16;
    const h = 16;
    const data = rgba(w, h);
    for (let y = 4; y < 10; y++) {
      for (let x = 4; x < 10; x++) {
        setRgb(data, w, x, y, 255, 0, 255);
      }
    }
    setRgb(data, w, 14, 1, 140, 40, 140);
    const out = expandTapestryMagentaMask(data, w, h, 4);
    expect(out.maskRaw[(1 * w + 14) * 4 + 3]).toBe(0);
    expect(out.maxX).toBe(9);
  });
});
