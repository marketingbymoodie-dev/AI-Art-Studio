import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { bakeFlatPrintFile, prepareBakeUploadBuffer } from "./flat-print-file";

async function rgbaAt(
  buffer: Buffer,
  x: number,
  y: number,
): Promise<{ r: number; g: number; b: number; a: number }> {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
}

async function motifOnClear(): Promise<Buffer> {
  const size = 32;
  const raw = Buffer.alloc(size * size * 4, 0);
  for (let y = 12; y < 20; y++) {
    for (let x = 12; x < 20; x++) {
      const i = (y * size + x) * 4;
      raw[i] = 20;
      raw[i + 1] = 40;
      raw[i + 2] = 200;
      raw[i + 3] = 255;
    }
  }
  return sharp(raw, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
}

describe("bakeFlatPrintFile color-only bleed", () => {
  it("fills the existing print-file edge and leaves the subject unmoved", async () => {
    const art = await motifOnClear();
    const placement = { scale: 0.4, offsetX: 0, offsetY: 0, rotationDeg: 0 };
    const printFileDims = { width: 200, height: 200 };
    const none = await bakeFlatPrintFile({
      artworkBuffer: art,
      placement,
      printFileDims,
      backgroundColor: null,
    });
    const filled = await bakeFlatPrintFile({
      artworkBuffer: art,
      placement,
      printFileDims,
      backgroundColor: "#E11D48",
    });
    expect(filled.width).toBe(none.width);
    expect(filled.height).toBe(none.height);
    const corner = await rgbaAt(filled.buffer, 1, 1);
    expect(corner).toEqual({ r: 225, g: 29, b: 72, a: 255 });
    const far = await rgbaAt(filled.buffer, 198, 198);
    expect(far).toEqual({ r: 225, g: 29, b: 72, a: 255 });
    const noneCorner = await rgbaAt(none.buffer, 1, 1);
    expect(noneCorner.a).toBe(0);

    const noneCenter = await rgbaAt(none.buffer, 100, 100);
    const filledCenter = await rgbaAt(filled.buffer, 100, 100);
    expect(filledCenter.r).toBe(noneCenter.r);
    expect(filledCenter.g).toBe(noneCenter.g);
    expect(filledCenter.b).toBe(noneCenter.b);
  });

  it("bakes flat artwork with no blank shading or mask composite", async () => {
    const raw = Buffer.alloc(16 * 16 * 4, 255);
    for (let i = 0; i < 16 * 16; i++) {
      raw[i * 4] = 220;
      raw[i * 4 + 1] = 30;
      raw[i * 4 + 2] = 30;
    }
    const art = await sharp(raw, { raw: { width: 16, height: 16, channels: 4 } }).png().toBuffer();
    const baked = await bakeFlatPrintFile({
      artworkBuffer: art,
      placement: { scale: 1, offsetX: 0, offsetY: 0 },
      printFileDims: { width: 16, height: 16 },
    });
    const px = await rgbaAt(baked.buffer, 8, 8);
    expect(px.r).toBeGreaterThan(200);
    expect(px.g).toBeLessThan(50);
    expect(px.b).toBeLessThan(50);
    expect(px.a).toBe(255);
  });
});

describe("prepareBakeUploadBuffer", () => {
  it("passes through small PNGs unchanged", async () => {
    const small = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();
    const out = await prepareBakeUploadBuffer(small);
    expect(out.ext).toBe("png");
    expect(out.contentType).toBe("image/png");
    expect(out.buffer.length).toBe(small.length);
  });

  it("compresses oversized buffers under the soft max", async () => {
    // Uncompressible random noise at large dimensions → huge PNG.
    const noise = Buffer.alloc(4800 * 7200 * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 37 + 11) % 256;
    const huge = await sharp(noise, { raw: { width: 4800, height: 7200, channels: 3 } })
      .png({ compressionLevel: 0 })
      .toBuffer();
    expect(huge.length).toBeGreaterThan(28 * 1024 * 1024);

    const out = await prepareBakeUploadBuffer(huge);
    expect(out.buffer.length).toBeLessThanOrEqual(28 * 1024 * 1024);
    expect(["png", "jpg"]).toContain(out.ext);
  }, 60_000);
});
