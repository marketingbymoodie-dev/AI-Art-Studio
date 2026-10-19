/**
 * Mockup library placement and mask rules.
 *
 * A dark mask is copied from the white master only when the files are the
 * same pixel size and the background agrees. MASK_BACKGROUND_MAX_MEAN is 5.
 * Do not raise it.
 */
import sharp from "sharp";
import { compositePlacedInk, medianShadingLuminance } from "./mockup-compositor";

/** Mean per-channel absolute difference, on the 0–255 scale. Do not raise this. */
export const MASK_BACKGROUND_MAX_MEAN = 5;

export const DEFAULT_PRINT_FRACTIONS = {
  widthOfH: 0.4415,
  heightOfH: 0.5041,
  topOfH: 0.2074,
  rotationDeg: 0,
} as const;

export type PrintFractions = {
  widthOfH: number;
  heightOfH: number;
  topOfH: number;
  rotationDeg: number;
};

export type PanelColour = { name: string; hex: string; kind: "produced" | "white-master" };

export function missingPanelMessage(color: string, typeName: string, typeId: number, panelLabel: string): string {
  return `${color} on ${typeName} (${typeId}), panel ${panelLabel}, has no produced colourway and no white master`;
}

export function resolvePanelColour(
  colours: PanelColour[],
  requested: { name: string; hex: string },
  typeName: string,
  typeId: number,
  panelLabel: string,
): { kind: "produced" | "recolour"; hex: string; sourceName: string } {
  const wanted = requested.name.trim().toLowerCase();
  const exact = colours.find((c) => c.name.trim().toLowerCase() === wanted);
  if (exact) return { kind: "produced", hex: exact.hex, sourceName: exact.name };
  const white = colours.find((c) => c.kind === "white-master");
  if (white) return { kind: "recolour", hex: requested.hex, sourceName: white.name };
  throw new Error(missingPanelMessage(requested.name, typeName, typeId, panelLabel));
}

function disk(radius: number): number[] {
  const offsets: number[] = [];
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      if (x * x + y * y <= radius * radius) offsets.push(y, x);
    }
  }
  return offsets;
}

function dilate(src: Uint8Array, w: number, h: number, offsets: number[]): Uint8Array {
  const dst = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!src[y * w + x]) continue;
      for (let k = 0; k < offsets.length; k += 2) {
        const ny = y + offsets[k];
        const nx = x + offsets[k + 1];
        if (ny < 0 || nx < 0 || ny >= h || nx >= w) continue;
        dst[ny * w + nx] = 1;
      }
    }
  }
  return dst;
}

function erode(src: Uint8Array, w: number, h: number, offsets: number[]): Uint8Array {
  const dst = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let ok = 1;
      for (let k = 0; k < offsets.length; k += 2) {
        const ny = y + offsets[k];
        const nx = x + offsets[k + 1];
        if (ny < 0 || nx < 0 || ny >= h || nx >= w || !src[ny * w + nx]) {
          ok = 0;
          break;
        }
      }
      dst[y * w + x] = ok;
    }
  }
  return dst;
}

function components(mask: Uint8Array, w: number, h: number): number[][] {
  const seen = new Uint8Array(w * h);
  const comps: number[][] = [];
  const stack: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    stack.length = 0;
    stack.push(i);
    seen[i] = 1;
    const comp: number[] = [];
    while (stack.length) {
      const p = stack.pop()!;
      comp.push(p);
      const x = p % w;
      const y = (p - x) / w;
      const nbrs = [p - 1, p + 1, p - w, p + w, p - w - 1, p - w + 1, p + w - 1, p + w + 1];
      for (const n of nbrs) {
        if (n < 0 || n >= mask.length || seen[n] || !mask[n]) continue;
        if (Math.abs((n % w) - x) > 1) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    comps.push(comp);
  }
  return comps;
}

function fillHoles(mask: Uint8Array, w: number, h: number): void {
  const bg = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (i: number) => {
    if (i < 0 || i >= mask.length || mask[i] || bg[i]) return;
    bg[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x + 1 < w) push(p + 1);
    if (p >= w) push(p - w);
    if (p + w < mask.length) push(p + w);
  }
  for (let i = 0; i < mask.length; i++) if (!bg[i]) mask[i] = 1;
}

function garmentPixel(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const sat = max === 0 ? 0 : (max - min) / max;
  return lightness > 185 && sat < 0.17;
}

export type GarmentSegment = {
  mask: Uint8Array;
  areaFraction: number;
  touchesEdge: boolean;
  disconnected: boolean;
};

/** White-file segmentation. Lightness above 185 and saturation under 0.17. */
export function segmentWhiteGarment(rgba: Uint8Array, w: number, h: number): Uint8Array {
  const raw = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    raw[i] = garmentPixel(rgba[o], rgba[o + 1], rgba[o + 2]) ? 1 : 0;
  }
  const comps = components(raw, w, h).sort((a, b) => b.length - a.length);
  const shirt = new Uint8Array(w * h);
  if (comps[0]) for (const p of comps[0]) shirt[p] = 1;
  const closeR = disk(7);
  const openR = disk(4);
  let mask = erode(dilate(shirt, w, h, closeR), w, h, closeR);
  mask = dilate(erode(mask, w, h, openR), w, h, openR);
  const kept = components(mask, w, h).sort((a, b) => b.length - a.length);
  const keep = new Uint8Array(w * h);
  if (kept[0]) for (const p of kept[0]) keep[p] = 1;
  fillHoles(keep, w, h);
  return keep;
}

