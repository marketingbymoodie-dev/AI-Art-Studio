import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  maybeVectorizeFlatGraphic,
  processApparelMotif,
} from "./apparel-matting";
import { rasterizeSvgBuffer } from "./replicate-vectorizer";
import { paintTextFixture, TEXT_H, TEXT_W } from "./__tests__/fixtures/chroma/text/paintTextFixtures";

const prevVectorize = process.env.APPAREL_VECTORIZE;
const prevProvider = process.env.APPAREL_VECTORIZE_PROVIDER;

afterEach(() => {
  if (prevVectorize === undefined) delete process.env.APPAREL_VECTORIZE;
  else process.env.APPAREL_VECTORIZE = prevVectorize;
  if (prevProvider === undefined) delete process.env.APPAREL_VECTORIZE_PROVIDER;
  else process.env.APPAREL_VECTORIZE_PROVIDER = prevProvider;
});

async function alphaAt(buffer: Buffer, x: number, y: number): Promise<number> {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const idx = (y * info.width + x) * info.channels;
  return data[idx + 3];
}

async function rasterMotif(name: Parameters<typeof paintTextFixture>[0], vectorize: boolean) {
  delete process.env.APPAREL_VECTORIZE;
  process.env.APPAREL_VECTORIZE_PROVIDER = "neplex";
  const src = await paintTextFixture(name);
  return processApparelMotif(src, {
    useMlFallback: false,
    allowWhiteKey: true,
    vectorize,
  });
}

describe("WP2 Ticket 2 — vectorize gate", () => {
  it("does not vectorize when env is off and enabled is omitted", async () => {
    delete process.env.APPAREL_VECTORIZE;
    const src = await paintTextFixture("flat-art");
    const matted = await processApparelMotif(src, {
      useMlFallback: false,
      vectorize: false,
    });
    const skipped = await maybeVectorizeFlatGraphic(matted.buffer);
    expect(skipped.mimeType).toBe("image/png");
  });

  it("runs vectorize when opts.vectorize is true even if env is unset", async () => {
    const result = await rasterMotif("flat-art", true);
    expect(result.mimeType).toBe("image/svg+xml");
    expect(result.buffer.toString("utf8", 0, 200)).toMatch(/<svg/i);
  });
});

describe("WP2 Ticket 2 — counters, stems, flowers, curves", () => {
  it("punches O/e/a/g/R/B counters and keeps strokes solid", async () => {
    const result = await rasterMotif("bold-letters-OeagRB", true);
    expect(result.mimeType).toBe("image/svg+xml");
    const raster = await rasterizeSvgBuffer(result.buffer, TEXT_W, TEXT_H);

    // O hole vs rim (source coords; trim may crop — sample via nearest opaque bbox)
    const { data, info } = await sharp(raster).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const opaque = (x: number, y: number) =>
      data[(y * info.width + x) * info.channels + 3] > 128;

    // Find the leftmost opaque blob (O) and assert it has a transparent interior.
    let minX = info.width;
    let maxX = 0;
    let minY = info.height;
    let maxY = 0;
    let opaqueCount = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if (!opaque(x, y)) continue;
        opaqueCount++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    expect(opaqueCount).toBeGreaterThan(200);
    const cx = Math.round((minX + maxX) / 2);
    const cy = Math.round((minY + maxY) / 2);
    // Across a word of counter letters, the bounding-box center may sit in a
    // gap between glyphs. Require at least one transparent sample inside the
    // left-hand O column (first ~18% of the opaque bbox).
    const oCol = Math.round(minX + (maxX - minX) * 0.08);
    let hole = 0;
    let stroke = 0;
    for (let y = minY; y <= maxY; y++) {
      if (opaque(oCol, y)) stroke++;
      else hole++;
    }
    expect(stroke, "O column should have solid stems").toBeGreaterThan(4);
    expect(hole, "O column should have a punched counter").toBeGreaterThan(2);
    expect(await alphaAt(raster, 0, 0)).toBe(0);
    expect(cx).toBeGreaterThan(0);
    expect(cy).toBeGreaterThan(0);
  });

  it("keeps 3px stems after vectorize (no silent raster fallback)", async () => {
    const result = await rasterMotif("thin-stems", true);
    expect(result.mimeType).toBe("image/svg+xml");
    const raster = await rasterizeSvgBuffer(result.buffer, TEXT_W, TEXT_H);
    const { data, info } = await sharp(raster).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let opaque = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i + 3] > 128) opaque++;
    }
    // Three 3×40 bars + one 30×3 bar ≈ 450 px before trim; allow tracer shrink.
    expect(opaque).toBeGreaterThan(180);
  });

  it("keeps enclosed non-plate flower hue (#E614E1)", async () => {
    const result = await rasterMotif("flower-enclosed-hue", true);
    expect(result.mimeType).toBe("image/svg+xml");
    const raster = await rasterizeSvgBuffer(result.buffer, TEXT_W, TEXT_H);
    const { data, info } = await sharp(raster).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let flower = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i + 3] < 128) continue;
      if (data[i] >= 200 && data[i + 1] <= 50 && data[i + 2] >= 180) flower++;
    }
    expect(flower).toBeGreaterThan(40);
  });

  it("keeps a flat-art blob without opening a hole", async () => {
    const result = await rasterMotif("flat-art", true);
    expect(result.mimeType).toBe("image/svg+xml");
    const raster = await rasterizeSvgBuffer(result.buffer, TEXT_W, TEXT_H);
    const { data, info } = await sharp(raster).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let opaque = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i + 3] > 128) opaque++;
    }
    expect(opaque).toBeGreaterThan(500);
  });

  it("keeps a smooth curved silhouette mostly opaque (no angular bite-out)", async () => {
    const result = await rasterMotif("smooth-curve", true);
    expect(result.mimeType).toBe("image/svg+xml");
    const raster = await rasterizeSvgBuffer(result.buffer, TEXT_W, TEXT_H);
    const { data, info } = await sharp(raster).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let opaque = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i + 3] > 128) opaque++;
    }
    expect(opaque).toBeGreaterThan(600);
  });

  it("keeps a bordered sticker fill plus a dark ring", async () => {
    const result = await rasterMotif("bordered-sticker", true);
    expect(result.mimeType).toBe("image/svg+xml");
    const raster = await rasterizeSvgBuffer(result.buffer, TEXT_W, TEXT_H);
    const { data, info } = await sharp(raster).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let dark = 0;
    let fill = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i + 3] < 128) continue;
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (lum < 80) dark++;
      else fill++;
    }
    expect(fill).toBeGreaterThan(200);
    expect(dark).toBeGreaterThan(40);
  });
});
