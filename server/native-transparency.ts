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