function hexHsv(hex: string): [number, number, number] {
  const n = parseInt(hex, 16);
  return rgbToHsv((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

/**
 * Garment pixels near a known hex. Hue and saturation carry the match.
 * Lightness is a wide band so fold shading stays inside the shirt.
 * A near-grey hex has no stable hue, so those files match low saturation
 * and the lightness band only.
 */
function pixelNearHex(r: number, g: number, b: number, target: [number, number, number]): boolean {
  const [h, s, v] = rgbToHsv(r, g, b);
  const [th, ts, tv] = target;
  if (ts < 0.15) return s < 0.2 && Math.abs(v - tv) <= 0.34;
  let dh = Math.abs(h - th);
  if (dh > 0.5) dh = 1 - dh;
  return dh <= 0.07 && s >= ts * 0.35 && s <= Math.min(1, ts + 0.3) && v >= Math.max(0.04, tv - 0.45) && v <= Math.min(1, tv + 0.38);
}

function borderTouch(mask: Uint8Array, w: number, h: number): boolean {
  for (let x = 0; x < w; x++) {
    if (mask[x] || mask[(h - 1) * w + x]) return true;
  }
  for (let y = 0; y < h; y++) {
    if (mask[y * w] || mask[y * w + w - 1]) return true;
  }
  return false;
}

/** Area and a second region, measured on a mask that is already stored. */
export function storedMaskReport(mask: Uint8Array, w: number, h: number): { areaFraction: number; disconnected: boolean } {
  let area = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) area++;
  const kept = components(mask, w, h).sort((a, b) => b.length - a.length);
  const secondRatio = kept[0]?.length ? (kept[1]?.length || 0) / kept[0].length : 0;
  return { areaFraction: mask.length ? area / mask.length : 0, disconnected: secondRatio >= 0.12 };
}

/** Sage, then pink, then blue. White, black and the greys are never the reference. */
export const SCENE_REFERENCE_HEXES = ["819E87", "DD74A1", "0077B5"] as const;

/** A leftover blob from the open. A second garment-sized region is not one of these. */
const REFERENCE_SPECK_PIXELS = 64;

export type SceneReference = {
  hex: string;
  mask: Uint8Array;
  width: number;
  height: number;
  areaFraction: number;
  printWidthOfH: number;
  printHeightOfH: number;
  printTopOfH: number;
  heightOfImage: number;
  topOfImage: number;
  centreOfImage: number;
};

/**
 * One mask for the scene: the first chromatic file whose garment is a single
 * region of shirt size. The eight colours are the same photograph recoloured,
 * so they share this mask and its print rect.
 */
export function chooseSceneReference(
  candidates: Array<{ hex: string; rgba: Uint8Array; width: number; height: number }>,
): SceneReference | null {
  const byHex = new Map(candidates.map((row) => [row.hex.replace(/^#/, "").toUpperCase(), row]));
  for (const hex of SCENE_REFERENCE_HEXES) {
    const file = byHex.get(hex);
    if (!file) continue;
    const segment = segmentGarmentNearHex(file.rgba, file.width, file.height, hex);
    const parts = components(segment.mask, file.width, file.height).filter((part) => part.length > REFERENCE_SPECK_PIXELS);
    if (parts.length !== 1) continue;
    if (!(segment.areaFraction > 0.2 && segment.areaFraction < 0.85)) continue;
    let rect: { left: number; top: number; width: number; height: number };
    try {
      rect = printRectForMask(segment.mask, file.width, file.height);
    } catch {
      continue;
    }
    const bounds = maskBounds(segment.mask, file.width, file.height);
    return {
      hex,
      mask: segment.mask,
      width: file.width,
      height: file.height,
      areaFraction: segment.areaFraction,
      printWidthOfH: DEFAULT_PRINT_FRACTIONS.widthOfH,
      printHeightOfH: DEFAULT_PRINT_FRACTIONS.heightOfH,
      printTopOfH: DEFAULT_PRINT_FRACTIONS.topOfH,
      heightOfImage: bounds.H / file.height,
      topOfImage: bounds.minY / file.height,
      centreOfImage: (rect.left + rect.width / 2) / file.width,
    };
  }
  return null;
}

function maskQuality(mask: Uint8Array, w: number, h: number, secondRatio: number, touchesEdge: boolean): GarmentSegment {
  let area = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) area++;
  return {
    mask,
    areaFraction: area / (w * h),
    touchesEdge,
    disconnected: secondRatio >= 0.12,
  };
}

/** Small contact-sheet cell: the photograph with the mask contour in red. */
export async function garmentOutlineJpeg(rgba: Uint8Array, w: number, h: number, mask: Uint8Array): Promise<Buffer> {
  const side = 160;
  const scale = side / Math.max(w, h);
  const dw = Math.max(1, Math.round(w * scale));
  const dh = Math.max(1, Math.round(h * scale));
  const raw = Buffer.alloc(dw * dh * 3);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(h - 1, Math.floor(y / scale));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(w - 1, Math.floor(x / scale));
      const i = sy * w + sx;
      const on = mask[i] === 1;
      const edgePx = on && (
        sx === 0 || sy === 0 || sx === w - 1 || sy === h - 1
        || mask[i - 1] !== 1 || mask[i + 1] !== 1 || mask[i - w] !== 1 || mask[i + w] !== 1
      );
      const o = (y * dw + x) * 3;
      if (edgePx) {
        raw[o] = 220;
        raw[o + 1] = 30;
        raw[o + 2] = 30;
      } else {
        const p = i * 4;
        raw[o] = rgba[p];
        raw[o + 1] = rgba[p + 1];
        raw[o + 2] = rgba[p + 2];
      }
    }
  }
  return sharp(raw, { raw: { width: dw, height: dh, channels: 3 } }).jpeg({ quality: 62 }).toBuffer();
}

/** Segment one colour file from its own hex. Close, open, largest component, fill holes. */
export function segmentGarmentNearHex(rgba: Uint8Array, w: number, h: number, hex: string): GarmentSegment {
  const target = hexHsv(hex);
  const raw = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    raw[i] = pixelNearHex(rgba[o], rgba[o + 1], rgba[o + 2], target) ? 1 : 0;
  }
  const closeR = disk(7);
  const openR = disk(4);
  let mask = erode(dilate(raw, w, h, closeR), w, h, closeR);
  mask = dilate(erode(mask, w, h, openR), w, h, openR);
  const kept = components(mask, w, h).sort((a, b) => b.length - a.length);
  const keep = new Uint8Array(w * h);
  if (kept[0]) for (const p of kept[0]) keep[p] = 1;
  fillHoles(keep, w, h);
  const secondRatio = kept[0]?.length ? (kept[1]?.length || 0) / kept[0].length : 0;
  return maskQuality(keep, w, h, secondRatio, borderTouch(raw, w, h));
}

export function describeWhiteSegment(rgba: Uint8Array, w: number, h: number): GarmentSegment {
  const raw = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    raw[i] = garmentPixel(rgba[o], rgba[o + 1], rgba[o + 2]) ? 1 : 0;
  }
  const comps = components(raw, w, h).sort((a, b) => b.length - a.length);
  const secondRatio = comps[0]?.length ? (comps[1]?.length || 0) / comps[0].length : 0;
  return maskQuality(segmentWhiteGarment(rgba, w, h), w, h, secondRatio, borderTouch(raw, w, h));
}

/**
 * Copy the white mask onto a dark file only when both conditions hold.
 * A size mismatch does not scale the mask into a pass.
 */
export function backgroundAgrees(
  whiteRgba: Uint8Array,
  darkRgba: Uint8Array,
  whiteMask: Uint8Array,
  whiteWidth: number,
  whiteHeight: number,
  darkWidth: number,
  darkHeight: number,
): { agree: boolean; mean: number | null } {
  if (whiteWidth !== darkWidth || whiteHeight !== darkHeight) return { agree: false, mean: null };
  if (whiteMask.length !== whiteWidth * whiteHeight) return { agree: false, mean: null };
  let sum = 0;
  let n = 0;
  const pixels = whiteWidth * whiteHeight;
  for (let i = 0; i < pixels; i++) {
    if (whiteMask[i]) continue;
    const o = i * 4;
    sum += (Math.abs(whiteRgba[o] - darkRgba[o]) + Math.abs(whiteRgba[o + 1] - darkRgba[o + 1]) + Math.abs(whiteRgba[o + 2] - darkRgba[o + 2])) / 3;
    n++;
  }
  if (n === 0) return { agree: false, mean: null };
  const mean = sum / n;
  return { agree: mean <= MASK_BACKGROUND_MAX_MEAN, mean };
}

/** Nearest-neighbour scale. Used only as the outline shown for a confirm, never as a silent copy. */
export function scaleMask(mask: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const out = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / dw));
      out[y * dw + x] = mask[sy * sw + sx] ? 1 : 0;
    }
  }
  return out;
}

