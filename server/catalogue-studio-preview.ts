/**
 * Pending-candidate preview. Composites artwork onto the garment with the
 * signed-off print rectangle. Does not create a Shopify product.
 */
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { compositePlacedInk, medianShadingLuminance } from "./mockup-compositor";

const CELL = 460;
/** Measured on the signed-off panel. Not recomputed here. */
const PRINT = {
  left: 144.17454441842185,
  top: 99.5004,
  width: 196.909,
  height: 224.8286,
};

export const PENDING_CANDIDATE = {
  id: "pending-bed-etiquette",
  status: "pending" as const,
  title: "Bed Etiquette",
  shopifyProductId: null,
  colors: [
    { name: "White", hex: "FFFFFF" },
    { name: "Black", hex: "25282A" },
    { name: "Light grey", hex: "97999B" },
    { name: "Sage", hex: "819E87" },
    { name: "Red", hex: "AC2B37" },
  ],
  selectedColor: "White",
};

function downloadsDir(): string {
  return path.join(process.env.USERPROFILE || process.env.HOME || "", "Downloads");
}

function findArtwork(dir: string): string {
  const name = fs.readdirSync(dir).find((n) => n.startsWith("Pug") && n.endsWith(".png") && !n.includes("(1)"));
  if (!name) throw new Error("Pending candidate artwork is not in Downloads");
  return path.join(dir, name);
}

async function loadPanel(dir: string): Promise<Buffer> {
  const sheet = path.join(dir, "0adc7826-497e-48d7-adf9-6c515ea6d60d.png");
  const meta = await sharp(sheet).metadata();
  const cw = Math.floor((meta.width || 0) / 5);
  const ch = Math.floor((meta.height || 0) / 2);
  const index = 7;
  return sharp(sheet)
    .extract({
      left: (index % 5) * cw,
      top: Math.floor(index / 5) * ch,
      width: cw,
      height: ch,
    })
    .resize(CELL, CELL, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer();
}

async function loadInk(file: string): Promise<Buffer> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.from(data);
  const w = info.width;
  const h = info.height;
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
  return sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .png()
    .toBuffer();
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

function garmentPixel(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const sat = max === 0 ? 0 : (max - min) / max;
  return lightness > 185 && sat < 0.17;
}

/** Shirt mask from the white panel. Same segmentation as the signed-off colour sheet. */
function segmentGarment(rgba: Buffer, w: number, h: number): Uint8Array {
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

function lum(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6) % 6;
  const f = h * 6 - Math.floor(h * 6);
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const table: Array<[number, number, number]> = [
    [v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q],
  ];
  const [rr, gg, bb] = table[i];
  return [rr * 255, gg * 255, bb * 255];
}

/** Recolor shirt pixels only. White is the photographed panel, not a recolor of itself. */
function recolorGarment(rgba: Buffer, w: number, h: number, mask: Uint8Array, hex: string, medianL: number): Buffer {
  if (hex.toUpperCase() === "FFFFFF") return Buffer.from(rgba);
  const featherSrc = new Float32Array(w * h);
  const dilated = dilate(mask, w, h, disk(7));
  for (let i = 0; i < dilated.length; i++) featherSrc[i] = dilated[i];
  const feather = boxBlur(boxBlur(featherSrc, w, h, 2), w, h, 2);
  const n = parseInt(hex, 16);
  const [th, ts, tv] = rgbToHsv((n >> 16) & 255, (n >> 8) & 255, n & 255);
  const out = Buffer.from(rgba);
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

type PreparedPreview = {
  shading: Buffer;
  mask: Uint8Array;
  medianL: number;
  ink: Buffer;
  inkWidth: number;
  inkHeight: number;
  left: number;
  top: number;
};

let prepared: Promise<PreparedPreview> | null = null;

function preparePreview(): Promise<PreparedPreview> {
  if (!prepared) {
    prepared = (async () => {
      const dir = downloadsDir();
      const shading = await loadPanel(dir);
      const mask = segmentGarment(shading, CELL, CELL);
      const medianL = medianShadingLuminance(shading, CELL, CELL, mask);
      const trimmed = await loadInk(findArtwork(dir));
      const meta = await sharp(trimmed).metadata();
      const iw = meta.width || 1;
      const ih = meta.height || 1;
      const scale = Math.min(PRINT.width / iw, PRINT.height / ih) * 0.85;
      const inkWidth = Math.max(1, Math.round(iw * scale));
      const inkHeight = Math.max(1, Math.round(ih * scale));
      const ink = await sharp(trimmed).resize(inkWidth, inkHeight, { fit: "fill" }).ensureAlpha().raw().toBuffer();
      return {
        shading,
        mask,
        medianL,
        ink,
        inkWidth,
        inkHeight,
        left: Math.round(PRINT.left + (PRINT.width - inkWidth) / 2),
        top: Math.round(PRINT.top + (PRINT.height - inkHeight) / 2),
      };
    })();
  }
  return prepared;
}

export function colorForName(name: string): { name: string; hex: string } | null {
  return PENDING_CANDIDATE.colors.find((c) => c.name === name) ?? null;
}

export async function renderPendingCandidatePng(colorName = "White"): Promise<Buffer> {
  const color = colorForName(colorName);
  if (!color) throw new Error(`Unknown garment colour: ${colorName}`);
  const prep = await preparePreview();
  const garment = recolorGarment(prep.shading, CELL, CELL, prep.mask, color.hex, prep.medianL);
  const composited = compositePlacedInk({
    garment,
    shading: prep.shading,
    width: CELL,
    height: CELL,
    ink: prep.ink,
    inkWidth: prep.inkWidth,
    inkHeight: prep.inkHeight,
    left: prep.left,
    top: prep.top,
    mask: prep.mask,
  });
  return sharp(composited, { raw: { width: CELL, height: CELL, channels: 4 } }).png().toBuffer();
}
