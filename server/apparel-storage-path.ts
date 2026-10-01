/**
 * Which post-processing saveImageToStorage applies.
 * "native": provider PNG alpha is kept as-is (optional vectorize only) — no chroma, no flatten.
 * "chroma": legacy #FF00FF matting for apparel.
 * "decor": full-canvas decor (letterbox strip / aspect resize).
 */
export type StoragePath = "native" | "chroma" | "decor";

export function storagePathFor(opts: { isApparel?: boolean; skipChroma?: boolean }): StoragePath {
  if (opts.isApparel && opts.skipChroma) return "native";
  if (opts.isApparel) return "chroma";
  return "decor";
}
