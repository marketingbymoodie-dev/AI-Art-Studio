/**
 * Lossless print master for direct-renderer decor (2K/4K output).
 * provider output → decode → crop to product aspect (no scaling) → PNG.
 * Never upscales and never re-encodes lossy; thumbnails/mockups are derived separately.
 */
import sharp from "sharp";

export type PrintMasterResult = { buffer: Buffer; width: number; height: number; cropped: boolean };

/** Centre-crop to `aspect` (w/h) at source resolution, then encode lossless PNG. */
export async function toLosslessPrintMaster(input: Buffer, aspect: number | null): Promise<PrintMasterResult> {
  const meta = await sharp(input).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  let left = 0;
  let top = 0;
  let cw = w;
  let ch = h;
  if (aspect && aspect > 0 && w > 0 && h > 0) {
    const src = w / h;
    if (src > aspect + 1e-4) {
      cw = Math.round(h * aspect);
      left = Math.round((w - cw) / 2);
    } else if (src < aspect - 1e-4) {
      ch = Math.round(w / aspect);
      top = Math.round((h - ch) / 2);
    }
  }
  const cropped = cw !== w || ch !== h;
  const img = cropped ? sharp(input).extract({ left, top, width: cw, height: ch }) : sharp(input);
  const buffer = await img.png().toBuffer();
  return { buffer, width: cw, height: ch, cropped };
}
