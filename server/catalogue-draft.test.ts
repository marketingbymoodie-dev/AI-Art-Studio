import fs from "fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { catalogueVisionImage } from "./catalogue-draft";

const PLAYGROUND = "C:\\Users\\young\\OneDrive\\Desktop\\PETPOSTEROUS\\First 100 Designs\\Cat fishing bowl\\OpenAI Playground 2026-10-24 at 09.56.10.png";

async function pixel(buf: Buffer, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

describe("catalogue vision image", () => {
  it("lays transparent pixels on middle grey and leaves white ink white", async () => {
    const source = await sharp({
      create: { width: 2, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{
        input: await sharp({
          create: { width: 1, height: 1, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
        }).png().toBuffer(),
        left: 0,
        top: 0,
      }])
      .png()
      .toBuffer();

    const vision = await catalogueVisionImage(source);
    expect(await pixel(vision, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(await pixel(vision, 1, 0)).toEqual([128, 128, 128, 255]);
    expect(source.equals(vision)).toBe(false);
  });

  it("keeps opaque ink off the grey plate", async () => {
    const source = await sharp({
      create: { width: 1, height: 1, channels: 3, background: { r: 10, g: 20, b: 30 } },
    }).png().toBuffer();
    const vision = await catalogueVisionImage(source);
    expect((await pixel(vision, 0, 0)).slice(0, 3)).toEqual([10, 20, 30]);
  });

  it("makes the white-on-transparent playground file readable without changing the original", async () => {
    if (!fs.existsSync(PLAYGROUND)) return;
    const source = fs.readFileSync(PLAYGROUND);
    const before = Buffer.from(source);
    const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let transparent = 0;
    let white = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) transparent += 1;
      else if (data[i] > 250 && data[i + 1] > 250 && data[i + 2] > 250 && data[i + 3] > 250) white += 1;
    }
    expect(transparent).toBeGreaterThan(0);
    expect(white).toBeGreaterThan(0);

    const vision = await catalogueVisionImage(source);
    const out = await sharp(vision).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let stillClear = 0;
    let grey = 0;
    let stillWhite = 0;
    for (let i = 0; i < out.data.length; i += 4) {
      if (out.data[i + 3] < 255) stillClear += 1;
      if (out.data[i] === 128 && out.data[i + 1] === 128 && out.data[i + 2] === 128) grey += 1;
      if (out.data[i] > 250 && out.data[i + 1] > 250 && out.data[i + 2] > 250) stillWhite += 1;
    }
    expect(out.info.width).toBeGreaterThan(0);
    expect(stillClear).toBe(0);
    expect(grey).toBeGreaterThan(0);
    expect(stillWhite).toBeGreaterThan(0);
    expect(before.equals(source)).toBe(true);
    expect(info.width).toBeGreaterThan(0);
  });
});
