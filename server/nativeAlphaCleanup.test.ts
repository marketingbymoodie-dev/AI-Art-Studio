// @vitest-environment node
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { cleanupAlphaRaw, cleanupNativeAlphaPng } from "./native-alpha-cleanup";

const W = 400;
const H = 300;

function canvas() {
  return new Uint8Array(W * H * 4);
}
function fill(px: Uint8Array, x0: number, y0: number, w: number, h: number, a: number) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) px.set([40, 60, 30, a], (y * W + x) * 4);
}
const alphaAt = (px: Uint8Array, x: number, y: number) => px[(y * W + x) * 4 + 3];

/** Main art 150×100 (near-solid 252) with a 1px antialiased rim, a word below it, a full stop, and haze. */
function scene() {
  const px = canvas();
  fill(px, 120, 40, 150, 100, 252); // main art, near-solid
  fill(px, 119, 40, 1, 100, 128); // antialiased left edge
  fill(px, 271, 40, 1, 100, 40); // soft right edge
  for (let i = 0; i < 6; i++) fill(px, 130 + i * 18, 160, 12, 22, 253); // letters (gap 20px below art)
  fill(px, 130 + 6 * 18 + 4, 176, 6, 6, 254); // full stop after the last letter
  fill(px, 0, 0, 100, 30, 4); // faint haze top-left
  fill(px, 300, 250, 60, 40, 8); // faint haze bottom-right
  return px;
}

describe("direct-OpenAI alpha cleanup", () => {
  it("removes faint haze (alpha <= 8)", () => {
    const px = scene();
    const r = cleanupAlphaRaw(px, W, H);
    expect(alphaAt(px, 10, 10)).toBe(0);
    expect(alphaAt(px, 320, 270)).toBe(0);
    expect(r.hazeCleared).toBe(100 * 30 + 60 * 40);
  });

  it("makes near-solid ink (alpha >= 250) fully opaque", () => {
    const px = scene();
    cleanupAlphaRaw(px, W, H);
    expect(alphaAt(px, 200, 90)).toBe(255);
    expect(alphaAt(px, 135, 170)).toBe(255);
  });

  it("leaves antialiased edge pixels (9–249) unchanged", () => {
    const px = scene();
    cleanupAlphaRaw(px, W, H);
    expect(alphaAt(px, 119, 90)).toBe(128);
    expect(alphaAt(px, 271, 90)).toBe(40);
  });

  it("keeps punctuation and letters next to the art", () => {
    const px = scene();
    const r = cleanupAlphaRaw(px, W, H);
    expect(alphaAt(px, 130 + 6 * 18 + 6, 178)).toBe(255); // full stop
    expect(alphaAt(px, 130 + 5 * 18 + 5, 170)).toBe(255); // last letter
    expect(r.strayBlobsRemoved).toBe(0);
  });

  it("removes a tiny isolated stray blob far outside the art", () => {
    const px = scene();
    fill(px, 385, 285, 6, 6, 255); // corner speck (36px, under the 72px cap at 400×300)
    fill(px, 384, 284, 8, 1, 120); // its soft edge
    const r = cleanupAlphaRaw(px, W, H);
    expect(r.strayBlobsRemoved).toBe(1);
    expect(alphaAt(px, 387, 287)).toBe(0);
    expect(alphaAt(px, 386, 284)).toBe(0);
    expect(alphaAt(px, 200, 90)).toBe(255); // art untouched
  });

  it("preserves legitimate small details: connected, or near the art", () => {
    const px = scene();
    fill(px, 272, 60, 3, 3, 200); // tiny detail touching the art's rim (connected)
    fill(px, 290, 50, 5, 5, 255); // small sparkle 18px from the art (disconnected but inside padding)
    const r = cleanupAlphaRaw(px, W, H);
    expect(alphaAt(px, 273, 61)).toBe(200);
    expect(alphaAt(px, 292, 52)).toBe(255);
    expect(r.strayBlobsRemoved).toBe(0);
  });

  it("never removes a larger disconnected element, even far away", () => {
    const px = scene();
    fill(px, 360, 250, 30, 30, 255); // 900px > strict cap (72px at 400×300)
    const r = cleanupAlphaRaw(px, W, H);
    expect(r.strayBlobsRemoved).toBe(0);
    expect(alphaAt(px, 370, 260)).toBe(255);
  });

  it("round-trips a PNG keeping RGB and the edge alpha", async () => {
    const px = scene();
    const png = await sharp(Buffer.from(px), { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
    const { data, report } = await cleanupNativeAlphaPng(png.toString("base64"));
    const out = await sharp(Buffer.from(data, "base64")).raw().toBuffer({ resolveWithObject: true });
    expect(out.info.channels).toBe(4);
    expect(report.solidPromoted).toBeGreaterThan(0);
    const o = out.data;
    expect(o[(90 * W + 200) * 4 + 3]).toBe(255);
    expect(o[(90 * W + 119) * 4 + 3]).toBe(128);
    expect([o[(90 * W + 200) * 4], o[(90 * W + 200) * 4 + 1], o[(90 * W + 200) * 4 + 2]]).toEqual([40, 60, 30]);
  });
});
