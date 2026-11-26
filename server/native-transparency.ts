/**
 * Alpha check for native-transparent (gpt-image-2) output. There is no chroma
 * fallback on that path, so an opaque result would otherwise be saved as-is.
 */
import sharp from "sharp";

export type TransparencyReport = {
  hasAlpha: boolean;
  /** Share of pixels with alpha < 16. */
  transparentFraction: number;
  /** Share of the 1px border ring with alpha > 240. */
  opaqueBorderFraction: number;
};

/** Opaque = no alpha channel, (almost) nothing transparent, or a solid border ring (a background plate). */
export function isOpaqueNativeOutput(r: TransparencyReport): boolean {
  if (!r.hasAlpha) return true;
  if (r.transparentFraction < 0.01) return true;
  return r.opaqueBorderFraction > 0.95;
}

export type SoftAlphaReport = {
  transparentFraction: number;
  /** Alpha 9–249 among pixels with alpha > 8. High means the ink itself is feathered. */
  featherFractionOfInk: number;
  /** Semi-transparent pixels touching fully clear space, as a share of ink. A halo on a dark garment. */
  haloFractionOfInk: number;
  opaqueBorderFraction: number;
};

/** Full-resolution alpha check for apparel prints. Painterly edges are the production risk. */
export async function measureSoftAlpha(input: Buffer): Promise<SoftAlphaReport> {
  const meta = await sharp(input).metadata();
  if (!meta.hasAlpha) {
    return { transparentFraction: 0, featherFractionOfInk: 0, haloFractionOfInk: 0, opaqueBorderFraction: 1 };
  }
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const n = width * height;
  let transparent = 0;
  let ink = 0;
  let feather = 0;
  let halo = 0;
  let border = 0;
  let borderOpaque = 0;
  const alphaAt = (x: number, y: number) => data[(y * width + x) * 4 + 3];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = alphaAt(x, y);
      if (a < 16) transparent++;
      else {
        ink++;
        if (a < 250) feather++;
        if (a < 200) {
          const clear =
            x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
            alphaAt(x + 1, y) < 16 || alphaAt(x - 1, y) < 16 || alphaAt(x, y + 1) < 16 || alphaAt(x, y - 1) < 16;
          if (clear) halo++;
        }
      }
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        border++;
        if (a > 240) borderOpaque++;
      }
    }
  }
  return {
    transparentFraction: n ? transparent / n : 0,
    featherFractionOfInk: ink ? feather / ink : 0,
    haloFractionOfInk: ink ? halo / ink : 0,
    opaqueBorderFraction: border ? borderOpaque / border : 0,
  };
}

export async function measureTransparency(base64: string): Promise<TransparencyReport> {
  const input = Buffer.from(base64, "base64");
  const meta = await sharp(input).metadata();
  if (!meta.hasAlpha) return { hasAlpha: false, transparentFraction: 0, opaqueBorderFraction: 1 };
  const { data, info } = await sharp(input)
    .resize(256, 256, { fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let transparent = 0;
  let border = 0;
  let borderOpaque = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * channels + (channels - 1)];
      if (a < 16) transparent++;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        border++;
        if (a > 240) borderOpaque++;
      }
    }
  }
  return {
    hasAlpha: true,
    transparentFraction: transparent / (width * height),
    opaqueBorderFraction: border ? borderOpaque / border : 0,
  };
}
