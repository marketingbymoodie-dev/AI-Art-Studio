import { describe, expect, it } from "vitest";
import {
  MASK_BACKGROUND_MAX_MEAN,
  backgroundAgrees,
  chooseSceneReference,
  describeWhiteSegment,
  printifyPlacementForInk,
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

  it("uses the first chromatic file that is one shirt-sized region", () => {
    const w = 80;
    const h = 80;
    const paint = (hex: [number, number, number], x0: number, y0: number, x1: number, y1: number) => {
      const rgba = new Uint8Array(w * h * 4);
      rgba.fill(255);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4;
          rgba[o] = 214;
          rgba[o + 1] = 186;
          rgba[o + 2] = 148;
          rgba[o + 3] = 255;
        }
      }
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (y * w + x) * 4;
          rgba[o] = hex[0];
          rgba[o + 1] = hex[1];
          rgba[o + 2] = hex[2];
        }
      }
      return rgba;
    };
    const chosen = chooseSceneReference([
      { hex: "819E87", rgba: paint([129, 158, 135], 30, 10, 36, 16), width: w, height: h },
      { hex: "DD74A1", rgba: paint([221, 116, 161], 18, 16, 62, 68), width: w, height: h },
      { hex: "25282A", rgba: paint([37, 40, 42], 18, 16, 62, 68), width: w, height: h },
    ]);
    expect(chosen?.hex).toBe("DD74A1");
    expect(chosen && chosen.areaFraction > 0.2).toBe(true);
    expect(chooseSceneReference([
      { hex: "819E87", rgba: paint([129, 158, 135], 30, 10, 36, 16), width: w, height: h },
    ])).toBeNull();
  });

  it("sends a centred print rect to Printify as centre with the ink width as the scale", () => {
    const placed = printifyPlacementForInk({ left: 100, top: 200, width: 400, height: 500 }, 120, 250, 360, 400);
    expect(placed.x).toBeCloseTo(0, 5);
    expect(placed.y).toBeCloseTo(0, 5);
    expect(placed.scale).toBeCloseTo(0.9, 5);
  });
});