export function maskBounds(mask: Uint8Array, w: number, h: number): { minX: number; minY: number; maxX: number; maxY: number; H: number } {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxY < minY) throw new Error("Stored mask has no garment pixels");
  return { minX, minY, maxX, maxY, H: maxY - minY + 1 };
}

/** Centroid of mask pixels in the middle 30–75% of garment height. */
export function bodyCentreline(mask: Uint8Array, w: number, bounds: { minY: number; H: number }): number {
  const y0 = bounds.minY + 0.3 * bounds.H;
  const y1 = bounds.minY + 0.75 * bounds.H;
  let sum = 0;
  let n = 0;
  for (let y = Math.ceil(y0); y <= Math.floor(y1); y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      sum += x;
      n++;
    }
  }
  if (n === 0) throw new Error("Stored mask has no centreline pixels");
  return sum / n;
}

export function printRectForMask(
  mask: Uint8Array,
  w: number,
  h: number,
  fractions: PrintFractions = DEFAULT_PRINT_FRACTIONS,
): { left: number; top: number; width: number; height: number } {
  if (fractions.rotationDeg !== 0) throw new Error("This panel is marked off-square. Rotation is not applied.");
  const bounds = maskBounds(mask, w, h);
  const width = Math.max(1, Math.round(fractions.widthOfH * bounds.H));
  const height = Math.max(1, Math.round(fractions.heightOfH * bounds.H));
  const top = Math.round(bounds.minY + fractions.topOfH * bounds.H);
  const centre = bodyCentreline(mask, w, bounds);
  const left = Math.round(centre - width / 2);
  return { left, top, width, height };
}

