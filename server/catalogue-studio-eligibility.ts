/**
 * Display-only colour reading for the pending Studio candidate.
 * A region is legible when at least 15% of its pixels have dE2000 > 32
 * against the garment. The design is eligible when every region is.
 * Not wired to promote.
 */
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { PENDING_CANDIDATE } from "./catalogue-studio-preview";

export type ColourEligibility = {
  name: string;
  hex: string;
  minClear: number;
  eligible: boolean;
};

function srgb(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

function labOf(r: number, g: number, b: number): [number, number, number] {
  const R = srgb(r);
  const G = srgb(g);
  const B = srgb(b);
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047);
  const y = f(0.2126729 * R + 0.7151522 * G + 0.072175 * B);
  const z = f((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function dE(a: [number, number, number], b: [number, number, number]): number {
  const [L1, a1, b1] = a;
  const [L2, a2, b2] = b;
  const avgLp = (L1 + L2) / 2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const avgC = (C1 + C2) / 2;
  const avgC7 = avgC ** 7;
  const G = 0.5 * (1 - Math.sqrt(avgC7 / (avgC7 + 25 ** 7)));
  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const avgCp = (C1p + C2p) / 2;
  const hue = (ap: number, bp: number) => {
    if (ap === 0 && bp === 0) return 0;
    const t = (Math.atan2(bp, ap) * 180) / Math.PI;
    return t < 0 ? t + 360 : t;
  };
  const h1 = hue(a1p, b1);
  const h2 = hue(a2p, b2);
  let dh = h2 - h1;
  if (C1p * C2p === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(((dh * Math.PI) / 180) / 2);
  let avgHp = (h1 + h2) / 2;
  if (C1p * C2p !== 0 && Math.abs(h1 - h2) > 180) avgHp += h1 + h2 < 360 ? 180 : -180;
  const T =
    1 -
    0.17 * Math.cos(((avgHp - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * avgHp * Math.PI) / 180) +
    0.32 * Math.cos(((3 * avgHp + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * avgHp - 63) * Math.PI) / 180);
  const Sl = 1 + (0.015 * (avgLp - 50) ** 2) / Math.sqrt(20 + (avgLp - 50) ** 2);
  const Sc = 1 + 0.045 * avgCp;
  const Sh = 1 + 0.015 * avgCp * T;
  const avgCp7 = avgCp ** 7;
  const Rc = 2 * Math.sqrt(avgCp7 / (avgCp7 + 25 ** 7));
  const dTheta = 30 * Math.exp(-(((avgHp - 275) / 25) ** 2));
  const Rt = -Math.sin((2 * dTheta * Math.PI) / 180) * Rc;
  const dL = dLp / Sl;
  const dC = dCp / Sc;
  const dH = dHp / Sh;
  return Math.sqrt(Math.max(0, dL * dL + dC * dC + dH * dH + Rt * dC * dH));
}

function artworkPath(): string | null {
  const dir = path.join(process.env.USERPROFILE || process.env.HOME || "", "Downloads");
  const name = fs.readdirSync(dir).find((n) => n.startsWith("Pug") && n.endsWith(".png") && !n.includes("(1)"));
  return name ? path.join(dir, name) : null;
}

async function measure(file: string): Promise<ColourEligibility[]> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const bg = new Uint8Array(w * h);
  const stack: number[] = [];
  const bgR = data[0];
  const bgG = data[1];
  const bgB = data[2];
  const push = (i: number) => {
    if (i < 0 || i >= w * h || bg[i] || data[i * 4 + 3] < 30) return;
    const o = i * 4;
    if (Math.abs(data[o] - bgR) + Math.abs(data[o + 1] - bgG) + Math.abs(data[o + 2] - bgB) >= 42) return;
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
  const ink = new Uint8Array(w * h);
  const pixels: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (bg[i] || data[i * 4 + 3] < 30) continue;
    ink[i] = 1;
    pixels.push(i);
  }
  const seen = new Uint8Array(w * h);
  const comps: number[][] = [];
  const walk: number[] = [];
  for (const start of pixels) {
    if (seen[start]) continue;
    walk.length = 0;
    walk.push(start);
    seen[start] = 1;
    const comp: number[] = [];
    while (walk.length) {
      const p = walk.pop()!;
      comp.push(p);
      const x = p % w;
      for (const n of [p - 1, p + 1, p - w, p + w]) {
        if (n < 0 || n >= ink.length || seen[n] || !ink[n]) continue;
        if (Math.abs((n % w) - x) > 1) continue;
        seen[n] = 1;
        walk.push(n);
      }
    }
    comps.push(comp);
  }
  const min = Math.max(400, Math.round(pixels.length * 0.01));
  const regions = comps.filter((c) => c.length >= min).map((comp) => comp.map((i) => {
    const o = i * 4;
    return labOf(data[o], data[o + 1], data[o + 2]);
  }));
  return PENDING_CANDIDATE.colors.map((color) => {
    const n = parseInt(color.hex, 16);
    const garment = labOf((n >> 16) & 255, (n >> 8) & 255, n & 255);
    let minClear = 1;
    for (const region of regions) {
      let clear = 0;
      for (const lab of region) if (dE(lab, garment) > 32) clear++;
      minClear = Math.min(minClear, clear / region.length);
    }
    return {
      name: color.name,
      hex: color.hex,
      minClear: regions.length ? minClear : 0,
      eligible: regions.length > 0 && minClear >= 0.15,
    };
  });
}

let cached: Promise<ColourEligibility[] | null> | null = null;

export function pendingColourEligibility(): Promise<ColourEligibility[] | null> {
  if (!cached) {
    cached = (async () => {
      const file = artworkPath();
      if (!file) return null;
      return measure(file);
    })().catch((err) => {
      console.error("[catalogue-studio] eligibility:", (err as Error).message);
      return null;
    });
  }
  return cached;
}
