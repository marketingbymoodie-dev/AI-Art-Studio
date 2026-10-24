import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  buildFlywheelPrintFile,
  fittedPrintPixels,
  placeOnPrintCanvas,
  printCanvasFromStoredPlaceholders,
  printFilePathForStyle,
} from "./flywheel-print-file";

/** The size a harvest is expected to store. The stage itself does not contain it. */
const HARVEST = { width: 3852, height: 4398 };

describe("flywheel print file", () => {
  it("names the style when the path is missing and does not return the source", async () => {
    const source = await sharp({
      create: { width: 8, height: 8, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    }).png().toBuffer();
    await expect(buildFlywheelPrintFile("conceptual-graphic", source, HARVEST)).rejects.toThrow("conceptual-graphic has no print path");
    await expect(buildFlywheelPrintFile("editorial-deadpan", source, HARVEST)).rejects.toThrow("editorial-deadpan has no print path");
  });

  it("assigns vectorize and upscale to the launch six", () => {
    expect(printFilePathForStyle("woodcut")).toBe("vectorize");
    expect(printFilePathForStyle("folk-graphic")).toBe("vectorize");
    expect(printFilePathForStyle("bold-type")).toBe("vectorize");
    expect(printFilePathForStyle("pen-ink")).toBe("vectorize");
    expect(printFilePathForStyle("vintage-engraving")).toBe("upscale");
    expect(printFilePathForStyle("retro-character")).toBe("upscale");
  });

  it("reads the front print area from the stored harvest and rejects a type with none", () => {
    expect(printCanvasFromStoredPlaceholders([{ position: "front", width: 3852, height: 4398 }, { position: "back", width: 100, height: 100 }], "Unisex Softstyle T-Shirt")).toEqual(HARVEST);
    expect(printCanvasFromStoredPlaceholders(JSON.stringify([{ position: "front", width: "3852", height: "4398" }]), "Unisex Softstyle T-Shirt")).toEqual(HARVEST);
    expect(() => printCanvasFromStoredPlaceholders([], "Unisex Softstyle T-Shirt")).toThrow("Unisex Softstyle T-Shirt has no stored front print area");
    expect(() => printCanvasFromStoredPlaceholders([{ position: "back", width: 3852, height: 4398 }], "Unisex Softstyle T-Shirt")).toThrow("Unisex Softstyle T-Shirt has no stored front print area");
    expect(() => printCanvasFromStoredPlaceholders([], "")).toThrow("needs the product type name");
  });

  it("fits with one scale and does not stretch a tall image to the print canvas", () => {
    const fitted = fittedPrintPixels(1000, 2000, HARVEST);
    expect(fitted.height).toBe(HARVEST.height);
    expect(fitted.width).toBe(Math.round(1000 * (HARVEST.height / 2000)));
    expect(fitted.width / fitted.height).toBeCloseTo(0.5, 3);
    expect(fitted.width).not.toBe(HARVEST.width);
  });

  it("keeps a wide image inside the print canvas without cropping the aspect", () => {
    const fitted = fittedPrintPixels(2000, 1000, HARVEST);
    expect(fitted.width).toBe(HARVEST.width);
    expect(fitted.height).toBeLessThan(HARVEST.height);
    expect(fitted.width / fitted.height).toBeCloseTo(2, 2);
  });

  it("fits a square source to the canvas width and leaves the height short", () => {
    const fitted = fittedPrintPixels(1024, 1024, HARVEST);
    expect(fitted.width).toBe(HARVEST.width);
    expect(fitted.height).toBe(HARVEST.width);
    expect(fitted.height).not.toBe(HARVEST.height);
  });

  it("centers the artwork on the print canvas without changing its aspect", async () => {
    const source = await sharp({
      create: { width: 100, height: 200, channels: 4, background: { r: 200, g: 20, b: 20, alpha: 1 } },
    }).png().toBuffer();
    const canvas = { width: 400, height: 456 };
    const placed = await placeOnPrintCanvas(source, canvas);
    const meta = await sharp(placed).metadata();
    expect(meta.width).toBe(canvas.width);
    expect(meta.height).toBe(canvas.height);
    const { data, info } = await sharp(placed).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let minX = info.width;
    let minY = info.height;
    let maxX = 0;
    let maxY = 0;
    for (let y = 0; y < info.height; y += 4) {
      for (let x = 0; x < info.width; x += 4) {
        const alpha = data[(y * info.width + x) * info.channels + 3];
        if (alpha < 10) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    const inkW = maxX - minX;
    const inkH = maxY - minY;
    expect(inkW / inkH).toBeCloseTo(0.5, 1);
    expect(inkH).toBeGreaterThan(canvas.height * 0.9);
    expect(inkW).toBeLessThan(canvas.width * 0.7);
  });
});
