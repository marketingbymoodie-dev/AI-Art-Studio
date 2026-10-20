import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  SOFTSTYLE_PRINT_PX,
  buildFlywheelPrintFile,
  fittedPrintPixels,
  placeOnPrintCanvas,
  printFilePathForStyle,
} from "./flywheel-print-file";

describe("flywheel print file", () => {
  it("names the style when the path is missing and does not return the source", async () => {
    const source = await sharp({
      create: { width: 8, height: 8, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    }).png().toBuffer();
    await expect(buildFlywheelPrintFile("conceptual-graphic", source)).rejects.toThrow("conceptual-graphic has no print path");
    await expect(buildFlywheelPrintFile("editorial-deadpan", source)).rejects.toThrow("editorial-deadpan has no print path");
  });

  it("assigns vectorize and upscale to the launch six", () => {
    expect(printFilePathForStyle("woodcut")).toBe("vectorize");
    expect(printFilePathForStyle("folk-graphic")).toBe("vectorize");
    expect(printFilePathForStyle("bold-type")).toBe("vectorize");
    expect(printFilePathForStyle("pen-ink")).toBe("vectorize");
    expect(printFilePathForStyle("vintage-engraving")).toBe("upscale");
    expect(printFilePathForStyle("retro-character")).toBe("upscale");
  });

  it("fits with one scale and does not stretch a tall image to the print canvas", () => {
    const fitted = fittedPrintPixels(1000, 2000);
    expect(fitted.height).toBe(SOFTSTYLE_PRINT_PX.height);
    expect(fitted.width).toBe(Math.round(1000 * (SOFTSTYLE_PRINT_PX.height / 2000)));
    expect(fitted.width / fitted.height).toBeCloseTo(0.5, 3);
    expect(fitted.width).not.toBe(SOFTSTYLE_PRINT_PX.width);
  });

  it("keeps a wide image inside the print canvas without cropping the aspect", () => {
    const fitted = fittedPrintPixels(2000, 1000);
    expect(fitted.width).toBe(SOFTSTYLE_PRINT_PX.width);
    expect(fitted.height).toBeLessThan(SOFTSTYLE_PRINT_PX.height);
    expect(fitted.width / fitted.height).toBeCloseTo(2, 2);
  });

  it("centers the artwork on the print canvas without changing its aspect", async () => {
    const source = await sharp({
      create: { width: 100, height: 200, channels: 4, background: { r: 200, g: 20, b: 20, alpha: 1 } },
    }).png().toBuffer();
    const placed = await placeOnPrintCanvas(source);
    const meta = await sharp(placed).metadata();
    expect(meta.width).toBe(SOFTSTYLE_PRINT_PX.width);
    expect(meta.height).toBe(SOFTSTYLE_PRINT_PX.height);
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
    expect(inkH).toBeGreaterThan(SOFTSTYLE_PRINT_PX.height * 0.9);
    expect(inkW).toBeLessThan(SOFTSTYLE_PRINT_PX.width * 0.7);
  });
});
