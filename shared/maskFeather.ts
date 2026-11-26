/**
 * Soften a binary print-mask alpha (241 tapestry harvest / load).
 * Hood / poster harvest must not call this — their masks stay hard-edged.
 */

/**
 * 1px boundary-band (half the previous r=2 / 3-pass box blur).
 * Core stays 255; only pixels that touch a transparent neighbor soften.
 * Coverage cutoff α≥128 still sees the full silhouette as core.
 */
export const TAPESTRY_MASK_FEATHER_RADIUS_PX = 1;

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

function hasTransparentNeighbor(
  alpha: ArrayLike<number>,
  w: number,
  h: number,
  x: number,
  y: number,
  radius: number,
): boolean {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue;
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) return true;
      if ((alpha[yy * w + xx] ?? 0) < 16) return true;
    }
  }
  return false;
}

/**
 * Anti-alias only the silhouette boundary. Interior α stays 255 so
 * `pointInMask` (≥128) does not shrink the printable core.
 */
export function featherMaskAlphaFromRgba(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  radiusPx = TAPESTRY_MASK_FEATHER_RADIUS_PX,
): Uint8ClampedArray {
  if (!(w > 0) || !(h > 0)) return data;
  const r = Math.max(1, Math.round(radiusPx));
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = data[i * 4 + 3];
  const out = new Uint8ClampedArray(data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (alpha[i] < 16) continue;
      if (hasTransparentNeighbor(alpha, w, h, x, y, r)) {
        out[i * 4 + 3] = 160;
      }
    }
  }
  return out;
}
