import sharp from "sharp";
import {
  TOTE_FOLDED_CANVAS_HEIGHT,
  TOTE_FOLDED_CANVAS_WIDTH,
  TOTE_FOLDED_PANEL_HEIGHT,
  TOTE_FOLDED_PANEL_WIDTH,
  type ToteFoldedPlacement,
} from "@shared/toteFoldedLayout";

export type { ToteFoldedPlacement };

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Build the single Printify fulfillment PNG (2650×5250):
 * top panel = front, bottom panel = same art rotated 180°.
 * Uses Sharp composites — the old raw-pixel loop timed out test orders.
 */
export async function buildToteFoldedPrintPng(
  source: Buffer,
  placement?: ToteFoldedPlacement,
): Promise<Buffer> {
  const scale = clamp(placement?.scale ?? 1, 0.05, 4);
  const offsetX = placement?.offsetX ?? 0;
  const offsetY = placement?.offsetY ?? 0;
  const printBack = placement?.printBack !== false;

  const meta = await sharp(source).ensureAlpha().metadata();
  const sw = Math.max(1, meta.width || 1);
  const sh = Math.max(1, meta.height || 1);
  const panelW = TOTE_FOLDED_PANEL_WIDTH;
  const panelH = TOTE_FOLDED_PANEL_HEIGHT;
  const fit = Math.min(panelW / sw, panelH / sh) * scale;
  const drawW = Math.max(1, Math.round(sw * fit));
  const drawH = Math.max(1, Math.round(sh * fit));
  const left = Math.round(panelW / 2 + offsetX * panelW * 0.25 - drawW / 2);
  const top = Math.round(panelH / 2 + offsetY * panelH * 0.25 - drawH / 2);

  const art = await sharp(source).ensureAlpha().resize(drawW, drawH).png().toBuffer();
  const composites: sharp.OverlayOptions[] = [{ input: art, left, top }];
  if (printBack) {
    const art180 = await sharp(art).rotate(180).png().toBuffer();
    composites.push({ input: art180, left, top: panelH + top });
  }

  return sharp({
    create: {
      width: TOTE_FOLDED_CANVAS_WIDTH,
      height: TOTE_FOLDED_CANVAS_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

export async function buildToteFoldedPrintPngFromUrl(
  url: string,
  placement?: ToteFoldedPlacement,
): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch artwork (${res.status})`);
  return buildToteFoldedPrintPng(Buffer.from(await res.arrayBuffer()), placement);
}

export const TOTE_FOLDED_PRINT_DIMS = {
  width: TOTE_FOLDED_CANVAS_WIDTH,
  height: TOTE_FOLDED_CANVAS_HEIGHT,
};
