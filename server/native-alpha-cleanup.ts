/**
 * Cleanup for direct-OpenAI native-transparent PNGs (Petposterous apparel only).
 *
 * 1. Alpha snap: alpha <= 8 → 0 (background haze), alpha >= 250 → 255 (near-solid
 *    ink the model leaves at 250–254). Alpha 9–249 (antialiased edges) unchanged.
 * 2. Stray-blob removal, deliberately narrow: build the main-art region from the
 *    largest shape, absorbing every shape whose box lies within `padding` of the
 *    region (so letters, punctuation and nearby details join it). Only shapes that
 *    stay outside that padded region AND are below a strict area cap are cleared.
 *    No general small-object removal, no morphology.
 */
import sharp from "sharp";

export type AlphaCleanupReport = {
  hazeCleared: number;
  solidPromoted: number;
  strayBlobsRemoved: number;
  strayPixelsRemoved: number;
};

type Box = { x0: number; y0: number; x1: number; y1: number };

/** Padding around the main art, as a share of the longer canvas edge. */
const REGION_PADDING = 0.06;
/** Largest stray that may be removed, as a share of the canvas area. */
const MAX_STRAY_AREA = 0.0006;

export function cleanupAlphaRaw(
  rgba: Uint8Array | Buffer,
  width: number,
  height: number,
): AlphaCleanupReport {
  const n = width * height;
  let hazeCleared = 0;
  let solidPromoted = 0;
  for (let i = 0; i < n; i++) {
    const k = i * 4 + 3;
    const a = rgba[k];
    if (a > 0 && a <= 8) {
      rgba[k] = 0;
      hazeCleared++;
    } else if (a >= 250 && a < 255) {
      rgba[k] = 255;
      solidPromoted++;
    }
  }

  // 8-connected shapes over visible pixels.
  const label = new Int32Array(n).fill(-1);
  const boxes: Box[] = [];
  const areas: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (rgba[s * 4 + 3] === 0 || label[s] !== -1) continue;
    const id = boxes.length;
    const box: Box = { x0: width, y0: height, x1: 0, y1: 0 };
    let area = 0;
    label[s] = id;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      area++;
      const x = i % width;
      const y = (i - x) / width;
      if (x < box.x0) box.x0 = x;
      if (x > box.x1) box.x1 = x;
      if (y < box.y0) box.y0 = y;
      if (y > box.y1) box.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if ((dx === 0 && dy === 0) || nx < 0 || nx >= width) continue;
          const j = ny * width + nx;
          if (label[j] === -1 && rgba[j * 4 + 3] !== 0) {
            label[j] = id;
            stack.push(j);
          }
        }
      }
    }
    boxes.push(box);
    areas.push(area);
  }

  const report: AlphaCleanupReport = { hazeCleared, solidPromoted, strayBlobsRemoved: 0, strayPixelsRemoved: 0 };
  if (boxes.length < 2) return report;

  let main = 0;
  for (let i = 1; i < areas.length; i++) if (areas[i] > areas[main]) main = i;
  const pad = Math.round(Math.max(width, height) * REGION_PADDING);
  const region: Box = { ...boxes[main] };
  const inRegion = new Uint8Array(boxes.length);
  inRegion[main] = 1;
  const near = (b: Box) =>
    b.x1 >= region.x0 - pad && b.x0 <= region.x1 + pad && b.y1 >= region.y0 - pad && b.y0 <= region.y1 + pad;
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < boxes.length; i++) {
      if (inRegion[i] || !near(boxes[i])) continue;
      inRegion[i] = 1;
      changed = true;
      const b = boxes[i];
      region.x0 = Math.min(region.x0, b.x0);
      region.y0 = Math.min(region.y0, b.y0);
      region.x1 = Math.max(region.x1, b.x1);
      region.y1 = Math.max(region.y1, b.y1);
    }
  }

  const maxStray = Math.floor(n * MAX_STRAY_AREA);
  const remove = new Uint8Array(boxes.length);
  for (let i = 0; i < boxes.length; i++) {
    if (!inRegion[i] && areas[i] <= maxStray) {
      remove[i] = 1;
      report.strayBlobsRemoved++;
      report.strayPixelsRemoved += areas[i];
    }
  }
  if (report.strayBlobsRemoved) {
    for (let i = 0; i < n; i++) if (label[i] >= 0 && remove[label[i]]) rgba[i * 4 + 3] = 0;
  }
  return report;
}

export async function cleanupNativeAlphaPng(base64: string): Promise<{ data: string; report: AlphaCleanupReport }> {
  const { data, info } = await sharp(Buffer.from(base64, "base64"))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const report = cleanupAlphaRaw(data, info.width, info.height);
  const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  return { data: png.toString("base64"), report };
}
