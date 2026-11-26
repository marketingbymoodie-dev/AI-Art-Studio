import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildToteFoldedPrintPng } from "./toteFoldedPrintFile";
import { TOTE_FOLDED_CANVAS_HEIGHT, TOTE_FOLDED_CANVAS_WIDTH } from "@shared/toteFoldedLayout";

async function rgbaAt(
  buffer: Buffer,
  x: number,
  y: number,
): Promise<{ r: number; g: number; b: number; a: number }> {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
}

describe("tote folded bake fill", () => {
  it("paints the existing 2650×5250 canvas and does not resize it", async () => {
    const art = await sharp({
      create: { width: 16, height: 16, channels: 4, background: { r: 10, g: 20, b: 200, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const out = await buildToteFoldedPrintPng(art, { scale: 0.2, offsetX: 0, offsetY: 0 }, "#00AA55");
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(TOTE_FOLDED_CANVAS_WIDTH);
    expect(meta.height).toBe(TOTE_FOLDED_CANVAS_HEIGHT);
    const corner = await rgbaAt(out, 2, 2);
    expect(corner).toEqual({ r: 0, g: 170, b: 85, a: 255 });
  });
});
