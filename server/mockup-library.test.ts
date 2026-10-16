import { describe, expect, it } from "vitest";
import {
  MASK_BACKGROUND_MAX_MEAN,
  backgroundAgrees,
  missingPanelMessage,
  printRectForMask,
  resolvePanelColour,
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
});
