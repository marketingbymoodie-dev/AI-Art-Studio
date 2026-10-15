/**
 * Ink over a garment mockup.
 *
 * Normal alpha first, so opaque ink owes nothing to the garment colour.
 * Then multiply by the shading factor 1 + 0.85 * (L - median L) / median L.
 * L is the shading buffer's luminance. The median is the median of that same
 * buffer (mask pixels when a mask is passed, otherwise every pixel). A white
 * master and a finished colourway use the same call. The recoloured pixels in
 * `garment` are not read for the factor.
 */

export type Rgb = { r: number; g: number; b: number };
export type Rgba = Rgb & { a: number };

export function shadingModulateFactor(shadingL: number, shadingMedianL: number): number {
  if (!(shadingMedianL > 1)) return 1;
  return 1 + 0.85 * ((shadingL - shadingMedianL) / shadingMedianL);
}

export function compositeInkPixel(
  garment: Rgb,
  ink: Rgba,
  shadingL: number,
  shadingMedianL: number,
): Rgb {
  const a = Math.min(1, Math.max(0, ink.a / 255));
  const blendedR = ink.r * a + garment.r * (1 - a);
  const blendedG = ink.g * a + garment.g * (1 - a);
  const blendedB = ink.b * a + garment.b * (1 - a);
  const factor = shadingModulateFactor(shadingL, shadingMedianL);
  const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
  return {
    r: clamp(blendedR * factor),
    g: clamp(blendedG * factor),
    b: clamp(blendedB * factor),
  };
}

/** Nearest-rank 92nd percentile. The brightest 8% sits at or above this value. */
export function percentile92(samples: number[]): number {
  if (samples.length === 0) throw new Error("percentile92 of an empty sample");
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.92 * sorted.length) - 1));
  return sorted[idx];
}

export type PlacedInk = {
  garment: Buffer;
  shading: Buffer;
  width: number;
  height: number;
  ink: Buffer;
  inkWidth: number;
  inkHeight: number;
  left: number;
  top: number;
  /** When set, the fold median is taken from these pixels only. */
  mask?: Uint8Array;
};

const ALPHA_CLAMP = 30;

export function shadingLuminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Median luminance of the shading buffer. Masked calls ignore pixels outside the garment. */
export function medianShadingLuminance(
  shading: Buffer,
  width: number,
  height: number,
  mask?: Uint8Array,
): number {
  const hist = new Uint32Array(256);
  let n = 0;
  const pixels = width * height;
  for (let i = 0; i < pixels; i++) {
    if (mask && !mask[i]) continue;
    const o = i * 4;
    const L = Math.max(0, Math.min(255, Math.round(shadingLuminance(shading[o], shading[o + 1], shading[o + 2]))));
    hist[L]++;
    n++;
  }
  if (n === 0) return 0;
  let acc = 0;
  const mid = n / 2;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= mid) return i;
  }
  return 255;
}

/** Copy `garment` and composite `ink` at left/top. Does not choose placement. */
export function compositePlacedInk(args: PlacedInk): Buffer {
  const { garment, shading, width, height, ink, inkWidth, inkHeight, left, top, mask } = args;
  const shadingMedianL = medianShadingLuminance(shading, width, height, mask);
  const out = Buffer.from(garment);
  for (let y = 0; y < inkHeight; y++) {
    const dy = top + y;
    if (dy < 0 || dy >= height) continue;
    for (let x = 0; x < inkWidth; x++) {
      const dx = left + x;
      if (dx < 0 || dx >= width) continue;
      const s = (y * inkWidth + x) * 4;
      const a = ink[s + 3];
      if (a < ALPHA_CLAMP) continue;
      const di = dy * width + dx;
      const o = di * 4;
      const shadingL = mask && !mask[di]
        ? shadingMedianL
        : shadingLuminance(shading[o], shading[o + 1], shading[o + 2]);
      const pixel = compositeInkPixel(
        { r: out[o], g: out[o + 1], b: out[o + 2] },
        { r: ink[s], g: ink[s + 1], b: ink[s + 2], a },
        shadingL,
        shadingMedianL,
      );
      out[o] = pixel.r;
      out[o + 1] = pixel.g;
      out[o + 2] = pixel.b;
    }
  }
  return out;
}

/** 92nd-percentile RGB of destination pixels where the placed ink alpha is above 8. */
export function inkRegionPercentile92(
  rgba: Buffer,
  width: number,
  ink: Buffer,
  inkWidth: number,
  inkHeight: number,
  left: number,
  top: number,
): Rgb {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = 0; y < inkHeight; y++) {
    const dy = top + y;
    if (dy < 0 || dy >= rgba.length / (width * 4)) continue;
    for (let x = 0; x < inkWidth; x++) {
      const a = ink[(y * inkWidth + x) * 4 + 3];
      if (a <= 8) continue;
      const dx = left + x;
      if (dx < 0 || dx >= width) continue;
      const o = (dy * width + dx) * 4;
      rs.push(rgba[o]);
      gs.push(rgba[o + 1]);
      bs.push(rgba[o + 2]);
    }
  }
  return { r: percentile92(rs), g: percentile92(gs), b: percentile92(bs) };
}
