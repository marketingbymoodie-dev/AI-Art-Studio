import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { compositeFillBehindNativeAlpha } from "./compositeFillBehind";

async function rgbaAt(
  buffer: Buffer,
  x: number,
  y: number,
): Promise<{ r: number; g: number; b: number; a: number }> {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
}

async function transparentCircleOnClear(size = 32): Promise<Buffer> {
  const raw = Buffer.alloc(size * size * 4, 0);
  const cx = Math.floor(size / 2);
  const cy = Math.floor(size / 2);
  const r = 6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) {
        const i = (y * size + x) * 4;
        raw[i] = 20;
        raw[i + 1] = 40;
        raw[i + 2] = 200;
        raw[i + 3] = 255;
      }
    }
  }
  return sharp(raw, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
}

describe("compositeFillBehindNativeAlpha", () => {
  it("paints the chosen fill behind transparent pixels and flattens", async () => {
    const src = await transparentCircleOnClear();
    const out = await compositeFillBehindNativeAlpha(src, "#FFFFFF");
    const corner = await rgbaAt(out, 0, 0);
    const center = await rgbaAt(out, 16, 16);
    expect(corner).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    expect(center.r).toBe(20);
    expect(center.g).toBe(40);
    expect(center.b).toBe(200);
    expect(center.a).toBe(255);
  });

  it("none leaves transparent pixels transparent", async () => {
    const src = await transparentCircleOnClear();
    const out = await compositeFillBehindNativeAlpha(src, "none");
    const corner = await rgbaAt(out, 0, 0);
    expect(corner.a).toBe(0);
  });
});
