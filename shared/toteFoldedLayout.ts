/**
 * Adjustable dye-sub tote (Printify bp 1300): one print canvas with two face panels.
 * Top panel = normal orientation; bottom panel = same art rotated 180° (Printify fold line).
 */

export const TOTE_FOLDED_V1_TEMPLATE = "tote_folded_v1" as const;

/** Single face panel (Printify spec for adjustable tote). */
export const TOTE_FOLDED_PANEL_WIDTH = 2650;
export const TOTE_FOLDED_PANEL_HEIGHT = 2625;

/** Full fulfillment canvas sent to Printify (two stacked panels). */
export const TOTE_FOLDED_CANVAS_WIDTH = TOTE_FOLDED_PANEL_WIDTH;
export const TOTE_FOLDED_CANVAS_HEIGHT = TOTE_FOLDED_PANEL_HEIGHT * 2;

/** Map full folded canvas dims to single-face panel dims for flat mockup harvest. */
export function normalizeToteFoldedPanelDims(
  width: number,
  height: number,
): { width: number; height: number } {
  if (width === TOTE_FOLDED_CANVAS_WIDTH && height === TOTE_FOLDED_CANVAS_HEIGHT) {
    return { width: TOTE_FOLDED_PANEL_WIDTH, height: TOTE_FOLDED_PANEL_HEIGHT };
  }
  return { width, height };
}

export type ToteFoldedPlacement = {
  scale?: number;
  offsetX?: number;
  offsetY?: number;
  /** When false, only the top (front) panel is printed. Default true. */
  printBack?: boolean;
};

export type ToteFoldedBuildInput = {
  sourceWidth: number;
  sourceHeight: number;
  /** RGBA pixels — length = sourceWidth * sourceHeight * 4 */
  pixels: Buffer;
  placement?: ToteFoldedPlacement;
};

export type ToteFoldedBuildResult = {
  width: number;
  height: number;
  pixels: Buffer;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export type ToteFoldedArtBox = {
  drawW: number;
  drawH: number;
  left: number;
  top: number;
};

/**
 * Contain-fit the art in one tote face, then apply {@link TOTE_FOLDED_CONTAIN_BOOST}.
 * 1.2 filled the Printify bag to the seams; 0.96 is 20% smaller than that.
 * Offsets are fractions of the face (same units as `flatArtBox`).
 */
export const TOTE_FOLDED_CONTAIN_BOOST = 0.96;

/**
 * Printify's bag face sits a little lower than the app mockup.
 * One Fine Position nudge is ~1.1% of the face; lift by three nudges.
 */
export const TOTE_FOLDED_PRINT_OFFSET_Y = -0.033;

export function toteFoldedArtBox(
  sourceWidth: number,
  sourceHeight: number,
  placement?: ToteFoldedPlacement,
): ToteFoldedArtBox {
  const scale = clamp(placement?.scale ?? 1, 0.05, 4);
  const offsetX = placement?.offsetX ?? 0;
  const offsetY = (placement?.offsetY ?? 0) + TOTE_FOLDED_PRINT_OFFSET_Y;
  const sw = sourceWidth > 0 ? sourceWidth : 1;
  const sh = sourceHeight > 0 ? sourceHeight : 1;
  const panelW = TOTE_FOLDED_PANEL_WIDTH;
  const panelH = TOTE_FOLDED_PANEL_HEIGHT;
  const contain = Math.min(panelW / sw, panelH / sh);
  const k = contain * TOTE_FOLDED_CONTAIN_BOOST * scale;
  const drawW = Math.max(1, Math.round(sw * k));
  const drawH = Math.max(1, Math.round(sh * k));
  const cx = panelW * (0.5 + offsetX);
  const cy = panelH * (0.5 + offsetY);
  return {
    drawW,
    drawH,
    left: Math.round(cx - drawW / 2),
    top: Math.round(cy - drawH / 2),
  };
}

/** Visible intersection of a (possibly overflowing) art box with one face panel. */
export function clipToteArtBoxToPanel(
  box: ToteFoldedArtBox,
): {
  srcLeft: number;
  srcTop: number;
  dstLeft: number;
  dstTop: number;
  width: number;
  height: number;
} | null {
  const panelW = TOTE_FOLDED_PANEL_WIDTH;
  const panelH = TOTE_FOLDED_PANEL_HEIGHT;
  let srcLeft = 0;
  let srcTop = 0;
  let dstLeft = box.left;
  let dstTop = box.top;
  let width = box.drawW;
  let height = box.drawH;
  if (dstLeft < 0) {
    srcLeft = -dstLeft;
    width += dstLeft;
    dstLeft = 0;
  }
  if (dstTop < 0) {
    srcTop = -dstTop;
    height += dstTop;
    dstTop = 0;
  }
  if (dstLeft + width > panelW) width = panelW - dstLeft;
  if (dstTop + height > panelH) height = panelH - dstTop;
  if (width < 1 || height < 1) return null;
  return { srcLeft, srcTop, dstLeft, dstTop, width, height };
}

/**
 * Pure math: compose top panel + 180°-rotated bottom panel into one RGBA buffer.
 * Used by server sharp pipeline and unit tests.
 */
export function composeToteFoldedCanvas(input: ToteFoldedBuildInput): ToteFoldedBuildResult {
  const { sourceWidth, sourceHeight, pixels } = input;
  const { drawW, drawH, left, top } = toteFoldedArtBox(
    sourceWidth,
    sourceHeight,
    input.placement,
  );

  const panelW = TOTE_FOLDED_PANEL_WIDTH;
  const panelH = TOTE_FOLDED_PANEL_HEIGHT;
  const canvasW = TOTE_FOLDED_CANVAS_WIDTH;
  const canvasH = TOTE_FOLDED_CANVAS_HEIGHT;

  const out = Buffer.alloc(canvasW * canvasH * 4, 0);

  const sample = (sx: number, sy: number) => {
    const x = clamp(Math.floor(sx), 0, sourceWidth - 1);
    const y = clamp(Math.floor(sy), 0, sourceHeight - 1);
    const i = (y * sourceWidth + x) * 4;
    return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]] as const;
  };

  const writePanel = (panelTop: number, rotate180: boolean) => {
    for (let dy = 0; dy < panelH; dy++) {
      for (let dx = 0; dx < panelW; dx++) {
        let lx = dx - left;
        let ly = dy - top;
        if (rotate180) {
          lx = drawW - 1 - lx;
          ly = drawH - 1 - ly;
        }
        if (lx < 0 || ly < 0 || lx >= drawW || ly >= drawH) continue;
        const sx = (lx / drawW) * sourceWidth;
        const sy = (ly / drawH) * sourceHeight;
        const [r, g, b, a] = sample(sx, sy);
        if (a === 0) continue;
        const oi = ((panelTop + dy) * canvasW + dx) * 4;
        out[oi] = r;
        out[oi + 1] = g;
        out[oi + 2] = b;
        out[oi + 3] = a;
      }
    }
  };

  writePanel(0, false);
  if (input.placement?.printBack !== false) {
    writePanel(panelH, true);
  }

  return { width: canvasW, height: canvasH, pixels: out };
}
