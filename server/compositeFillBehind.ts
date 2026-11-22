import sharp from "sharp";
import type { DecorBackgroundFill } from "@shared/decorBackgroundFill";

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/**
 * Composite a solid fill behind native alpha, then flatten to opaque PNG.
 * `none` keeps transparency (PNG). Never chroma-keys.
 */
export async function compositeFillBehindNativeAlpha(
  imageBuffer: Buffer,
  fill: DecorBackgroundFill,
): Promise<Buffer> {
  const fg = sharp(imageBuffer).ensureAlpha();
  const meta = await fg.metadata();
  const width = meta.width || 1;
  const height = meta.height || 1;
  const fgPng = await fg.png().toBuffer();

  if (fill === "none") {
    return fgPng;
  }

  const { r, g, b } = hexToRgb(fill);
  const bg = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r, g, b, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  return sharp(bg)
    .composite([{ input: fgPng, blend: "over" }])
    .flatten({ background: { r, g, b } })
    .png()
    .toBuffer();
}
