import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { edgeEnergy } from "@shared/myPetQuality";
import { pasteEditedPet } from "./my-pet-quality";

async function rawEnergy(png: Buffer): Promise<number> {
  const decoded = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return edgeEnergy(new Uint8Array(decoded.data), decoded.info.width || 1, decoded.info.height || 1);
}

describe("My Pet image path", () => {
  it("keeps a hard edge through PNG compression and softens it when the preview downscales", async () => {
    const width = 40;
    const height = 8;
    const raw = Buffer.alloc(width * height * 4);
    for (let i = 0; i < raw.length; i += 4) {
      const x = (i / 4) % width;
      const on = x < 8;
      raw[i] = on ? 0 : 255;
      raw[i + 1] = on ? 0 : 255;
      raw[i + 2] = on ? 0 : 255;
      raw[i + 3] = 255;
    }
    const png = await sharp(raw, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
    const stored = await rawEnergy(png);
    const original = await rawEnergy(await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer());
    const downscaled = await sharp(png).resize(16, 4, { fit: "fill", kernel: "lanczos3" }).png().toBuffer();
    const small = await rawEnergy(downscaled);
    expect(stored).toBeCloseTo(original, 5);
    expect(small).toBeLessThan(original);
  });

  it("pastes only the pet box and leaves the rest of the original artwork", async () => {
    const original = await sharp({
      create: { width: 8, height: 8, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } },
    }).png().toBuffer();
    const edited = await sharp({
      create: { width: 8, height: 8, channels: 4, background: { r: 200, g: 0, b: 0, alpha: 1 } },
    }).png().toBuffer();
    const pasted = await pasteEditedPet(original, edited, {
      x: 0.5, y: 0.5, w: 0.5, h: 0.5, nudgeX: 0, nudgeY: 0, nudgeW: 0, nudgeH: 0, letteringOverlapsPet: false,
    });
    const decoded = await sharp(pasted).ensureAlpha().raw().toBuffer();
    expect(decoded[0]).toBe(10);
    const inside = (4 * 8 + 4) * 4;
    expect(decoded[inside]).toBe(200);
  });
});