function lum(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let hue = 0;
  if (d) {
    if (max === r) hue = ((g - b) / d + 6) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue /= 6;
  }
  return [hue, max === 0 ? 0 : d / max, max];
}

function hsvToRgb(hue: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(hue * 6) % 6;
  const f = hue * 6 - Math.floor(hue * 6);
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const table: Array<[number, number, number]> = [
    [v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q],
  ];
  const [rr, gg, bb] = table[i];
  return [rr * 255, gg * 255, bb * 255];
}

function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const dst = new Float32Array(w * h);
  const div = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / div;
      sum -= src[y * w + Math.min(w - 1, Math.max(0, x - radius))];
      sum += src[y * w + Math.min(w - 1, Math.max(0, x + radius + 1))];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum / div;
      sum -= tmp[Math.min(h - 1, Math.max(0, y - radius)) * w + x];
      sum += tmp[Math.min(h - 1, Math.max(0, y + radius + 1)) * w + x];
    }
  }
  return dst;
}

export function recolorGarment(rgba: Uint8Array, w: number, h: number, mask: Uint8Array, hex: string, medianL: number): Uint8Array {
  if (hex.toUpperCase() === "FFFFFF") return new Uint8Array(rgba);
  const featherSrc = new Float32Array(w * h);
  const dilated = dilate(mask, w, h, disk(7));
  for (let i = 0; i < dilated.length; i++) featherSrc[i] = dilated[i];
  const feather = boxBlur(boxBlur(featherSrc, w, h, 2), w, h, 2);
  const n = parseInt(hex, 16);
  const [th, ts, tv] = rgbToHsv((n >> 16) & 255, (n >> 8) & 255, n & 255);
  const out = new Uint8Array(rgba);
  for (let i = 0; i < w * h; i++) {
    const m = feather[i];
    if (m < 0.004) continue;
    const o = i * 4;
    const L = lum(rgba[o], rgba[o + 1], rgba[o + 2]);
    const delta = medianL > 1 ? (L - medianL) / medianL : 0;
    const v = Math.min(1, Math.max(0, tv * (1 + 0.85 * delta)));
    const shadow = Math.min(1, Math.max(0, -delta));
    const s = ts < 0.06 ? 0 : Math.min(1, ts * (1 + 0.18 * shadow));
    const [rr, gg, bb] = hsvToRgb(th, s, v);
    out[o] = Math.round(rr * m + rgba[o] * (1 - m));
    out[o + 1] = Math.round(gg * m + rgba[o + 1] * (1 - m));
    out[o + 2] = Math.round(bb * m + rgba[o + 2] * (1 - m));
  }
  return out;
}

