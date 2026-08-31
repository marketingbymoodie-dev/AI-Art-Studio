/**
 * Indoor wall tapestry (241) magenta-probe recovery.
 *
 * Hood / poster harvest keeps the historical strict RGB gate
 * (`r > 170 && b > 170 && g < 95`). Hanging 241 mockups shade the rod
 * corners so real print magenta falls out of that box. Expand from
 * strict seeds into connected loose-magenta pixels only — isolated
 * pink in the studio is ignored.
 */

/** Historical harvest gate — hood / poster / planarity probe. */
export function isStrictHarvestMagenta(r: number, g: number, b: number): boolean {
  return r > 170 && b > 170 && g < 95;
}

/**
 * Shaded / lit #FF00FF on a hanging tapestry mockup: still R+B dominant,
 * but darker or slightly greener than the strict box.
 */
export function isLooseTapestryMagenta(r: number, g: number, b: number): boolean {
  if (isStrictHarvestMagenta(r, g, b)) return true;
  const chroma = r + b - 2 * g;
  return r >= 90 && b >= 90 && g < 130 && chroma > 80 && Math.abs(r - b) < 90;
}

export type TapestryMagentaMask = {
  maskRaw: Uint8ClampedArray;
  count: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/**
 * Two-pass mask: strict seeds, then 4-connected flood through loose magenta.
 * Does not invent area that never received magenta (rod occlusion).
 */
export function expandTapestryMagentaMask(
  data: ArrayLike<number>,
  width: number,
  height: number,
  channels: number,
): TapestryMagentaMask {
  const n = width * height;
  const seed = new Uint8Array(n);
  const loose = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * channels;
    const r = data[o] ?? 0;
    const g = data[o + 1] ?? 0;
    const b = data[o + 2] ?? 0;
    if (isLooseTapestryMagenta(r, g, b)) loose[i] = 1;
    if (isStrictHarvestMagenta(r, g, b)) seed[i] = 1;
  }

  const keep = new Uint8Array(n);
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    if (seed[i]) {
      keep[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % width;
    const y = (i - x) / width;
    if (x + 1 < width) {
      const r = i + 1;
      if (!keep[r] && loose[r]) {
        keep[r] = 1;
        stack.push(r);
      }
    }
    if (x > 0) {
      const l = i - 1;
      if (!keep[l] && loose[l]) {
        keep[l] = 1;
        stack.push(l);
      }
    }
    if (y + 1 < height) {
      const d = i + width;
      if (!keep[d] && loose[d]) {
        keep[d] = 1;
        stack.push(d);
      }
    }
    if (y > 0) {
      const u = i - width;
      if (!keep[u] && loose[u]) {
        keep[u] = 1;
        stack.push(u);
      }
    }
  }

  const maskRaw = new Uint8ClampedArray(n * 4);
  let count = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    count += 1;
    const x = i % width;
    const y = (i - x) / width;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    const o = i * 4;
    maskRaw[o] = 255;
    maskRaw[o + 1] = 255;
    maskRaw[o + 2] = 255;
    maskRaw[o + 3] = 255;
  }
  return { maskRaw, count, minX, minY, maxX, maxY };
}
