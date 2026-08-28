import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { processApparelMotif } from "./apparel-matting";
import {
  FIXTURE_SIZE,
  paintFixture,
} from "./__tests__/fixtures/chroma/paintChromaFixtures";

async function alphaAt(buffer: Buffer, x: number, y: number): Promise<number> {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const idx = (y * info.width + x) * info.channels;
  return data[idx + 3];
}

async function run(name: Parameters<typeof paintFixture>[0]) {
  const src = await paintFixture(name);
  return processApparelMotif(src, {
    useMlFallback: false,
    allowWhiteKey: true,
    vectorize: false,
  });
}

describe("WP2 Ticket 1 — Pass C skip on magenta canvas", () => {
  it("keeps a bright metal head that touches the #FF00FF plate", async () => {
    const { buffer } = await run("bird-head-touches-plate");
    const meta = await sharp(buffer).metadata();
    // trimTransparentBounds may crop; sample relative to the remaining canvas.
    const w = meta.width ?? FIXTURE_SIZE;
    const h = meta.height ?? FIXTURE_SIZE;
    // Head sat at (40, 26) on the 80×80 source — after an 8px trim pad the
    // opaque metal (head + body) should still have an opaque pixel in the
    // upper half (head) and lower half (body).
    let upperOpaque = 0;
    let lowerOpaque = 0;
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if (data[(y * info.width + x) * info.channels + 3] < 128) continue;
        if (y < info.height / 2) upperOpaque++;
        else lowerOpaque++;
      }
    }
    expect(upperOpaque, "metal head (upper) must survive Pass C skip").toBeGreaterThan(80);
    expect(lowerOpaque, "metal body (lower) must survive").toBeGreaterThan(80);
    expect(await alphaAt(buffer, 0, 0)).toBe(0);
    expect(w).toBeGreaterThan(8);
    expect(h).toBeGreaterThan(8);
  });

  it("still preserves enclosed teeth/eyes wrapped in colour", async () => {
    const { buffer } = await run("enclosed-teeth");
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let nearWhiteOpaque = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i + 3] < 200) continue;
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (lum >= 240) nearWhiteOpaque++;
    }
    expect(nearWhiteOpaque).toBeGreaterThan(20);
    expect(await alphaAt(buffer, 0, 0)).toBe(0);
  });

  it("still removes genuine white-canvas background", async () => {
    const { buffer } = await run("white-canvas-background");
    expect(await alphaAt(buffer, 0, 0)).toBe(0);
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let opaque = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i + 3] > 128) opaque++;
    }
    expect(opaque).toBeGreaterThan(80);
  });

  it("leaves a flat non-white subject unchanged in shape", async () => {
    const { buffer } = await run("flat-baseline");
    expect(await alphaAt(buffer, 0, 0)).toBe(0);
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let opaque = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i + 3] > 128) opaque++;
    }
    // ~π*14² ≈ 616 source pixels; trim + 1px erode shrinks this a bit.
    expect(opaque).toBeGreaterThan(400);
    expect(opaque).toBeLessThan(800);
  });
});