export async function decodeRgba(image: Buffer): Promise<{ rgba: Uint8Array; width: number; height: number }> {
  const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { rgba: new Uint8Array(data), width: info.width, height: info.height };
}

export async function maskFromPng(image: Buffer, width: number, height: number): Promise<Uint8Array> {
  const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== width || info.height !== height) throw new Error("Stored mask size does not match the photograph");
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * info.channels] > 127 ? 1 : 0;
  return mask;
}

export async function maskToPng(mask: Uint8Array, width: number, height: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height);
  for (let i = 0; i < mask.length; i++) raw[i] = mask[i] ? 255 : 0;
  return sharp(raw, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

async function trimArtwork(file: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.from(data);
  const w = info.width;
  const h = info.height;
  const hasAlpha = rgba.some((_, i) => i % 4 === 3 && rgba[i] < 250);
  if (!hasAlpha) {
    const bg = new Uint8Array(w * h);
    const stack: number[] = [];
    const bgR = rgba[0];
    const bgG = rgba[1];
    const bgB = rgba[2];
    const push = (i: number) => {
      if (i < 0 || i >= w * h || bg[i]) return;
      const o = i * 4;
      if (Math.abs(rgba[o] - bgR) + Math.abs(rgba[o + 1] - bgG) + Math.abs(rgba[o + 2] - bgB) >= 42) return;
      bg[i] = 1;
      stack.push(i);
    };
    for (let x = 0; x < w; x++) {
      push(x);
      push((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      push(y * w);
      push(y * w + w - 1);
    }
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      if (x > 0) push(p - 1);
      if (x + 1 < w) push(p + 1);
      if (p >= w) push(p - w);
      if (p + w < w * h) push(p + w);
    }
    for (let i = 0; i < w * h; i++) if (bg[i]) rgba[i * 4 + 3] = 0;
  }
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] <= 8) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX) throw new Error("Candidate artwork has no ink");
  return sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .png()
    .toBuffer();
}

type PlacedArtwork = {
  width: number;
  height: number;
  rect: { left: number; top: number; width: number; height: number };
  ink: Buffer;
  inkWidth: number;
  inkHeight: number;
  inkLeft: number;
  inkTop: number;
  mask: Uint8Array;
  garment: Uint8Array;
  shading: Uint8Array;
};

/** Printify's create call treats x/y as offsets from centre. Scale 1 is the print-area width. */
export function printifyPlacementForInk(
  rect: { left: number; top: number; width: number; height: number },
  inkLeft: number,
  inkTop: number,
  inkWidth: number,
  inkHeight: number,
): { x: number; y: number; scale: number } {
  const cx = inkLeft + inkWidth / 2;
  const cy = inkTop + inkHeight / 2;
  const rectCx = rect.left + rect.width / 2;
  const rectCy = rect.top + rect.height / 2;
  return {
    x: (cx - rectCx) / (rect.width / 2),
    y: (cy - rectCy) / (rect.height / 2),
    scale: inkWidth / rect.width,
  };
}

