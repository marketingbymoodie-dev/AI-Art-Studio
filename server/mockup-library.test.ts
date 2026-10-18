import { describe, expect, it } from "vitest";
import {
  MASK_BACKGROUND_MAX_MEAN,
  backgroundAgrees,
  clipSceneMasks,
  describeWhiteSegment,
  missingPanelMessage,
  printRectForMask,
  resolvePanelColour,
  segmentGarmentNearHex,
} from "./mockup-library";

describe("mockup library", () => {
  it("copies a dark mask only when the size matches and the background is within 5", () => {
    expect(MASK_BACKGROUND_MAX_MEAN).toBe(5);
    const white = new Uint8Array([250, 250, 250, 255, 20, 20, 20, 255]);
    const mask = new Uint8Array([1, 0]);
    const within = new Uint8Array([250, 250, 250, 255, 25, 25, 25, 255]);
    const over = new Uint8Array([250, 250, 250, 255, 26, 26, 26, 255]);
    expect(backgroundAgrees(white, within, mask, 2, 1, 2, 1)).toEqual({ agree: true, mean: 5 });
    expect(backgroundAgrees(white, over, mask, 2, 1, 2, 1).agree).toBe(false);
    expect(backgroundAgrees(white, within, mask, 2, 1, 1, 2)).toEqual({ agree: false, mean: null });
  });

  it("prefers a produced colourway and names a missing panel", () => {
    const colours = [
      { name: "White", hex: "FFFFFF", kind: "white-master" as const },
      { name: "Sage", hex: "819E87", kind: "produced" as const },
    ];
    expect(resolvePanelColour(colours, { name: "White", hex: "FFFFFF" }, "Softstyle", 54, "Rope and sneakers").kind).toBe("produced");
    expect(resolvePanelColour(colours, { name: "Sage", hex: "819E87" }, "Softstyle", 54, "Rope and sneakers").kind).toBe("produced");
    expect(resolvePanelColour(colours, { name: "Black", hex: "25282A" }, "Softstyle", 54, "Rope and sneakers").kind).toBe("recolour");
    expect(() => resolvePanelColour(
      [{ name: "Sage", hex: "819E87", kind: "produced" }],
      { name: "Black", hex: "25282A" },
      "Unisex Softstyle T-Shirt",
      54,
      "Rope and sneakers",
    )).toThrow(missingPanelMessage("Black", "Unisex Softstyle T-Shirt", 54, "Rope and sneakers"));
  });

  it("places the print rect as fractions of mask height", () => {
    const w = 100;
    const h = 200;
    const mask = new Uint8Array(w * h);
    for (let y = 20; y < 120; y++) {
      for (let x = 30; x < 70; x++) mask[y * w + x] = 1;
    }
    const rect = printRectForMask(mask, w, h);
    expect(rect.height).toBe(Math.round(0.5041 * 100));
    expect(rect.width).toBe(Math.round(0.4415 * 100));
    expect(rect.top).toBe(20 + Math.round(0.2074 * 100));
    expect(Math.abs(rect.left + rect.width / 2 - 49.5)).toBeLessThan(1);
  });

  it("segments a coloured garment from its hex and leaves the tan mat out", () => {
    const w = 48;
    const h = 48;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      rgba[o] = 161;
      rgba[o + 1] = 110;
      rgba[o + 2] = 77;
      rgba[o + 3] = 255;
    }
    for (let y = 8; y < 40; y++) {
      for (let x = 8; x < 36; x++) {
        const o = (y * w + x) * 4;
        rgba[o] = y < 14 ? 110 : 172;
        rgba[o + 1] = y < 14 ? 28 : 43;
        rgba[o + 2] = y < 14 ? 36 : 55;
      }
    }
    const seg = segmentGarmentNearHex(rgba, w, h, "AC2B37");
    expect(seg.touchesEdge).toBe(false);
    expect(seg.disconnected).toBe(false);
    expect(seg.mask[0]).toBe(0);
    expect(seg.mask[20 * w + 20]).toBe(1);
    const rect = printRectForMask(seg.mask, w, h);
    expect(rect.height).toBeGreaterThan(10);
    expect(rect.top).toBeGreaterThan(8);
  });

  it("keeps the white lightness rule and flags a mask that touches the frame", () => {
    const w = 80;
    const h = 80;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      rgba[o] = 180;
      rgba[o + 1] = 120;
      rgba[o + 2] = 70;
      rgba[o + 3] = 255;
    }
    for (let y = 16; y < 64; y++) {
      for (let x = 0; x < 48; x++) {
        const o = (y * w + x) * 4;
        rgba[o] = 250;
        rgba[o + 1] = 250;
        rgba[o + 2] = 250;
      }
    }
    const seg = describeWhiteSegment(rgba, w, h);
    expect(seg.mask[32 * w + 12]).toBe(1);
    expect(seg.mask[79 * w + 79]).toBe(0);
    expect(seg.touchesEdge).toBe(true);
  });

  it("clips an oversized mask to the passing union and refuses a scene with no reference", () => {
    const w = 30;
    const h = 30;
    const square = () => {
      const mask = new Uint8Array(w * h);
      for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) mask[y * w + x] = 1;
      return mask;
    };
    const oversized = square();
    for (let y = 20; y < 30; y++) for (let x = 0; x < 16; x++) oversized[y * w + x] = 1;
    const clipped = clipSceneMasks(
      [
        { key: "sage", mask: square() },
        { key: "pink", mask: square() },
        { key: "blue", mask: square() },
        { key: "black", mask: oversized },
      ],
      w,
      h,
    );
    expect(clipped.ok).toBe(true);
    if (!clipped.ok) return;
    const black = clipped.rows.find((row) => row.key === "black");
    expect(black?.clipped).toBe(true);
    expect(black?.areaFraction).toBeCloseTo(100 / 900, 5);
    expect(clipped.rows.every((row) => Math.abs(row.areaFraction - 100 / 900) <= 0.12)).toBe(true);
    const tiny = new Uint8Array(w * h);
    tiny[0] = 1;
    const huge = new Uint8Array(w * h);
    huge.fill(1);
    expect(clipSceneMasks([{ key: "a", mask: tiny }, { key: "b", mask: huge }], w, h).ok).toBe(false);
  });
});
