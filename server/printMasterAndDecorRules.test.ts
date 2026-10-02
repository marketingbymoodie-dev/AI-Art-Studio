// @vitest-environment node
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { toLosslessPrintMaster } from "./print-master";
import { FULL_BLEED_WALL_ART, PRINT_ARTWORK_OUTPUT, SUBJECT_INTEGRITY, withDirectGeminiDecorRules } from "./direct-gemini-decor";
import { resolveGenerationPlan, type DirectGoogleImagePath } from "./generation-providers";

async function noisyJpeg(width: number, height: number) {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 37 + ((i / 3) | 0) % 251) & 255;
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
}

describe("lossless print master", () => {
  it("turns a JPEG-origin 2K output into a PNG master cropped to product aspect with identical pixels", async () => {
    const jpeg = await noisyJpeg(2400, 1792);
    const master = await toLosslessPrintMaster(jpeg, 11 / 8);
    const meta = await sharp(master.buffer).metadata();
    expect(meta.format).toBe("png");
    expect([meta.width, meta.height]).toEqual([2400, 1745]);
    expect(master.cropped).toBe(true);
    // Same pixels as decoding the provider JPEG and cropping — no second lossy encode.
    const top = Math.round((1792 - 1745) / 2);
    const expected = await sharp(jpeg).extract({ left: 0, top, width: 2400, height: 1745 }).raw().toBuffer();
    const actual = await sharp(master.buffer).removeAlpha().raw().toBuffer();
    expect(Buffer.compare(actual, expected)).toBe(0);
  });

  it("never upscales and still stores PNG when no crop is needed", async () => {
    const jpeg = await noisyJpeg(1024, 1024);
    const master = await toLosslessPrintMaster(jpeg, null);
    const meta = await sharp(master.buffer).metadata();
    expect(meta.format).toBe("png");
    expect([meta.width, meta.height]).toEqual([1024, 1024]);
    expect(master.cropped).toBe(false);
  });
});

describe("direct-Gemini decor output rules", () => {
  it("prepend print-artwork + subject-integrity rules; full-bleed rule only for wall art", () => {
    const creative = "Full-bleed, edge-to-edge composition.\n\nPRODUCT RENDERER — WALL ART: …";
    const wall = withDirectGeminiDecorRules(creative, { fullBleedWallArt: true });
    expect(wall.startsWith(PRINT_ARTWORK_OUTPUT)).toBe(true);
    expect(wall).toContain(SUBJECT_INTEGRITY);
    expect(wall).toContain(FULL_BLEED_WALL_ART);
    expect(wall.endsWith(creative)).toBe(true); // creative text untouched, after the rules
    const pillow = withDirectGeminiDecorRules(creative, { fullBleedWallArt: false });
    expect(pillow).not.toContain(FULL_BLEED_WALL_ART);
    expect(pillow).toContain(SUBJECT_INTEGRITY);
  });

  it("poster and tapestry are full-bleed wall art; pillow and bedding are not", () => {
    const fam = (productFamily: string) =>
      (resolveGenerationPlan({ packProfileKey: "petposterous", productFamily, isApparel: false }).imagePath as DirectGoogleImagePath)
        .fullBleedWallArt;
    expect([fam("poster"), fam("tapestry"), fam("pillow"), fam("bedding")]).toEqual([true, true, false, false]);
  });
});