async function placeArtwork(args: {
  photo: Buffer;
  maskPng: Buffer;
  artwork: Buffer;
  mode: "produced" | "recolour";
  hex: string;
  fractions?: PrintFractions;
}): Promise<PlacedArtwork> {
  const photoRaw = await decodeRgba(args.photo);
  const mask = await maskFromPng(args.maskPng, photoRaw.width, photoRaw.height);
  const fractions = args.fractions ?? DEFAULT_PRINT_FRACTIONS;
  const rect = printRectForMask(mask, photoRaw.width, photoRaw.height, fractions);
  const shading = photoRaw.rgba;
  const median = medianShadingLuminance(Buffer.from(shading), photoRaw.width, photoRaw.height, mask);
  const garment = args.mode === "recolour"
    ? recolorGarment(shading, photoRaw.width, photoRaw.height, mask, args.hex, median)
    : shading;
  const trimmed = await trimArtwork(args.artwork);
  const meta = await sharp(trimmed).metadata();
  const iw = meta.width || 1;
  const ih = meta.height || 1;
  const fit = Math.min(rect.width / iw, rect.height / ih) * 0.85;
  const inkWidth = Math.max(1, Math.round(iw * fit));
  const inkHeight = Math.max(1, Math.round(ih * fit));
  const ink = await sharp(trimmed).resize(inkWidth, inkHeight, { fit: "inside" }).ensureAlpha().raw().toBuffer();
  return {
    width: photoRaw.width,
    height: photoRaw.height,
    rect,
    ink,
    inkWidth,
    inkHeight,
    inkLeft: Math.round(rect.left + (rect.width - inkWidth) / 2),
    inkTop: Math.round(rect.top + (rect.height - inkHeight) / 2),
    mask,
    garment,
    shading,
  };
}

export async function measurePlacedInk(args: {
  photo: Buffer;
  maskPng: Buffer;
  artwork: Buffer;
  mode: "produced" | "recolour";
  hex: string;
  fractions?: PrintFractions;
}): Promise<{
  printCentreX: number;
  printCentreY: number;
  boundsCentreX: number;
  boundsCentreY: number;
  centroidX: number;
  centroidY: number;
}> {
  const placed = await placeArtwork(args);
  let minX = placed.inkWidth;
  let minY = placed.inkHeight;
  let maxX = -1;
  let maxY = -1;
  let weight = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < placed.inkHeight; y++) {
    for (let x = 0; x < placed.inkWidth; x++) {
      const alpha = placed.ink[(y * placed.inkWidth + x) * 4 + 3];
      if (alpha < 30) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      weight += alpha;
      sumX += (placed.inkLeft + x + 0.5) * alpha;
      sumY += (placed.inkTop + y + 0.5) * alpha;
    }
  }
  if (maxX < minX || weight === 0) throw new Error("Candidate artwork has no ink");
  return {
    printCentreX: placed.rect.left + placed.rect.width / 2,
    printCentreY: placed.rect.top + placed.rect.height / 2,
    boundsCentreX: placed.inkLeft + (minX + maxX) / 2,
    boundsCentreY: placed.inkTop + (minY + maxY) / 2,
    centroidX: sumX / weight,
    centroidY: sumY / weight,
  };
}

export async function artworkForPrintifyPreview(args: {
  photo: Buffer;
  maskPng: Buffer;
  artwork: Buffer;
  mode: "produced" | "recolour";
  hex: string;
  fractions?: PrintFractions;
}): Promise<{ png: Buffer; x: number; y: number; scale: number }> {
  const placed = await placeArtwork(args);
  const png = await sharp(placed.ink, {
    raw: { width: placed.inkWidth, height: placed.inkHeight, channels: 4 },
  }).png().toBuffer();
  const placement = printifyPlacementForInk(placed.rect, placed.inkLeft, placed.inkTop, placed.inkWidth, placed.inkHeight);
  return { png, ...placement };
}

export async function renderArtworkOnPanel(args: {
  photo: Buffer;
  maskPng: Buffer;
  artwork: Buffer;
  mode: "produced" | "recolour";
  hex: string;
  fractions?: PrintFractions;
}): Promise<Buffer> {
  const placed = await placeArtwork(args);
  const composited = compositePlacedInk({
    garment: Buffer.from(placed.garment),
    shading: Buffer.from(placed.shading),
    width: placed.width,
    height: placed.height,
    ink: placed.ink,
    inkWidth: placed.inkWidth,
    inkHeight: placed.inkHeight,
    left: placed.inkLeft,
    top: placed.inkTop,
    mask: placed.mask,
  });
  return sharp(composited, { raw: { width: placed.width, height: placed.height, channels: 4 } }).png().toBuffer();
}
