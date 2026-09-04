import sharp from "sharp";
import {
  TOTE_FOLDED_CANVAS_HEIGHT,
  TOTE_FOLDED_CANVAS_WIDTH,
  TOTE_FOLDED_PANEL_HEIGHT,
  clipToteArtBoxToPanel,
  toteFoldedFaceArtBoxes,
  type ToteFoldedPlacement,
} from "@shared/toteFoldedLayout";

export type { ToteFoldedPlacement };

function parseToteFill(
  hex: string | null | undefined,
): { r: number; g: number; b: number; alpha: number } {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || "").trim());
  if (!m) return { r: 0, g: 0, b: 0, alpha: 0 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, alpha: 1 };
}

/**
 * Build the single Printify fulfillment PNG (2650×5250):
 * top panel = front, bottom panel = same art rotated 180°.
 * Uses Sharp composites — the old raw-pixel loop timed out test orders.
 * `backgroundColor` fills the existing tote canvas (provider bleed) under the
 * subject — it does not resize the canvas or move the art box.
 */
export async function buildToteFoldedPrintPng(
  source: Buffer,
  placement?: ToteFoldedPlacement,
  backgroundColor?: string | null,
): Promise<Buffer> {
  const printBack = placement?.printBack !== false;

  const meta = await sharp(source).ensureAlpha().metadata();
  const sw = Math.max(1, meta.width || 1);
  const sh = Math.max(1, meta.height || 1);
  const { front, back } = toteFoldedFaceArtBoxes(sw, sh, placement);
  const frontVisible = clipToteArtBoxToPanel(front);
  const backVisible = clipToteArtBoxToPanel(back);

  const art = await sharp(source).ensureAlpha().resize(front.drawW, front.drawH).png().toBuffer();
  const composites: sharp.OverlayOptions[] = [];
  if (frontVisible) {
    const face = await sharp(art)
      .extract({
        left: frontVisible.srcLeft,
        top: frontVisible.srcTop,
        width: frontVisible.width,
        height: frontVisible.height,
      })
      .png()
      .toBuffer();
    composites.push({
      input: face,
      left: frontVisible.dstLeft,
      top: frontVisible.dstTop,
    });
  }
  if (printBack && backVisible) {
    const art180 = await sharp(art).rotate(180).png().toBuffer();
    const face180 = await sharp(art180)
      .extract({
        left: backVisible.srcLeft,
        top: backVisible.srcTop,
        width: backVisible.width,
        height: backVisible.height,
      })
      .png()
      .toBuffer();
    composites.push({
      input: face180,
      left: backVisible.dstLeft,
      top: TOTE_FOLDED_PANEL_HEIGHT + backVisible.dstTop,
    });
  }

  return sharp({
    create: {
      width: TOTE_FOLDED_CANVAS_WIDTH,
      height: TOTE_FOLDED_CANVAS_HEIGHT,
      channels: 4,
      background: parseToteFill(backgroundColor),
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

export async function buildToteFoldedPrintPngFromUrl(
  url: string,
  placement?: ToteFoldedPlacement,
  backgroundColor?: string | null,
): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch artwork (${res.status})`);
  return buildToteFoldedPrintPng(
    Buffer.from(await res.arrayBuffer()),
    placement,
    backgroundColor,
  );
}

export const TOTE_FOLDED_PRINT_DIMS = {
  width: TOTE_FOLDED_CANVAS_WIDTH,
  height: TOTE_FOLDED_CANVAS_HEIGHT,
};
