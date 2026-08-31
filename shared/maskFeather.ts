/**
 * Soften a binary print-mask alpha (241 tapestry harvest / load).
 * Hood / poster harvest must not call this — their masks stay hard-edged.
 */

/** ~2px gaussian-equivalent (3 box passes) over the whole perimeter. */
export const TAPESTRY_MASK_FEATHER_RADIUS_PX = 2;

/** True when opaque pixels are almost all 255 — no existing soft ramp. */
export function maskAlphaLooksBinary(
  data: ArrayLike<number>,
  w: number,
  h: number,
): boolean {
  let opaque = 0;
  let mid = 0;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3];
    if (a === 0) continue;
    opaque += 1;
    if (a < 250) mid += 1;
  }
  if (opaque === 0) return false;
  return mid / opaque < 0.02;
}

function boxBlurAlpha1D(
  src: Float64Array,
  w: number,
  h: number,
  radius: number,
  horizontal: boolean,
): Float64Array {
  const out = new Float64Array(src.length);
  const r = Math.max(1, radius);
  const denom = r * 2 + 1;
  if (horizontal) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) {
          const xx = Math.min(w - 1, Math.max(0, x + k));
          sum += src[row + xx];
        }
        out[row + x] = sum / denom;
      }
    }
  } else {
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) {
          const yy = Math.min(h - 1, Math.max(0, y + k));
          sum += src[yy * w + x];
        }
        out[y * w + x] = sum / denom;
      }
    }
  }
  return out;
}

/**
 * Blur alpha only (RGB unchanged). 3 separable box passes ≈ small gaussian.
 * Does not change core-vs-feather classification at α≥128 beyond a ~radius inset.
 */
export function featherMaskAlphaFromRgba(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  radiusPx = TAPESTRY_MASK_FEATHER_RADIUS_PX,
): Uint8ClampedArray {
  if (!(w > 0) || !(h > 0)) return data;
  const r = Math.max(1, Math.round(radiusPx));
  let alpha = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = data[i * 4 + 3];
  for (let pass = 0; pass < 3; pass++) {
    alpha = boxBlurAlpha1D(alpha, w, h, r, true);
    alpha = boxBlurAlpha1D(alpha, w, h, r, false);
  }
  const out = new Uint8ClampedArray(data);
  for (let i = 0; i < w * h; i++) {
    out[i * 4 + 3] = Math.round(alpha[i]);
  }
  return out;
}
