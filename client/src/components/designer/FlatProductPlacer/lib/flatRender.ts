/**
 * Local canvas renderer for the on-the-fly flat / mesh mockup placer.
 *
 * Given a calibrated blank garment photo + a print-area mask + (optionally) a
 * shading map, it composites the customer's artwork onto the blank so the
 * storefront preview matches what Printify would produce — without a Printify
 * round-trip. The same composite is exported (toBlob/toDataURL) for the cart /
 * checkout shadow-SKU image, so it MUST be pixel-identical to the live canvas.
 *
 * Two tiers (decided server-side in `server/flat-calibration.ts`):
 *   - flat : planar surface → the artwork is blitted into the visible print
 *            rect (a simple scaled draw) then clipped to the mask silhouette.
 *   - mesh : mildly curved surface (e.g. cap front) → the artwork is first
 *            rendered into a flat "print-area" canvas, then warped through the
 *            stored mesh control points via `drawMeshWarp`, then clipped.
 *
 * Two shading modes (per view, also decided server-side):
 *   - "blank" : multiply the blank garment's own (normalized) luminance over
 *               the artwork — gives fabric folds / AO on apparel. Normalized
 *               around the masked mean so dark garments don't crush the art.
 *   - "map"   : multiply the normalized gray-pass shading map over the artwork
 *               — used for white / rigid surfaces whose blank carries little
 *               tonal range but whose render bakes gloss / AO.
 *
 * Coordinate invariant: placement is stored in NORMALIZED print-rect units
 * (`scale` relative to a "cover the rect" baseline, `offsetX/offsetY` as a
 * fraction of the rect's width/height). This keeps the data reusable for the
 * eventual print-file generation (a separate, out-of-scope task) without any
 * mockup-pixel coupling.
 */

import { drawMeshWarp } from "@/components/hoodie-template-mapper/lib/meshWarp";
import type { ArtworkPlacement } from "@/components/hoodie-template-mapper/lib/aopPreview";
import type { MeshGrid, Pt } from "@shared/hoodieTemplate";
import type {
  FlatTier,
  FlatViewCalibration,
} from "@/pages/embed-design";

export type Rect = { x: number; y: number; width: number; height: number };

/** Lowest allowed placement scale (slider / drag). */
export const FLAT_SCALE_MIN = 0.2;
/** First-open contain-fit may go below the slider min so extreme aspects still fit. */
export const FLAT_SCALE_FIT_FLOOR = 0.05;
/** Apparel cap — baked print files honor this; Printify's own placement API still clamps at 1. */
export const FLAT_SCALE_MAX = 1.5;
/** Phone edge-wrap — zoom in to cover side strip + bleed. */
export const FLAT_SCALE_MAX_EDGE_WRAP = 2.0;
/** Framed / decor — zoom in to crop built-in borders past the mat opening. */
export const FLAT_SCALE_MAX_DECOR = 2.5;
/** Tapestry — zoom past 100% so art can refill after nudging (avoid raw weave). */
export const FLAT_SCALE_MAX_FABRIC = 2.0;
/**
 * Standard flat DTG apparel (tees etc.): start under 100% so chest art fits
 * inside the dashed print guide. Slider max is 150% so AOP / tall blanks can
 * cover top and bottom. Apparel seed used to inherit the old 135%
 * Printify-mockup zoom, which always overflowed.
 */
export const FLAT_APPAREL_DEFAULT_SCALE = 0.85;

export function flatPlacementScaleMax(opts: {
  edgeWrapMode?: boolean;
  decorMode?: boolean;
  fabricWeave?: boolean;
}): number {
  if (opts.edgeWrapMode) return FLAT_SCALE_MAX_EDGE_WRAP;
  if (opts.decorMode) return FLAT_SCALE_MAX_DECOR;
  if (opts.fabricWeave) return FLAT_SCALE_MAX_FABRIC;
  return FLAT_SCALE_MAX;
}

/** Seed / reset placement scale for flat placer (print placement, not preview zoom). */
export function flatDefaultPlacementScale(opts: {
  edgeWrapMode?: boolean;
  decorMode?: boolean;
  fabricWeave?: boolean;
  /** Percent zoom used for decor / edge-wrap / fabric (e.g. 110). Ignored for apparel. */
  zoomPercent?: number;
}): number {
  const max = flatPlacementScaleMax(opts);
  if (opts.edgeWrapMode || opts.decorMode || opts.fabricWeave) {
    const pct = typeof opts.zoomPercent === "number" ? opts.zoomPercent : 100;
    return Math.max(FLAT_SCALE_MIN, Math.min(max, pct / 100));
  }
  return Math.min(max, FLAT_APPAREL_DEFAULT_SCALE);
}

/**
 * Apparel chest prints (DTG / non-bleed) get a first-open contain-fit into
 * the dashed print guide. Decor / edge-wrap / tapestry are meant to cover or
 * bleed the print area — do not shrink those.
 */
export function flatShouldFitToSafeArea(opts: {
  edgeWrapMode?: boolean;
  decorMode?: boolean;
  fabricWeave?: boolean;
}): boolean {
  return !opts.edgeWrapMode && !opts.decorMode && !opts.fabricWeave;
}

/**
 * Placement `scale` (cover baseline) that contain-fits the artwork box in
 * `rect`. Matching aspects → 1; a mismatch is contain/cover (always ≤ 1).
 */
export function flatContainPlacementScale(
  rect: Rect,
  artW: number,
  artH: number,
  rotationDeg = 0,
): number {
  const aw = artW > 0 ? artW : 1;
  const ah = artH > 0 ? artH : 1;
  const rw = rect.width > 0 ? rect.width : 1;
  const rh = rect.height > 0 ? rect.height : 1;
  const cover = Math.max(rw / aw, rh / ah);
  if (!(cover > 0) || !Number.isFinite(cover)) return 1;
  let fit = Math.min(rw / aw, rh / ah) / cover;
  const deg = Number.isFinite(rotationDeg) ? rotationDeg : 0;
  if (deg % 180 !== 0) {
    const rad = (deg * Math.PI) / 180;
    const c = Math.abs(Math.cos(rad));
    const s = Math.abs(Math.sin(rad));
    const denomW = cover * (aw * c + ah * s);
    const denomH = cover * (aw * s + ah * c);
    if (denomW > 0) fit = Math.min(fit, rw / denomW);
    if (denomH > 0) fit = Math.min(fit, rh / denomH);
  }
  if (!Number.isFinite(fit) || fit <= 0) return FLAT_SCALE_FIT_FLOOR;
  return Math.max(FLAT_SCALE_FIT_FLOOR, Math.min(FLAT_SCALE_MAX, fit));
}

/**
 * First-open fit: scale down (never up) so the artwork box sits inside `rect`,
 * preserve aspect, center. Offsets from another product are cleared.
 */
export function flatFitPlacementToSafeArea(
  rect: Rect,
  artW: number,
  artH: number,
  current: ArtworkPlacement,
): ArtworkPlacement {
  const contain = flatContainPlacementScale(
    rect,
    artW,
    artH,
    current.rotationDeg,
  );
  const scale = Math.min(current.scale, contain);
  return {
    ...current,
    scale: Math.max(FLAT_SCALE_FIT_FLOOR, scale),
    offsetX: 0,
    offsetY: 0,
  };
}

/** Floor for the normalized shading multiply so artwork never goes fully black. */
const SHADE_FACTOR_MIN = 0.45;

/** Per-layer nudge from the flat calibrator admin tool (normalized to print canvas). */
export type CalibratorLayerAdjust = {
  offsetX: number;
  offsetY: number;
  scale: number;
};

export type FlatPreviewLayers = {
  blank?: boolean;
  shading?: boolean;
  artwork?: boolean;
};

export function adjustCalibratorDrawRect(
  rect: Rect,
  adj: CalibratorLayerAdjust | undefined,
  canvasW: number,
  canvasH: number,
): Rect {
  if (!adj || (adj.offsetX === 0 && adj.offsetY === 0 && adj.scale === 1)) {
    return rect;
  }
  const w = rect.width * adj.scale;
  const h = rect.height * adj.scale;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return {
    x: cx - w / 2 + adj.offsetX * canvasW,
    y: cy - h / 2 + adj.offsetY * canvasH,
    width: w,
    height: h,
  };
}

export type FlatRenderInput = {
  /** Target canvas — sized to the blank's natural (mockup) dimensions. */
  target: HTMLCanvasElement;
  /** Base garment photo for the selected colour + view. */
  blank: HTMLImageElement;
  /** White-on-transparent print silhouette. `null` → no mask clip. */
  mask: HTMLImageElement | null;
  /** Gray-pass shading map (used only when `view.shadingMode === "map"`). */
  shading: HTMLImageElement | null;
  /** Customer artwork. `null` → no art on this face (fill still applies). */
  artwork: HTMLImageElement | null;
  view: FlatViewCalibration;
  placement: ArtworkPlacement;
  tier: FlatTier;
  /** When false, skip pixel-read shading normalize (display-only cross-origin art). */
  artworkCorsClean?: boolean;
  /** Phone cases / rigid products — use harvested gray shading map when present. */
  forceShadingMap?: boolean;
  /** Edge-print phone cases — placement uses full print bounds, not safe zone. */
  edgeWrapMode?: boolean;
  /**
   * Customer fill under artwork. Phone cases: out to the blue dashed print
   * canvas (grey chrome when unset). Decor / tote: both faces, even when
   * that view's artwork is off — matches the bake.
   */
  printCanvasBackgroundColor?: string | null;
  /** Framed / decor — placement uses visible mat opening; scale may exceed 1. */
  decorMode?: boolean;
  /** Woven fabric procedural texture (tapestry only unless admin-enabled). */
  fabricWeave?: boolean;
  sizeId?: string;
  /** Crop to back face when the mockup has a side-profile strip (iPhone 14/15). */
  cropToBackFace?: boolean;
  /** Manual per-layer alignment (flat calibrator → storefront). */
  layerAdjust?: {
    blank?: CalibratorLayerAdjust;
    mask?: CalibratorLayerAdjust;
    shading?: CalibratorLayerAdjust;
  };
  /** Calibrator / debug — toggle compositing stages. */
  previewLayers?: FlatPreviewLayers;
  /**
   * Recolor a shared/default apparel blank to the selected garment colour.
   * Used when harvest only has one blank (canonical zip hoodie).
   */
  garmentColorHex?: string | null;
};

function parseCssHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * Keep garment folds (source luminance) but shift chromaticity toward `hex`
 * so Navy / Black / Sport Grey are distinguishable on a single harvested blank.
 */
export function colorizeApparelBlank(
  source: CanvasImageSource,
  hex: string,
  width?: number,
  height?: number,
): HTMLCanvasElement {
  const w =
    width ||
    (source instanceof HTMLImageElement
      ? source.naturalWidth || source.width
      : (source as HTMLCanvasElement).width);
  const h =
    height ||
    (source instanceof HTMLImageElement
      ? source.naturalHeight || source.height
      : (source as HTMLCanvasElement).height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const rgb = parseCssHex(hex);
  if (!rgb) return canvas;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const targetY = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    const y = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    const outY = Math.max(0, Math.min(1, y * 0.42 + targetY * 0.58));
    d[i] = Math.round(rgb.r * outY);
    d[i + 1] = Math.round(rgb.g * outY);
    d[i + 2] = Math.round(rgb.b * outY);
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function imgDims(img: HTMLImageElement): { w: number; h: number } {
  return {
    w: img.naturalWidth || img.width,
    h: img.naturalHeight || img.height,
  };
}

/** Valid `#RRGGBB` print-canvas fill, or null. */
export function parsePrintCanvasFillHex(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const hex = raw.trim();
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : null;
}

/**
 * A view still composites a print layer when artwork is off but a fill hex
 * is set (tote / pillow back with print-on-back disabled).
 */
export function flatViewPaintsPrintLayer(
  artwork: HTMLImageElement | null,
  printCanvasBackgroundColor?: string | null,
): boolean {
  if (parsePrintCanvasFillHex(printCanvasBackgroundColor)) return true;
  if (!artwork) return false;
  const { w, h } = imgDims(artwork);
  return w > 0 && h > 0;
}

/** True when blank and mask share the same pixel coordinate space (±8%). */
function maskAlignsWithBlank(
  blank: HTMLImageElement,
  mask: HTMLImageElement | null,
  tolerance = 0.08,
): boolean {
  if (!mask) return false;
  const { w: bw, h: bh } = imgDims(blank);
  const { w: mw, h: mh } = imgDims(mask);
  if (bw <= 0 || bh <= 0 || mw <= 0 || mh <= 0) return false;
  return (
    Math.abs(bw - mw) / Math.max(bw, mw) <= tolerance &&
    Math.abs(bh - mh) / Math.max(bh, mh) <= tolerance
  );
}

/**
 * Visible print rect in mockup pixels. Falls back to the full canvas when the
 * server couldn't detect a silhouette (`visibleRectNormalized === null`).
 */
function normalizedRectPx(
  nr: { x: number; y: number; width: number; height: number } | null | undefined,
  canvasW: number,
  canvasH: number,
): Rect | null {
  if (!nr) return null;
  return {
    x: nr.x * canvasW,
    y: nr.y * canvasH,
    width: nr.width * canvasW,
    height: nr.height * canvasH,
  };
}

export function flatVisibleRectPx(
  view: FlatViewCalibration,
  canvasW: number,
  canvasH: number,
): Rect {
  return (
    normalizedRectPx(view.visibleRectNormalized, canvasW, canvasH) ?? {
      x: 0,
      y: 0,
      width: canvasW,
      height: canvasH,
    }
  );
}

/**
 * Match harvest `REG_VERTICAL_OVERSCAN` (1.12). Printify clips that overscan
 * out of the mockup magenta AABB but still accepts art in the taller print
 * file — so the dashed guide must grow or it reads short at the collar.
 */
/** Fallback only when no mask — prefer reharvest with REG_VERTICAL_OVERSCAN 1.2. */
export const FLAT_APPAREL_PRINT_GUIDE_HEIGHT_BOOST = 1.2;

/**
 * Magenta harvest AABB often understates Printify printable height: at
 * scale=1 Printify width-fills and clips vertical overscan, so the detected
 * rect can be shorter than the real print area. Grow height (keep width + X),
 * preferring expansion toward the collar; clamp to the mockup.
 */
export function expandPrintGuideToPrintFileAspect(
  rect: Rect,
  printFileDims: { width: number; height: number } | null | undefined,
  canvasW: number,
  canvasH: number,
  heightBoost: number = FLAT_APPAREL_PRINT_GUIDE_HEIGHT_BOOST,
): Rect {
  if (!(rect.width > 0) || !(rect.height > 0) || !(canvasH > 0)) return rect;

  const pfW = printFileDims?.width ?? 0;
  const pfH = printFileDims?.height ?? 0;
  // Tallest of: current height, printFileDims aspect, harvest overscan boost.
  let targetH = rect.height * Math.max(1, heightBoost);
  if (pfW > 0 && pfH > 0) {
    targetH = Math.max(targetH, rect.width * (pfH / pfW));
  }
  if (!(targetH > rect.height + 0.5)) return rect;

  if (targetH >= canvasH - 0.5) {
    return { x: rect.x, y: 0, width: rect.width, height: canvasH };
  }

  // ~70% of the extra height goes upward (collar / neckline side).
  const extra = targetH - rect.height;
  let y = rect.y - extra * 0.7;
  if (y < 0) y = 0;
  if (y + targetH > canvasH) y = canvasH - targetH;
  return { x: rect.x, y, width: rect.width, height: targetH };
}

/** Full print silhouette from manifest (harvested mask bbox). */
export function flatPrintBoundsRectPx(
  view: FlatViewCalibration,
  canvasW: number,
  canvasH: number,
): Rect | null {
  return normalizedRectPx(
    view.printBoundsNormalized ?? view.visibleRectNormalized,
    canvasW,
    canvasH,
  );
}

function rectsNearlyEqual(a: Rect, b: Rect, eps = 2): boolean {
  return (
    Math.abs(a.x - b.x) <= eps &&
    Math.abs(a.y - b.y) <= eps &&
    Math.abs(a.width - b.width) <= eps &&
    Math.abs(a.height - b.height) <= eps
  );
}

/** Preview canvas width — height follows printFileDims aspect. */
export const FLAT_PRINT_PREVIEW_BASE_PX = 900;

/** Approximate safe back-face guide when harvest stored only one bbox (legacy manifests). */
export function flatEdgeWrapSafeZoneRectPx(outer: Rect, insetFraction = 0.04): Rect {
  const mx = outer.width * insetFraction;
  const my = outer.height * insetFraction;
  return {
    x: outer.x + mx,
    y: outer.y + my,
    width: Math.max(1, outer.width - 2 * mx),
    height: Math.max(1, outer.height - 2 * my),
  };
}

export function flatPrintCanvasPreviewDims(view: FlatViewCalibration): { width: number; height: number } {
  const pfW = view.printFileDims?.width ?? 1;
  const pfH = view.printFileDims?.height ?? 1;
  const w = FLAT_PRINT_PREVIEW_BASE_PX;
  return { width: w, height: Math.max(1, Math.round(w * (pfH / pfW))) };
}

function normRectToPx(nr: NormRect, canvasW: number, canvasH: number): Rect {
  return {
    x: nr.x * canvasW,
    y: nr.y * canvasH,
    width: nr.width * canvasW,
    height: nr.height * canvasH,
  };
}

export type FlatPrintCanvasLayout = {
  previewW: number;
  previewH: number;
  /** Full print canvas (grey box) — placement + outer guide. */
  printCanvas: Rect;
  /** Visible phone silhouette region (mask alpha bounds, centered in print canvas). */
  phoneBack: Rect;
  /** Safe zone (amber dashed guide) — inset inside phoneBack. */
  safeZone: Rect;
  /** Where to draw blank/mask/shading so phoneBack aligns with the silhouette. */
  imageDraw: Rect;
  /** Source crop on uncropped blank/mask assets (side-profile mockups). */
  sourceCrop: Rect | null;
};

function fitAspectCenteredInCanvas(contentAspect: number, canvasAspect: number): NormRect {
  let w: number;
  let h: number;
  if (contentAspect >= canvasAspect) {
    w = 1;
    h = canvasAspect / contentAspect;
  } else {
    h = 1;
    w = contentAspect / canvasAspect;
  }
  return {
    x: (1 - w) / 2,
    y: (1 - h) / 2,
    width: w,
    height: h,
  };
}

/**
 * Printify bleed model: print file = phone back + EQUAL margin on all 4 sides.
 * Solve the unique phone size whose horizontal and vertical margins match:
 *   w + 2m = W,  h + 2m = H,  w/h = aspect  →  h = (H - W) / (1 - aspect)
 * Returns null when no sane solution exists (caller falls back to aspect-fit).
 */
function fitEqualMarginInCanvas(
  contentAspect: number,
  canvasW: number,
  canvasH: number,
): Rect | null {
  if (!(contentAspect > 0) || canvasW <= 0 || canvasH <= 0) return null;
  if (Math.abs(1 - contentAspect) < 1e-4) return null;
  const h = (canvasH - canvasW) / (1 - contentAspect);
  const w = contentAspect * h;
  if (!(w > 0) || !(h > 0) || w > canvasW + 0.5 || h > canvasH + 0.5) return null;
  const m = (canvasW - w) / 2;
  // Reject degenerate solutions (negative bleed or phone under half the box).
  if (m < 0 || w < canvasW * 0.5 || h < canvasH * 0.5) return null;
  return { x: m, y: (canvasH - h) / 2, width: w, height: h };
}

export type FlatPrintCanvasLayoutAssets = {
  mask?: HTMLImageElement | null;
  blank?: HTMLImageElement | null;
};

/** Printify editor grey — bleed area around the phone silhouette. */
const PRINT_CANVAS_GREY = "#d4d4d4";

function resolveEdgeWrapSourceCrop(
  view: FlatViewCalibration,
  img: HTMLImageElement | null,
): Rect | null {
  if (!img) return null;
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (iw <= 0 || ih <= 0) return null;

  const mw = view.mockupDims?.width ?? iw;
  const mh = view.mockupDims?.height ?? ih;
  if (view.sideProfileCropped && Math.abs(iw - mw) <= 3 && Math.abs(ih - mh) <= 3) {
    return null;
  }

  const sideSrc = view.sideProfileSourceCropNormalized as NormRect | null | undefined;
  if (sideSrc && sideSrc.width > 0 && sideSrc.width < 0.98) {
    const crop = normalizedRectPx(sideSrc, iw, ih);
    if (crop) return crop;
  }

  if (view.backFaceCropNormalized) {
    const crop = normalizedRectPx(view.backFaceCropNormalized as NormRect, iw, ih);
    if (crop && crop.width < iw * 0.97) return crop;
  }

  const detected = detectEdgeWrapBackFaceFromMask(img);
  if (detected && detected.width < iw * 0.97) return detected;
  return null;
}

/** Map mask alpha bounds into print-canvas preview space (Printify grey-box model). */
function layoutPhoneFromMaskBounds(
  view: FlatViewCalibration,
  bounds: Rect,
  srcW: number,
  srcH: number,
  previewW: number,
  previewH: number,
): { phoneBack: Rect; imageDraw: Rect; safeZone: Rect } {
  const pfW = view.printFileDims?.width ?? previewW;
  const pfH = view.printFileDims?.height ?? previewH;
  const canvasAspect = pfW / Math.max(pfH, 1);
  const boundsAspect = bounds.width / Math.max(bounds.height, 1);

  // Equal bleed margin on all 4 sides (Printify grey-box model); aspect-fit
  // only as a fallback when the mask aspect makes that unsolvable.
  const phoneBack =
    fitEqualMarginInCanvas(boundsAspect, previewW, previewH) ??
    normRectToPx(
      fitAspectCenteredInCanvas(boundsAspect, canvasAspect),
      previewW,
      previewH,
    );

  const relX = bounds.x / Math.max(srcW, 1);
  const relY = bounds.y / Math.max(srcH, 1);
  const relW = bounds.width / Math.max(srcW, 1);
  const relH = bounds.height / Math.max(srcH, 1);

  const imageDraw: Rect = {
    x: phoneBack.x - (relX / Math.max(relW, 1e-6)) * phoneBack.width,
    y: phoneBack.y - (relY / Math.max(relH, 1e-6)) * phoneBack.height,
    width: phoneBack.width / Math.max(relW, 1e-6),
    height: phoneBack.height / Math.max(relH, 1e-6),
  };

  // Stored safe zone is relative to the harvested phoneBack — remap it onto the
  // live phoneBack so the amber guide always tracks the rendered silhouette.
  const storedSafe = view.safeZoneNormalized as NormRect | null | undefined;
  const storedPhone = view.phoneBackNormalized as NormRect | null | undefined;
  let safeZone: Rect;
  if (
    storedSafe && storedSafe.width > 0 && storedSafe.height > 0 &&
    storedPhone && storedPhone.width > 0 && storedPhone.height > 0
  ) {
    const relX = (storedSafe.x - storedPhone.x) / storedPhone.width;
    const relY = (storedSafe.y - storedPhone.y) / storedPhone.height;
    const relW = storedSafe.width / storedPhone.width;
    const relH = storedSafe.height / storedPhone.height;
    safeZone = {
      x: phoneBack.x + relX * phoneBack.width,
      y: phoneBack.y + relY * phoneBack.height,
      width: relW * phoneBack.width,
      height: relH * phoneBack.height,
    };
  } else if (storedSafe && storedSafe.width > 0 && storedSafe.height > 0) {
    safeZone = normRectToPx(storedSafe, previewW, previewH);
  } else {
    safeZone = flatEdgeWrapSafeZoneRectPx(phoneBack);
  }

  return { phoneBack, imageDraw, safeZone };
}

/**
 * Print-canvas-centric layout for edge-wrap phone cases.
 * Centers the mask silhouette (not the PNG rectangle) inside printFileDims.
 */
export function flatPrintCanvasLayout(
  view: FlatViewCalibration,
  assets?: FlatPrintCanvasLayoutAssets,
): FlatPrintCanvasLayout {
  const { width: previewW, height: previewH } = flatPrintCanvasPreviewDims(view);
  const printCanvas: Rect = { x: 0, y: 0, width: previewW, height: previewH };

  const mask = assets?.mask ?? null;
  const blank = assets?.blank ?? null;
  const maskAligned = mask && blank ? maskAlignsWithBlank(blank, mask) : false;

  // Live mask layout only when mask + blank share coordinates. Per-model cropped
  // blanks use stored phoneBack/safeZone from geometryByBlank instead.
  if (mask && maskAligned) {
    const iw = mask.naturalWidth || mask.width;
    const ih = mask.naturalHeight || mask.height;
    const sourceCrop = resolveEdgeWrapSourceCrop(view, mask);
    const srcW = sourceCrop?.width ?? iw;
    const srcH = sourceCrop?.height ?? ih;

    let bounds = flatImageAlphaBounds(mask);
    if (bounds && sourceCrop) {
      const x = Math.max(sourceCrop.x, bounds.x);
      const y = Math.max(sourceCrop.y, bounds.y);
      const r = Math.min(sourceCrop.x + sourceCrop.width, bounds.x + bounds.width);
      const b = Math.min(sourceCrop.y + sourceCrop.height, bounds.y + bounds.height);
      bounds = {
        x: x - sourceCrop.x,
        y: y - sourceCrop.y,
        width: Math.max(1, r - x),
        height: Math.max(1, b - y),
      };
    }

    if (bounds && bounds.width > 4 && bounds.height > 4) {
      const laid = layoutPhoneFromMaskBounds(view, bounds, srcW, srcH, previewW, previewH);
      return {
        previewW,
        previewH,
        printCanvas,
        phoneBack: laid.phoneBack,
        safeZone: laid.safeZone,
        imageDraw: laid.imageDraw,
        sourceCrop,
      };
    }
  }

  const storedPhone = view.phoneBackNormalized as NormRect | null | undefined;
  const storedSafe = view.safeZoneNormalized as NormRect | null | undefined;
  const phoneBack = storedPhone
    ? normRectToPx(storedPhone, previewW, previewH)
    : printCanvas;
  const safeZone = storedSafe
    ? normRectToPx(storedSafe, previewW, previewH)
    : flatEdgeWrapSafeZoneRectPx(phoneBack);

  const sourceCrop = resolveEdgeWrapSourceCrop(view, blank ?? mask);
  let imageDraw = phoneBack;
  if (blank && sourceCrop) {
    const iw = blank.naturalWidth || blank.width;
    const ih = blank.naturalHeight || blank.height;
    const relX = sourceCrop.x / Math.max(iw, 1);
    const relY = sourceCrop.y / Math.max(ih, 1);
    const relW = sourceCrop.width / Math.max(iw, 1);
    const relH = sourceCrop.height / Math.max(ih, 1);
    imageDraw = {
      x: phoneBack.x - (relX / Math.max(relW, 1e-6)) * phoneBack.width,
      y: phoneBack.y - (relY / Math.max(relH, 1e-6)) * phoneBack.height,
      width: phoneBack.width / Math.max(relW, 1e-6),
      height: phoneBack.height / Math.max(relH, 1e-6),
    };
  }

  return {
    previewW,
    previewH,
    printCanvas,
    phoneBack,
    safeZone,
    imageDraw,
    sourceCrop,
  };
}

export { PRINT_CANVAS_GREY };

/** Map a rect from one pixel space into another (uniform per-axis scale). */
export function scaleRectToCanvas(
  rect: Rect,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Rect {
  const sx = dstW / Math.max(1, srcW);
  const sy = dstH / Math.max(1, srcH);
  return {
    x: rect.x * sx,
    y: rect.y * sy,
    width: rect.width * sx,
    height: rect.height * sy,
  };
}

const maskAlphaBoundsCache = new WeakMap<HTMLImageElement, Rect | null>();

/** Cached alpha AABB of a mask image (native mask pixels). */
export function flatMaskAlphaBoundsCached(
  mask: HTMLImageElement,
): Rect | null {
  if (maskAlphaBoundsCache.has(mask)) return maskAlphaBoundsCache.get(mask)!;
  const bounds = flatImageAlphaBounds(mask);
  maskAlphaBoundsCache.set(mask, bounds);
  return bounds;
}

/**
 * Opaque-content bounds of an artwork image as fractions of its pixel size.
 * Generated/uploaded PNGs often carry transparent padding; the bounding box
 * and trim warnings should track the visible pixels, not the padded rect.
 * Null when unreadable (cross-origin without CORS) or fully transparent —
 * callers fall back to the full image rect.
 */
export type ArtContentFractions = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const artContentFractionsCache = new WeakMap<
  HTMLImageElement,
  ArtContentFractions | null
>();

export function flatArtContentFractionsCached(
  artwork: HTMLImageElement,
): ArtContentFractions | null {
  if (artContentFractionsCache.has(artwork)) {
    return artContentFractionsCache.get(artwork)!;
  }
  const w = artwork.naturalWidth || artwork.width;
  const h = artwork.naturalHeight || artwork.height;
  // Alpha ≥ 1: soft motif edges that still paint/clip in the preview must count
  // as content — threshold 10 was missing brim/barrel tips so trim warnings
  // stayed off while the canvas clearly clipped them at the dashed guide.
  const bounds = w > 0 && h > 0 ? flatImageAlphaBounds(artwork, 1) : null;
  const fractions =
    bounds && bounds.width > 0 && bounds.height > 0
      ? {
          left: bounds.x / w,
          top: bounds.y / h,
          width: bounds.width / w,
          height: bounds.height / h,
        }
      : null;
  artContentFractionsCache.set(artwork, fractions);
  return fractions;
}

/** Sub-rect of a placed artwork box covering only the opaque content. */
export function flatArtContentSubRect(
  fullBox: Rect,
  content: ArtContentFractions | null,
): Rect {
  if (!content) return fullBox;
  return {
    x: fullBox.x + content.left * fullBox.width,
    y: fullBox.y + content.top * fullBox.height,
    width: content.width * fullBox.width,
    height: content.height * fullBox.height,
  };
}

/**
 * A point on the artwork's opaque footprint, in the artwork's own [0,1] image
 * space. Transform-free by construction: the cache can never hold a stale
 * rotation because it holds no rotation at all. Callers reproject through the
 * live placement on every check.
 */
export type FlatNormPoint = { x: number; y: number };

/**
 * Occupancy resolution. At 128 one cell is ~0.8% of the artwork, which bounds
 * the worst-case over-warn. Clamped to the pixel size for small images, where a
 * finer grid than the source would leave unreachable cells looking empty.
 */
const OPAQUE_OUTLINE_GRID = 128;

/** Matches flatArtContentFractionsCached: soft motif edges still paint, so they count. */
const OPAQUE_OUTLINE_ALPHA = 1;

/**
 * Corners of the boundary cells of an alpha occupancy grid.
 *
 * Interior cells are dropped without losing correctness: the guide is a
 * rectangle, i.e. an intersection of four half-planes, so any opaque pixel
 * outside it can be reached by marching outward from a boundary cell that is
 * also outside — moving away from a violated half-plane never re-enters it.
 *
 * Pure (no canvas) so it stays unit-testable under jsdom.
 */
export function flatOpaqueOutlineFromAlpha(
  data: Uint8ClampedArray,
  w: number,
  h: number,
): FlatNormPoint[] | null {
  if (w <= 0 || h <= 0) return null;
  const g = Math.max(8, Math.min(OPAQUE_OUTLINE_GRID, w, h));
  const occupied = new Uint8Array(g * g);
  let anyOpaque = false;
  for (let y = 0; y < h; y++) {
    const rowBase = y * w * 4;
    const gyBase = Math.min(g - 1, ((y * g) / h) | 0) * g;
    for (let x = 0; x < w; x++) {
      if (data[rowBase + x * 4 + 3] > OPAQUE_OUTLINE_ALPHA) {
        occupied[gyBase + Math.min(g - 1, ((x * g) / w) | 0)] = 1;
        anyOpaque = true;
      }
    }
  }
  if (!anyOpaque) return null;

  const seen = new Set<number>();
  const points: FlatNormPoint[] = [];
  for (let gy = 0; gy < g; gy++) {
    for (let gx = 0; gx < g; gx++) {
      if (!occupied[gy * g + gx]) continue;
      const onBoundary =
        gx === 0 ||
        gy === 0 ||
        gx === g - 1 ||
        gy === g - 1 ||
        !occupied[gy * g + gx - 1] ||
        !occupied[gy * g + gx + 1] ||
        !occupied[(gy - 1) * g + gx] ||
        !occupied[(gy + 1) * g + gx];
      if (!onBoundary) continue;
      // All four corners, so the tested footprint covers each boundary cell
      // whole: the grid can over-warn by at most one cell, never under-warn.
      for (let dy = 0; dy <= 1; dy++) {
        for (let dx = 0; dx <= 1; dx++) {
          const key = (gy + dy) * (g + 1) + (gx + dx);
          if (seen.has(key)) continue;
          seen.add(key);
          points.push({ x: (gx + dx) / g, y: (gy + dy) / g });
        }
      }
    }
  }
  return points.length ? points : null;
}

const artOpaqueOutlineCache = new WeakMap<
  HTMLImageElement,
  FlatNormPoint[] | null
>();

function readArtOpaqueOutline(
  artwork: HTMLImageElement,
): FlatNormPoint[] | null {
  const w = artwork.naturalWidth || artwork.width;
  const h = artwork.naturalHeight || artwork.height;
  if (w <= 0 || h <= 0) return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(artwork, 0, 0, w, h);
    return flatOpaqueOutlineFromAlpha(ctx.getImageData(0, 0, w, h).data, w, h);
  } catch {
    return null;
  }
}

/**
 * Cached opaque outline for an artwork image. Keying on the element is safe
 * because loadFlatImage builds a fresh Image per URL and never re-points an
 * existing one, so an element's pixels cannot change after load.
 * Null when the pixels are unreadable (cross-origin without CORS).
 */
export function flatArtOpaqueOutlineCached(
  artwork: HTMLImageElement,
): FlatNormPoint[] | null {
  if (artOpaqueOutlineCache.has(artwork)) {
    return artOpaqueOutlineCache.get(artwork)!;
  }
  const outline = readArtOpaqueOutline(artwork);
  artOpaqueOutlineCache.set(artwork, outline);
  return outline;
}

/** Axis-aligned bounds of `rect` rotated `deg` degrees around (cx, cy). */
export function flatRotatedAabbAround(
  rect: Rect,
  cx: number,
  cy: number,
  deg: number,
): Rect {
  if (!deg) return rect;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    const dx = c.x - cx;
    const dy = c.y - cy;
    const rx = cx + dx * cos - dy * sin;
    const ry = cy + dx * sin + dy * cos;
    if (rx < minX) minX = rx;
    if (ry < minY) minY = ry;
    if (rx > maxX) maxX = rx;
    if (ry > maxY) maxY = ry;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Axis-aligned bounds of the placed artwork's OPAQUE content (rotation applied
 * around the full image centre — the true rotation origin). Used for trim /
 * coverage warnings so transparent PNG padding neither triggers false trim
 * warnings nor fakes coverage.
 */
export function flatVisibleArtBoxAxisAligned(
  rect: Rect,
  placement: ArtworkPlacement,
  artwork: HTMLImageElement,
): Rect {
  const artW = artwork.naturalWidth || artwork.width || 1;
  const artH = artwork.naturalHeight || artwork.height || 1;
  const fullBox = flatArtBox(rect, placement, artW, artH);
  const content = flatArtContentFractionsCached(artwork);
  const sub = flatArtContentSubRect(fullBox, content);
  const deg = Number.isFinite(placement.rotationDeg)
    ? Number(placement.rotationDeg)
    : 0;
  return flatRotatedAabbAround(
    sub,
    fullBox.x + fullBox.width / 2,
    fullBox.y + fullBox.height / 2,
    deg,
  );
}

/**
 * Coordinate system for placement + print-file bake.
 * Edge-wrap: full print canvas. Apparel: prefer the live mask alpha AABB so the
 * dashed guide matches destination-in clipping (harvest magenta AABB is often
 * much shorter than the mask silhouette customers actually see).
 */
export function flatPlacementRectPx(
  view: FlatViewCalibration,
  mask: HTMLImageElement | null,
  canvasW: number,
  canvasH: number,
  opts: { edgeWrapMode?: boolean; decorMode?: boolean },
): Rect {
  if (opts.edgeWrapMode) {
    return flatPrintCanvasLayout(view).printCanvas;
  }
  const harvest = flatVisibleRectPx(view, canvasW, canvasH);
  // Decor / wall-decal guides are mat openings — do not stretch to print AR.
  if (opts.decorMode) return harvest;

  if (mask) {
    const mw = mask.naturalWidth || mask.width;
    const mh = mask.naturalHeight || mask.height;
    const bounds = mw > 0 && mh > 0 ? flatMaskAlphaBoundsCached(mask) : null;
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      // Exact WYSIWYG: the guide IS the mask AABB — no aspect expansion.
      // A guide taller than the mask overpromises (art clips inside the line).
      // Short old harvests are fixed by reharvesting, not by stretching here.
      return scaleRectToCanvas(bounds, mw, mh, canvasW, canvasH);
    }
    // Mask pixels unreadable — the harvest AABB was derived from the same
    // magenta mask, so it matches the destination-in clip. No boost: a boosted
    // guide would extend past where the mask actually clips.
    return harvest;
  }

  // No mask at all — clip is fillRect(rect), so the boosted rect stays WYSIWYG.
  return expandPrintGuideToPrintFileAspect(
    harvest,
    view.printFileDims,
    canvasW,
    canvasH,
  );
}

/** Edge-wrap overlay guides: outer = print canvas, inner = safe zone. */
export function flatEdgeWrapGuideRects(view: FlatViewCalibration): { inner: Rect; outer: Rect } {
  const layout = flatPrintCanvasLayout(view);
  return { inner: layout.safeZone, outer: layout.printCanvas };
}

/** @deprecated Legacy viewport crop — use flatPrintCanvasLayout. */
export type FlatEdgeWrapViewportLayout = {
  backFace: Rect;
  placementRect: Rect;
  guides: { inner: Rect; outer: Rect };
};

/** @deprecated Use flatPrintCanvasLayout — kept for legacy manifest fallback. */
export function flatEdgeWrapViewportLayout(
  view: FlatViewCalibration,
  _mask: HTMLImageElement | null,
  _canvasW: number,
  _canvasH: number,
): FlatEdgeWrapViewportLayout | null {
  const layout = flatPrintCanvasLayout(view);
  return {
    backFace: layout.phoneBack,
    placementRect: layout.printCanvas,
    guides: { inner: layout.safeZone, outer: layout.printCanvas },
  };
}

/**
 * Artwork bounding box (mockup px) for a given placement. Baseline (scale=1)
 * = the smallest uniform scale that fully COVERS the rect, so reducing scale
 * reveals garment at the edges (the coverage warning's trigger).
 */
export function flatArtBox(
  rect: Rect,
  placement: ArtworkPlacement,
  artW: number,
  artH: number,
): Rect {
  const aspectSafeW = artW > 0 ? artW : 1;
  const aspectSafeH = artH > 0 ? artH : 1;
  const cover = Math.max(rect.width / aspectSafeW, rect.height / aspectSafeH);
  const k = cover * placement.scale;
  const drawW = aspectSafeW * k;
  const drawH = aspectSafeH * k;
  const cx = rect.x + rect.width * (0.5 + placement.offsetX);
  const cy = rect.y + rect.height * (0.5 + placement.offsetY);
  return { x: cx - drawW / 2, y: cy - drawH / 2, width: drawW, height: drawH };
}

/**
 * Axis-aligned bounds of the (possibly rotated) artwork box — used for
 * overflow / coverage warnings so a rotated corner past the guide still warns.
 */
export function flatArtBoxAxisAligned(
  rect: Rect,
  placement: ArtworkPlacement,
  artW: number,
  artH: number,
): Rect {
  const box = flatArtBox(rect, placement, artW, artH);
  const deg = Number.isFinite(placement.rotationDeg) ? Number(placement.rotationDeg) : 0;
  if (!deg) return box;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const bbW = box.width * cos + box.height * sin;
  const bbH = box.width * sin + box.height * cos;
  return { x: cx - bbW / 2, y: cy - bbH / 2, width: bbW, height: bbH };
}

/**
 * Harvest magenta AABB (unexpanded). Preview mask clip follows this silhouette
 * more closely than the Printify-overscan guide — use for apparel trim warnings.
 */
export function flatApparelTrimRectPx(
  view: FlatViewCalibration,
  canvasW: number,
  canvasH: number,
): Rect {
  return flatVisibleRectPx(view, canvasW, canvasH);
}

/** Draw artwork into `box`, optionally rotated CW around the box centre. */
export function drawFlatArtwork(
  ctx: CanvasRenderingContext2D,
  artwork: CanvasImageSource,
  box: Rect,
  rotationDeg = 0,
): void {
  const deg = Number.isFinite(rotationDeg) ? rotationDeg : 0;
  if (!deg) {
    ctx.drawImage(artwork, box.x, box.y, box.width, box.height);
    return;
  }
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(artwork, -box.width / 2, -box.height / 2, box.width, box.height);
  ctx.restore();
}

/** True when the artwork box fully covers the print rect (no garment edges). */
export function flatCovers(rect: Rect, box: Rect): boolean {
  const eps = 0.5;
  return (
    box.x <= rect.x + eps &&
    box.y <= rect.y + eps &&
    box.x + box.width >= rect.x + rect.width - eps &&
    box.y + box.height >= rect.y + rect.height - eps
  );
}

/** True when artwork extends past the print rect — mask clip will trim edges. */
export function flatOverflows(rect: Rect, box: Rect, slackPx = 1): boolean {
  const eps = Math.max(0, slackPx);
  return (
    box.x < rect.x - eps ||
    box.y < rect.y - eps ||
    box.x + box.width > rect.x + rect.width + eps ||
    box.y + box.height > rect.y + rect.height + eps
  );
}

/**
 * Sub-pixel slack. Art flush with the guide fills the print area exactly and
 * loses nothing, so touching the line is not crossing it; the slack also keeps
 * rotation rounding from flickering the banner on and off.
 */
export const FLAT_GUIDE_TOUCH_SLACK_PX = 0.5;

/**
 * Apparel trim banner: opaque artwork vs the dashed print guide only.
 * Transparent PNG padding does not count. Ring/handles are UI chrome and must
 * not trigger the warning. Strict — only art past the line warns.
 */
export function flatApparelGuideTrimmed(guideRect: Rect, artBox: Rect): boolean {
  const slack = FLAT_GUIDE_TOUCH_SLACK_PX;
  return (
    artBox.x < guideRect.x - slack ||
    artBox.y < guideRect.y - slack ||
    artBox.x + artBox.width > guideRect.x + guideRect.width + slack ||
    artBox.y + artBox.height > guideRect.y + guideRect.height + slack
  );
}

/**
 * True when any outline point, reprojected through `fullBox` and `rotationDeg`,
 * lands outside the guide. Pure: the caller supplies the transform-free outline
 * so a rotated design is always tested at its current rotation, and the same
 * rotation origin as drawFlatArtwork (the full box centre) is used.
 */
export function flatOpaqueOutlineTrimmed(
  guideRect: Rect,
  fullBox: Rect,
  rotationDeg: number,
  outline: FlatNormPoint[],
): boolean {
  const slack = FLAT_GUIDE_TOUCH_SLACK_PX;
  const minX = guideRect.x - slack;
  const minY = guideRect.y - slack;
  const maxX = guideRect.x + guideRect.width + slack;
  const maxY = guideRect.y + guideRect.height + slack;
  const deg = Number.isFinite(rotationDeg) ? rotationDeg : 0;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = fullBox.x + fullBox.width / 2;
  const cy = fullBox.y + fullBox.height / 2;
  for (const p of outline) {
    let px = fullBox.x + p.x * fullBox.width;
    let py = fullBox.y + p.y * fullBox.height;
    if (deg) {
      const dx = px - cx;
      const dy = py - cy;
      px = cx + dx * cos - dy * sin;
      py = cy + dx * sin + dy * cos;
    }
    if (px < minX || py < minY || px > maxX || py > maxY) return true;
  }
  return false;
}

/**
 * Apparel trim check: only real opaque pixels count, rotated or not.
 *
 * The axis-aligned box runs first as a conservative filter — it contains the
 * opaque footprint, so a negative there is proof and costs what it always did.
 * Only when it says "maybe" do we reproject the outline, which is what stops a
 * rotated design's hollow corners from warning on empty space.
 */
export function flatApparelOpaqueTrimmed(
  guideRect: Rect,
  placement: ArtworkPlacement,
  artwork: HTMLImageElement,
): boolean {
  const aabb = flatVisibleArtBoxAxisAligned(guideRect, placement, artwork);
  if (!flatApparelGuideTrimmed(guideRect, aabb)) return false;
  const outline = flatArtOpaqueOutlineCached(artwork);
  // Unreadable pixels (tainted canvas) — keep the conservative box answer.
  if (!outline) return true;
  const artW = artwork.naturalWidth || artwork.width || 1;
  const artH = artwork.naturalHeight || artwork.height || 1;
  const fullBox = flatArtBox(guideRect, placement, artW, artH);
  const deg = Number.isFinite(placement.rotationDeg)
    ? Number(placement.rotationDeg)
    : 0;
  return flatOpaqueOutlineTrimmed(guideRect, fullBox, deg, outline);
}

/**
 * Apparel: warn when art extends past the harvest/mask AABB *or* the (taller)
 * Printify guide. Expanding the dashed guide for collar overscan must not
 * silence the trim warning when the mask still clips the design.
 */
export function flatApparelArtworkTrimmed(
  trimRect: Rect,
  guideRect: Rect,
  artBox: Rect,
): boolean {
  return flatOverflows(trimRect, artBox) || flatOverflows(guideRect, artBox);
}

/**
 * Overflow / floating silhouette: historical `alpha <= 16` means outside.
 * `pointInMask` is inclusive (`>=`), so overflow passes `threshold + 1`.
 */
export const MASK_ALPHA_OVERFLOW_THRESHOLD = 16;
/**
 * 241 core printable. Feather ramp (1–127) is ignored so a soft mask edge
 * cannot report a perpetual uncovered rim.
 */
export const MASK_ALPHA_THRESHOLD = 128;
/** Artwork counts as covering a core mask sample. */
export const ART_COVER_ALPHA = 10;
/**
 * At least this many samples along the mask AABB long side, and never a
 * coarser step than {@link TAPESTRY_COVERAGE_MAX_STEP_PX}.
 * 256 @ 1024² catalog blank ≈ 4 mockup px; clamped to 2 px so a few-mm
 * white strip on 50×60 (~3 mm) and 104" (~5 mm) cannot sit between samples.
 */
export const TAPESTRY_COVERAGE_MIN_AXIS = 256;
export const TAPESTRY_COVERAGE_MAX_STEP_PX = 2;

const maskRgbaCache = new WeakMap<
  HTMLImageElement,
  { data: Uint8ClampedArray; width: number; height: number } | null
>();

export function readMaskRgbaCached(
  mask: HTMLImageElement,
): { data: Uint8ClampedArray; width: number; height: number } | null {
  if (maskRgbaCache.has(mask)) return maskRgbaCache.get(mask)!;
  const width = mask.naturalWidth || mask.width;
  const height = mask.naturalHeight || mask.height;
  if (width <= 0 || height <= 0) {
    maskRgbaCache.set(mask, null);
    return null;
  }
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    maskRgbaCache.set(mask, null);
    return null;
  }
  try {
    ctx.drawImage(mask, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;
    const hit = { data, width, height };
    maskRgbaCache.set(mask, hit);
    return hit;
  } catch {
    maskRgbaCache.set(mask, null);
    return null;
  }
}

/**
 * Overflow rule + 241 coverage share this lookup: map a mockup-space point
 * onto the mask bitmap and test alpha (inclusive `>= minAlpha`).
 * Out of the canvas → not in the mask.
 */
export function pointInMask(
  data: Uint8ClampedArray,
  maskW: number,
  maskH: number,
  canvasX: number,
  canvasY: number,
  canvasW: number,
  canvasH: number,
  minAlpha: number,
): boolean {
  if (
    !(maskW > 0) ||
    !(maskH > 0) ||
    !(canvasW > 0) ||
    !(canvasH > 0) ||
    canvasX < 0 ||
    canvasY < 0 ||
    canvasX >= canvasW ||
    canvasY >= canvasH
  ) {
    return false;
  }
  const mx = Math.min(maskW - 1, Math.max(0, Math.floor(canvasX * (maskW / canvasW))));
  const my = Math.min(maskH - 1, Math.max(0, Math.floor(canvasY * (maskH / canvasH))));
  return data[(my * maskW + mx) * 4 + 3] >= minAlpha;
}

export function tapestryCoverageSampleStep(aabbW: number, aabbH: number): number {
  const long = Math.max(aabbW, aabbH, 1);
  return Math.max(
    1,
    Math.min(
      TAPESTRY_COVERAGE_MAX_STEP_PX,
      Math.floor(long / TAPESTRY_COVERAGE_MIN_AXIS) || 1,
    ),
  );
}

/**
 * True when any CORE mask sample (`pointInMask` ≥ {@link MASK_ALPHA_THRESHOLD})
 * is not covered by opaque art (alpha > {@link ART_COVER_ALPHA}).
 * Pure: callers supply aligned RGBA buffers (art already placed).
 */
export function maskCoreUncoveredFromRgba(
  maskData: Uint8ClampedArray,
  maskW: number,
  maskH: number,
  artData: Uint8ClampedArray,
  artW: number,
  artH: number,
  canvasW: number,
  canvasH: number,
  sampleBounds: Rect,
  sampleStep: number,
): boolean {
  if (!(canvasW > 0) || !(canvasH > 0) || !(sampleStep > 0)) return false;
  const x0 = sampleBounds.x;
  const y0 = sampleBounds.y;
  const x1 = sampleBounds.x + sampleBounds.width;
  const y1 = sampleBounds.y + sampleBounds.height;
  for (let y = y0; y < y1; y += sampleStep) {
    for (let x = x0; x < x1; x += sampleStep) {
      if (
        !pointInMask(
          maskData,
          maskW,
          maskH,
          x,
          y,
          canvasW,
          canvasH,
          MASK_ALPHA_THRESHOLD,
        )
      ) {
        continue;
      }
      const ax = Math.min(artW - 1, Math.max(0, Math.floor(x * (artW / canvasW))));
      const ay = Math.min(artH - 1, Math.max(0, Math.floor(y * (artH / canvasH))));
      if (artData[(ay * artW + ax) * 4 + 3] <= ART_COVER_ALPHA) return true;
    }
  }
  return false;
}

/**
 * True when the axis-aligned art box sits inside the dashed guide AABB but
 * still overlaps transparent mask pixels (silhouette / print-window clip).
 * Samples the art-box perimeter in mask space — cheap and catches the common
 * "clipped inside the dashed line, Placement ready" failure mode.
 */
export function flatMaskRejectsArtBox(
  mask: HTMLImageElement | null,
  artBox: Rect,
  canvasW: number,
  canvasH: number,
  alphaThreshold = MASK_ALPHA_OVERFLOW_THRESHOLD,
): boolean {
  if (!mask || artBox.width <= 0 || artBox.height <= 0) return false;
  const pixels = readMaskRgbaCached(mask);
  if (!pixels) return false;
  const { data, width: mw, height: mh } = pixels;
  if (mw <= 0 || mh <= 0 || canvasW <= 0 || canvasH <= 0) return false;

  const steps = 24;
  const samples: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    samples.push(
      { x: artBox.x + artBox.width * t, y: artBox.y },
      { x: artBox.x + artBox.width * t, y: artBox.y + artBox.height },
      { x: artBox.x, y: artBox.y + artBox.height * t },
      { x: artBox.x + artBox.width, y: artBox.y + artBox.height * t },
    );
  }
  // Mid-edge insets — catches hard rect clips a few px inside the AABB.
  const insetX = Math.min(6, artBox.width * 0.05);
  const insetY = Math.min(6, artBox.height * 0.05);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    samples.push(
      { x: artBox.x + artBox.width * t, y: artBox.y + insetY },
      { x: artBox.x + artBox.width * t, y: artBox.y + artBox.height - insetY },
      { x: artBox.x + insetX, y: artBox.y + artBox.height * t },
      { x: artBox.x + artBox.width - insetX, y: artBox.y + artBox.height * t },
    );
  }

  // Inclusive `pointInMask` ≥ (threshold+1) ≡ historical `!(alpha <= threshold)`.
  const overflowMinAlpha = alphaThreshold + 1;
  for (const p of samples) {
    if (!pointInMask(data, mw, mh, p.x, p.y, canvasW, canvasH, overflowMinAlpha)) {
      return true;
    }
  }
  return false;
}

/**
 * 241 under-coverage: invert the overflow rule. Walk core mask samples via
 * {@link pointInMask} (`>= 128`); warn if any is not covered by opaque art.
 * Uses the same placement rect as `renderFlatView` (`flatPlacementRectPx`).
 */
export function flatMaskCoreUncovered(
  mask: HTMLImageElement | null,
  artwork: HTMLImageElement,
  placement: ArtworkPlacement,
  placementRect: Rect,
  canvasW: number,
  canvasH: number,
): boolean {
  if (!mask || !(canvasW > 0) || !(canvasH > 0)) return false;
  if (!(placementRect.width > 0) || !(placementRect.height > 0)) return false;
  const pixels = readMaskRgbaCached(mask);
  if (!pixels) return false;
  const artW = artwork.naturalWidth || artwork.width || 0;
  const artH = artwork.naturalHeight || artwork.height || 0;
  if (!(artW > 0) || !(artH > 0)) return false;

  const artCanvas = document.createElement("canvas");
  artCanvas.width = canvasW;
  artCanvas.height = canvasH;
  const actx = artCanvas.getContext("2d", { willReadFrequently: true });
  if (!actx) return false;
  const box = flatArtBox(placementRect, placement, artW, artH);
  drawFlatArtwork(actx, artwork, box, placement.rotationDeg ?? 0);
  let artData: Uint8ClampedArray;
  try {
    artData = actx.getImageData(0, 0, canvasW, canvasH).data;
  } catch {
    return false;
  }

  const nativeBounds = flatMaskAlphaBoundsCached(mask);
  const sampleBounds = nativeBounds
    ? scaleRectToCanvas(
        nativeBounds,
        pixels.width,
        pixels.height,
        canvasW,
        canvasH,
      )
    : { x: 0, y: 0, width: canvasW, height: canvasH };
  const step = tapestryCoverageSampleStep(sampleBounds.width, sampleBounds.height);
  return maskCoreUncoveredFromRgba(
    pixels.data,
    pixels.width,
    pixels.height,
    artData,
    canvasW,
    canvasH,
    canvasW,
    canvasH,
    sampleBounds,
    step,
  );
}

/**
 * Edge-wrap products: artwork must extend past the safe back-face zone so edges
 * receive print. True when any edge of the artwork box stops short of the safe zone.
 */
export function flatInsufficientSafeZoneCoverage(safeZone: Rect, box: Rect): boolean {
  const bleed = 1.5;
  return (
    box.x > safeZone.x + bleed ||
    box.y > safeZone.y + bleed ||
    box.x + box.width < safeZone.x + safeZone.width - bleed ||
    box.y + box.height < safeZone.y + safeZone.height - bleed
  );
}

/** @deprecated Use flatInsufficientSafeZoneCoverage */
export function flatInsufficientEdgeWrap(rect: Rect, box: Rect): boolean {
  return flatInsufficientSafeZoneCoverage(rect, box);
}

/**
 * Alpha bounding box of a mask / image (mockup px). Returns `null` when the
 * image is empty or pixel reads fail (tainted canvas).
 */
export function flatImageAlphaBounds(
  img: HTMLImageElement,
  alphaThreshold = 10,
): Rect | null {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (w <= 0 || h <= 0) return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  try {
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (data[i + 3] > alphaThreshold) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX) return null;
    return {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    };
  } catch {
    return null;
  }
}

type NormRect = { x: number; y: number; width: number; height: number };

/** Side-profile phone models (14/15+) — fallback when mask valley detection is ambiguous. */
export function looksLikeSideProfilePhoneModel(sizeId: string): boolean {
  const n = sizeId.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    /iphone-(1[4-9]|[2-9][0-9])/.test(n) ||
    /-(14|15|16|17)(-pro|-plus|-pro-max|-max|-air)?(\b|$)/.test(n)
  );
}

function backFaceRectFromMaskAlpha(
  data: Uint8ClampedArray,
  imgW: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Rect {
  const bw = maxX - minX + 1;
  const colFill = new Float32Array(bw);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (data[(y * imgW + x) * 4 + 3] > 10) colFill[x - minX]++;
    }
  }
  const maxFill = Math.max(...colFill, 1);

  // Side strip lives in the right ~25% — scan there for a column-density valley.
  const scanStart = Math.floor(bw * 0.55);
  let splitCol: number | null = null;
  let minVal = Infinity;
  for (let i = scanStart; i < bw - 2; i++) {
    const v = colFill[i];
    if (v < minVal) {
      minVal = v;
      splitCol = i;
    }
  }

  let backWidth = bw;
  if (splitCol !== null && splitCol > scanStart) {
    let before = 0;
    let after = 0;
    for (let i = 0; i < splitCol; i++) before += colFill[i];
    for (let i = splitCol; i < bw; i++) after += colFill[i];
    if (after >= maxFill * 2 && before > after * 1.15 && splitCol < Math.floor(bw * 0.93)) {
      backWidth = splitCol;
    }
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, backWidth),
    height: maxY - minY + 1,
  };
}

/**
 * Detect the flat back panel on phone mockups that include a perspective side
 * strip. Column-density valley detection — row-median width spans back+side.
 */
export function detectEdgeWrapBackFaceFromMask(mask: HTMLImageElement): Rect | null {
  const w = mask.naturalWidth || mask.width;
  const h = mask.naturalHeight || mask.height;
  if (w <= 0 || h <= 0) return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  let data: Uint8ClampedArray;
  try {
    ctx.drawImage(mask, 0, 0, w, h);
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return null;

  return backFaceRectFromMaskAlpha(data, w, minX, minY, maxX, maxY);
}

/** Back-face crop rect in mockup px (excludes side-profile strip when present). */
export function flatBackFaceCropRectPx(
  view: FlatViewCalibration,
  mask: HTMLImageElement | null,
  canvasW: number,
  canvasH: number,
): Rect | null {
  const fromMask = mask ? detectEdgeWrapBackFaceFromMask(mask) : null;
  const stored = normalizedRectPx(
    view.backFaceCropNormalized as NormRect | null | undefined,
    canvasW,
    canvasH,
  );
  if (fromMask) return fromMask;
  return stored;
}

export function offsetRectByCrop(rect: Rect, crop: Rect): Rect {
  return {
    x: rect.x - crop.x,
    y: rect.y - crop.y,
    width: rect.width,
    height: rect.height,
  };
}

/** Crop a rendered mockup canvas to a sub-rect (used for phone back-face previews). */
export function cropCanvasToRect(source: HTMLCanvasElement, crop: Rect): void {
  const w = Math.max(1, Math.round(crop.width));
  const h = Math.max(1, Math.round(crop.height));
  const sx = Math.max(0, Math.round(crop.x));
  const sy = Math.max(0, Math.round(crop.y));
  const ctx = source.getContext("2d");
  if (!ctx || source.width <= 0 || source.height <= 0) return;
  const imageData = ctx.getImageData(sx, sy, w, h);
  source.width = w;
  source.height = h;
  ctx.putImageData(imageData, 0, 0);
}

/**
 * True when the harvested mask includes a perspective side strip (iPhone 14/15
 * style). Back-only mockups (e.g. iPhone 11) return false — no viewport crop.
 */
export function flatEdgeWrapHasSideProfileStrip(
  view: FlatViewCalibration,
  mask: HTMLImageElement | null,
  canvasW: number,
  canvasH: number,
  sizeId?: string,
): boolean {
  const maskBbox =
    mask ? flatImageAlphaBounds(mask) : normalizedRectPx(view.printBoundsNormalized, canvasW, canvasH);
  const back = flatBackFaceCropRectPx(view, mask, canvasW, canvasH);
  if (!back || !maskBbox) {
    return !!(sizeId && looksLikeSideProfilePhoneModel(sizeId));
  }
  const stripRight = maskBbox.x + maskBbox.width - (back.x + back.width);
  if (stripRight >= Math.max(10, maskBbox.width * 0.04)) return true;
  if (back.width < maskBbox.width * 0.88) return true;
  return !!(sizeId && looksLikeSideProfilePhoneModel(sizeId));
}

function drawImageRegion(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  src: Rect,
  destW: number,
  destH: number,
): void {
  ctx.drawImage(img, src.x, src.y, src.width, src.height, 0, 0, destW, destH);
}

function regionToCanvas(
  img: HTMLImageElement,
  region: Rect,
  outW: number,
  outH: number,
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = outW;
  c.height = outH;
  const cx = c.getContext("2d");
  if (cx) drawImageRegion(cx, img, region, outW, outH);
  return c;
}

/** Full printable unwrap bounds in print-canvas preview space. */
export function flatPrintBoundsPx(view: FlatViewCalibration): Rect {
  return flatPrintCanvasLayout(view).printCanvas;
}

/** @deprecated Prefer `edgeWrapMode` prop — shading map alone mis-classifies apparel. */
export function flatIsEdgeWrapView(view: FlatViewCalibration): boolean {
  return view.shadingMode === "map";
}

/**
 * Build a complete `MeshGrid` (mockup-px target points) from the manifest's
 * mesh nodes. Returns `null` when the grid is incomplete (we then fall back to
 * a flat blit), so we never warp through a malformed mesh.
 */
function buildMeshGrid(
  view: FlatViewCalibration,
  scaleX: number,
  scaleY: number,
  source: Rect,
): MeshGrid | null {
  const grid = view.meshGrid;
  const nodes = view.meshNodes;
  if (!grid || !nodes || nodes.length === 0) return null;
  const { cols, rows } = grid;
  if (cols < 2 || rows < 2) return null;
  const targetPoints: Pt[] = new Array(cols * rows);
  let filled = 0;
  for (const n of nodes) {
    if (n.row < 0 || n.row >= rows || n.col < 0 || n.col >= cols) continue;
    const idx = n.row * cols + n.col;
    if (!targetPoints[idx]) filled += 1;
    targetPoints[idx] = { x: n.px.x * scaleX, y: n.px.y * scaleY };
  }
  // Require a complete grid — partial grids produce torn warps. Mesh products
  // with missing nodes gracefully fall back to the flat blit path.
  if (filled !== cols * rows) return null;
  return {
    cols,
    rows,
    sourceRect: { x: source.x, y: source.y, width: source.width, height: source.height },
    targetPoints,
  };
}

/**
 * Normalize a grayscale shading layer in place into a multiply factor map:
 * `factor = clamp(luminance / maskedMean, MIN, 1)`. Mean → 1 (neutral), so
 * only relative shadows darken the artwork. Restricted to `artLayer`'s alpha
 * so we don't measure the studio background. Throws on tainted canvases — the
 * caller falls back to a gentler blend.
 */
function normalizeShadeInPlace(
  shadeCtx: CanvasRenderingContext2D,
  artCtx: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  const shade = shadeCtx.getImageData(0, 0, w, h);
  const art = artCtx.getImageData(0, 0, w, h);
  const sd = shade.data;
  const ad = art.data;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < ad.length; i += 4) {
    if (ad[i + 3] > 10) {
      sum += 0.299 * sd[i] + 0.587 * sd[i + 1] + 0.114 * sd[i + 2];
      n += 1;
    }
  }
  const mean = n > 0 ? sum / n : 128;
  const safeMean = mean > 1 ? mean : 1;
  for (let i = 0; i < sd.length; i += 4) {
    const lum = 0.299 * sd[i] + 0.587 * sd[i + 1] + 0.114 * sd[i + 2];
    let factor = lum / safeMean;
    if (factor > 1) factor = 1;
    if (factor < SHADE_FACTOR_MIN) factor = SHADE_FACTOR_MIN;
    const g = Math.round(factor * 255);
    sd[i] = g;
    sd[i + 1] = g;
    sd[i + 2] = g;
    sd[i + 3] = 255;
  }
  shadeCtx.putImageData(shade, 0, 0);
}

/**
 * Phone-case grey-map shading: overlay for overall form plus a specular pass so
 * bright areas in the Printify grey pass read as plastic sheen (multiply
 * normalize clamps highlights away).
 */
function applyPhoneCaseMapShading(
  artCanvas: HTMLCanvasElement,
  artCtx: CanvasRenderingContext2D,
  shading: HTMLImageElement | HTMLCanvasElement,
  w: number,
  h: number,
): void {
  const shade = document.createElement("canvas");
  shade.width = w;
  shade.height = h;
  const sctx = shade.getContext("2d");
  if (!sctx) return;

  sctx.drawImage(shading, 0, 0, w, h);
  sctx.globalCompositeOperation = "destination-in";
  sctx.drawImage(artCanvas, 0, 0);
  sctx.globalCompositeOperation = "source-over";

  artCtx.save();
  artCtx.globalCompositeOperation = "overlay";
  artCtx.globalAlpha = 0.88;
  artCtx.drawImage(shade, 0, 0);

  try {
    const data = sctx.getImageData(0, 0, w, h);
    const spec = document.createElement("canvas");
    spec.width = w;
    spec.height = h;
    const spCtx = spec.getContext("2d");
    if (spCtx) {
      const out = spCtx.createImageData(w, h);
      let sum = 0;
      let n = 0;
      const lumAt = (i: number) =>
        0.299 * data.data[i] + 0.587 * data.data[i + 1] + 0.114 * data.data[i + 2];
      for (let i = 0; i < data.data.length; i += 4) {
        if (data.data[i + 3] > 10) {
          sum += lumAt(i);
          n += 1;
        }
      }
      const mean = n > 0 ? sum / n : 140;
      const threshold = mean + 14;
      for (let i = 0; i < data.data.length; i += 4) {
        if (data.data[i + 3] < 10) continue;
        const l = lumAt(i);
        if (l > threshold) {
          const t = Math.min(1, (l - threshold) / Math.max(1, 255 - threshold));
          const v = Math.round(200 + t * 55);
          out.data[i] = v;
          out.data[i + 1] = v;
          out.data[i + 2] = v;
          out.data[i + 3] = Math.round(t * 160);
        }
      }
      spCtx.putImageData(out, 0, 0);
      artCtx.globalCompositeOperation = "screen";
      artCtx.globalAlpha = 1;
      artCtx.drawImage(spec, 0, 0);
    }
  } catch {
    artCtx.globalCompositeOperation = "soft-light";
    artCtx.globalAlpha = 0.35;
    artCtx.drawImage(shade, 0, 0);
  }
  artCtx.restore();
}

/**
 * Multiply a normalized shading layer over the artwork layer, restricted to
 * the artwork's own alpha so transparent (garment) pixels stay untouched.
 *
 * When `fabricWeave` is set (tapestry): simple coloured blank multiply only —
 * no procedural weave grid. Printify's photo mockup is available on demand.
 */
function applyShading(
  artCanvas: HTMLCanvasElement,
  artCtx: CanvasRenderingContext2D,
  mode: "blank" | "map",
  blank: HTMLImageElement,
  shading: HTMLImageElement | null,
  w: number,
  h: number,
  artworkCorsClean: boolean,
  opts?: { phoneCaseMap?: boolean; fabricWeave?: boolean },
): void {
  if (opts?.fabricWeave) {
    applySimpleBlankMultiply(artCanvas, artCtx, blank, w, h);
    return;
  }

  if (mode === "map" && shading && opts?.phoneCaseMap) {
    applyPhoneCaseMapShading(artCanvas, artCtx, shading, w, h);
    return;
  }

  const shade = document.createElement("canvas");
  shade.width = w;
  shade.height = h;
  const sctx = shade.getContext("2d");
  if (!sctx) return;

  if (mode === "map" && shading) {
    sctx.drawImage(shading, 0, 0, w, h);
  } else {
    // Garment's own luminance.
    sctx.filter = "grayscale(1)";
    sctx.drawImage(blank, 0, 0, w, h);
    sctx.filter = "none";
  }

  let normalized = artworkCorsClean;
  if (artworkCorsClean) {
    try {
      normalizeShadeInPlace(sctx, artCtx, w, h);
    } catch {
      // Tainted canvas (cross-origin artwork without CORS) — skip the pixel
      // normalize and apply the raw layer gently below.
      normalized = false;
    }
  }

  // Restrict the shading to the artwork alpha so we don't paint garment areas.
  sctx.globalCompositeOperation = "destination-in";
  sctx.drawImage(artCanvas, 0, 0);
  sctx.globalCompositeOperation = "source-over";

  artCtx.save();
  if (normalized) {
    artCtx.globalCompositeOperation = "multiply";
    artCtx.drawImage(shade, 0, 0);
  } else {
    // Fallback: soft-light treats mid-gray as neutral without needing pixel
    // reads, at reduced strength so we never crush the artwork.
    artCtx.globalCompositeOperation = "soft-light";
    artCtx.globalAlpha = 0.6;
    artCtx.drawImage(shade, 0, 0);
  }
  artCtx.restore();
}

/** Solidified clip masks, cached per mask image + output size (render-time cost ~0). */
const solidMaskCache = new WeakMap<HTMLImageElement, { key: string; canvas: HTMLCanvasElement }>();

/**
 * Close pinhole noise in a harvested print mask before destination-in clipping.
 * Dilates by unioning offset draws (fills holes ≤ ~4px), then re-stamps the
 * result to saturate semi-transparent alpha. Pure draw calls — no getImageData.
 */
function solidifyMaskForClip(
  mask: HTMLImageElement,
  w: number,
  h: number,
): HTMLCanvasElement {
  const key = `${w}x${h}`;
  const cached = solidMaskCache.get(mask);
  if (cached && cached.key === key) return cached.canvas;

  const union = document.createElement("canvas");
  union.width = w;
  union.height = h;
  const uctx = union.getContext("2d");
  if (!uctx) return union;
  // Union of offset stamps — closes gaps smaller than the offset radius.
  const r = 2;
  for (let dy = -r; dy <= r; dy += r) {
    for (let dx = -r; dx <= r; dx += r) {
      uctx.drawImage(mask, dx, dy, w, h);
    }
  }

  const solid = document.createElement("canvas");
  solid.width = w;
  solid.height = h;
  const sctx = solid.getContext("2d");
  if (!sctx) return union;
  // Re-stamping saturates alpha: a' = 1-(1-a)^4 → speckly 0.5 alpha becomes ~0.94.
  for (let i = 0; i < 4; i++) sctx.drawImage(union, 0, 0);

  solidMaskCache.set(mask, { key, canvas: solid });
  return solid;
}

/**
 * Clip the offscreen artwork layer to the printable area.
 * Prefer the pixel mask when present, then ALSO erase everything outside the
 * dashed guide `rect` so artwork can never display past the guide even when a
 * fallback made the two diverge (e.g. mask pixels unreadable → guide from
 * harvest AABB). WYSIWYG must hold structurally, not per-path.
 *
 * Note: destination-in + fillRect(rect) cannot intersect (fillRect only
 * touches pixels inside the rect); erasing the four outside margins with
 * destination-out is a true intersection using only draw calls.
 */
export function clipFlatArtToPrintArea(
  actx: CanvasRenderingContext2D,
  opts: {
    mask: HTMLImageElement | null;
    rect: Rect;
    canvasW: number;
    canvasH: number;
    fabricWeave?: boolean;
  },
): "mask" | "rect" | "mask+rect" {
  const { mask, rect, canvasW, canvasH, fabricWeave } = opts;
  actx.globalCompositeOperation = "destination-in";
  if (mask) {
    if (fabricWeave) {
      actx.drawImage(solidifyMaskForClip(mask, canvasW, canvasH), 0, 0);
    } else {
      actx.drawImage(mask, 0, 0, canvasW, canvasH);
    }
    let mode: "mask" | "mask+rect" = "mask";
    if (rect.width > 0 && rect.height > 0) {
      actx.globalCompositeOperation = "destination-out";
      actx.fillStyle = "#fff";
      const right = rect.x + rect.width;
      const bottom = rect.y + rect.height;
      if (rect.x > 0) actx.fillRect(0, 0, rect.x, canvasH);
      if (right < canvasW) actx.fillRect(right, 0, canvasW - right, canvasH);
      if (rect.y > 0) actx.fillRect(0, 0, canvasW, rect.y);
      if (bottom < canvasH) actx.fillRect(0, bottom, canvasW, canvasH - bottom);
      mode = "mask+rect";
    }
    actx.globalCompositeOperation = "source-over";
    return mode;
  }
  actx.fillStyle = "#fff";
  actx.fillRect(rect.x, rect.y, rect.width, rect.height);
  actx.globalCompositeOperation = "source-over";
  return "rect";
}

// ---------------------------------------------------------------------------
// Tapestry blank-blend (merchant defaults dialed vs Printify woven mockups)
// ---------------------------------------------------------------------------

export type FabricBlendConfig = {
  /** 0 = full blank multiply, 1 = no blank effect. */
  transparency: number;
  /** Soft-light cream tint from blank, 0–1. */
  cream: number;
  /** Extra overall darkening (multiply mid-grey), 0–1. */
  darkening: number;
  /** Cloth saturation before multiply: 0 = grey, 1 = natural, 2 = boosted. */
  vibrance: number;
  /** Fine film grain, 0–1. */
  grain: number;
  /** Coarser sparse speckle, 0–1. */
  speckle: number;
  /** Horizontal line spacing (px). Lower = denser weft-like lines. */
  linealX: number;
  /** Vertical line spacing (px). Lower = denser warp-like lines. */
  linealY: number;
  /** Lineal overlay strength, 0–1. */
  linealAlpha: number;
};

/** Shipped defaults — dialed in against Printify woven tapestry (2026-07). */
export const DEFAULT_FABRIC_BLEND_CONFIG: FabricBlendConfig = {
  transparency: 0.17,
  cream: 0.41,
  darkening: 0.07,
  vibrance: 0.2,
  grain: 0.9,
  speckle: 0.91,
  linealX: 7,
  linealY: 5,
  linealAlpha: 0.2,
};

/** Bump when defaults change so stale browser tuning does not override merchants. */
const FABRIC_BLEND_STORAGE_KEY = "appai:fabricBlendConfig:v2";

let activeFabricBlendConfig: FabricBlendConfig | null = null;

function loadStoredFabricBlendConfig(): FabricBlendConfig {
  try {
    const raw = window.localStorage.getItem(FABRIC_BLEND_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return { ...DEFAULT_FABRIC_BLEND_CONFIG, ...parsed };
      }
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_FABRIC_BLEND_CONFIG };
}

export function getFabricBlendConfig(): FabricBlendConfig {
  if (!activeFabricBlendConfig) activeFabricBlendConfig = loadStoredFabricBlendConfig();
  return activeFabricBlendConfig;
}

export function setFabricBlendConfig(patch: Partial<FabricBlendConfig>): FabricBlendConfig {
  activeFabricBlendConfig = { ...getFabricBlendConfig(), ...patch };
  try {
    window.localStorage.setItem(
      FABRIC_BLEND_STORAGE_KEY,
      JSON.stringify(activeFabricBlendConfig),
    );
  } catch {
    // best-effort
  }
  return activeFabricBlendConfig;
}

export function resetFabricBlendConfig(): FabricBlendConfig {
  activeFabricBlendConfig = { ...DEFAULT_FABRIC_BLEND_CONFIG };
  try {
    window.localStorage.removeItem(FABRIC_BLEND_STORAGE_KEY);
  } catch {
    // ignore
  }
  return activeFabricBlendConfig;
}

// ---------------------------------------------------------------------------
// Fabric weave texture — tunable config (legacy procedural; admin calibrator)
// ---------------------------------------------------------------------------

export type WeaveConfig = {
  /** Horizontal (weft) yarn thickness range, px in the tile. */
  weftMin: number;
  weftMax: number;
  /** Vertical (warp) yarn thickness range, px in the tile. */
  warpMin: number;
  warpMax: number;
  /** Pattern scale multiplier on the rendered mockup (bigger = coarser). */
  scale: number;
  /** Per-yarn brightness variation (slub / thread irregularity), 0–60. */
  slub: number;
  /** Extra per-cell brightness wobble, 0–40. */
  cellNoise: number;
  /** Groove tone 0–128 — lower = darker crosshatch lines. */
  grooveTone: number;
  /** Thread highlight tone 128–255 — higher = shinier ridges. */
  ridgeTone: number;
  /** Overlay pass strength 0–1 (texture contrast). */
  overlayAlpha: number;
  /** Multiply pass strength 0–1 (overall darkening). */
  multiplyAlpha: number;
};

// Tuned against Printify woven tapestry mockups (bp 1649) — coarse knot grid,
// strong micro-contrast in both lights and darks (2026-07).
export const DEFAULT_WEAVE_CONFIG: WeaveConfig = {
  weftMin: 4,
  weftMax: 8,
  warpMin: 6,
  warpMax: 11,
  scale: 0.95,
  slub: 70,
  cellNoise: 22,
  grooveTone: 62,
  ridgeTone: 198,
  overlayAlpha: 0.62,
  multiplyAlpha: 0.72,
};

/** Bump when defaults change so stale admin localStorage does not keep a fine weave. */
const WEAVE_STORAGE_KEY = "appai:weaveConfig:v3";

let activeWeaveConfig: WeaveConfig | null = null;

function loadStoredWeaveConfig(): WeaveConfig {
  try {
    const raw = window.localStorage.getItem(WEAVE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return { ...DEFAULT_WEAVE_CONFIG, ...parsed };
      }
    }
  } catch {
    // Storage unavailable (partitioned iframe / privacy mode) — use defaults.
  }
  return { ...DEFAULT_WEAVE_CONFIG };
}

export function getWeaveConfig(): WeaveConfig {
  if (!activeWeaveConfig) activeWeaveConfig = loadStoredWeaveConfig();
  return activeWeaveConfig;
}

/** Update weave settings (admin tuning panel). Persists per-browser and
 *  invalidates the cached tile so the next render uses the new values. */
export function setWeaveConfig(patch: Partial<WeaveConfig>): WeaveConfig {
  activeWeaveConfig = { ...getWeaveConfig(), ...patch };
  fabricWeaveTile = null;
  try {
    window.localStorage.setItem(WEAVE_STORAGE_KEY, JSON.stringify(activeWeaveConfig));
  } catch {
    // Persistence is best-effort; in-memory config still applies this session.
  }
  return activeWeaveConfig;
}

export function resetWeaveConfig(): WeaveConfig {
  activeWeaveConfig = { ...DEFAULT_WEAVE_CONFIG };
  fabricWeaveTile = null;
  try {
    window.localStorage.removeItem(WEAVE_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
  return activeWeaveConfig;
}

/** Cached weave tile — regenerated when the config changes. */
let fabricWeaveTile: HTMLCanvasElement | null = null;

/** Deterministic PRNG so the weave looks identical on every render/session. */
function makeLcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Irregular plain-weave tile centred on neutral gray for overlay blending:
 * values above 128 lift thread tops (visible in dark art), values below 128
 * cut grooves (visible in light art). Yarn thickness and brightness vary per
 * thread (linen-style slubs) so it reads as woven fabric, not a printed grid.
 */
function getFabricWeaveTile(cfg: WeaveConfig): HTMLCanvasElement {
  if (fabricWeaveTile) return fabricWeaveTile;
  const size = 160;
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const ctx = tile.getContext("2d");
  if (!ctx) return tile;

  const rand = makeLcg(0x5eed);

  // Irregular yarn bands; last band absorbs the remainder so the tile wraps.
  const makeBands = (minW: number, maxW: number) => {
    const lo = Math.max(2, Math.round(Math.min(minW, maxW)));
    const hi = Math.max(lo, Math.round(Math.max(minW, maxW)));
    const bands: { start: number; width: number; tone: number }[] = [];
    let pos = 0;
    while (pos < size) {
      let w = lo + Math.floor(rand() * (hi - lo + 1));
      if (size - pos < lo || pos + w > size) w = size - pos;
      // Per-yarn brightness wobble — slub/thickness variation along the cloth.
      bands.push({ start: pos, width: w, tone: (rand() - 0.5) * cfg.slub });
      pos += w;
    }
    return bands;
  };
  const rows = makeBands(cfg.weftMin, cfg.weftMax); // horizontal yarns
  const cols = makeBands(cfg.warpMin, cfg.warpMax); // vertical yarns

  const gray = (v: number) => {
    const c = Math.max(0, Math.min(255, Math.round(v)));
    return `rgb(${c},${c},${c})`;
  };

  for (let ri = 0; ri < rows.length; ri++) {
    for (let ci = 0; ci < cols.length; ci++) {
      const row = rows[ri];
      const col = cols[ci];
      const x = col.start;
      const y = row.start;
      const warpOnTop = (ri + ci) % 2 === 0;
      const slub = (row.tone + col.tone) / 2 + (rand() - 0.5) * cfg.cellNoise;

      // Yarn body: raised yarn catches light, recessed yarn sits lower.
      ctx.fillStyle = gray((warpOnTop ? 146 : 118) + slub);
      ctx.fillRect(x, y, col.width, row.width);

      // Bright ridge along the raised yarn — jittered so ridges don't align.
      ctx.fillStyle = gray(cfg.ridgeTone + slub);
      if (warpOnTop) {
        const ry = y + 1 + Math.floor(rand() * Math.max(1, row.width - 2));
        ctx.fillRect(x + 1, ry, Math.max(1, col.width - 2), 1);
      } else {
        const rx = x + 1 + Math.floor(rand() * Math.max(1, col.width - 2));
        ctx.fillRect(rx, y + 1, 1, Math.max(1, row.width - 2));
      }

      // Deep grooves between yarns — darkness varies per cell.
      ctx.fillStyle = gray(cfg.grooveTone + (rand() - 0.5) * 24);
      if (warpOnTop) {
        ctx.fillRect(x, y, 1, row.width);
        ctx.fillRect(x + col.width - 1, y, 1, row.width);
      } else {
        ctx.fillRect(x, y, col.width, 1);
        ctx.fillRect(x, y + row.width - 1, col.width, 1);
      }
    }
  }

  fabricWeaveTile = tile;
  return tile;
}

/** Deterministic noise for grain/speckle (stable across re-renders). */
function makeBlendLcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function clipLayerToArt(
  layer: HTMLCanvasElement,
  artCanvas: HTMLCanvasElement,
): void {
  const ctx = layer.getContext("2d");
  if (!ctx) return;
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(artCanvas, 0, 0);
  ctx.globalCompositeOperation = "source-over";
}

function buildLinealOverlay(
  w: number,
  h: number,
  cfg: FabricBlendConfig,
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  // Neutral mid-grey field; darken lines for multiply/overlay.
  ctx.fillStyle = "rgb(180,180,180)";
  ctx.fillRect(0, 0, w, h);
  const lx = Math.max(2, Math.round(cfg.linealX));
  const ly = Math.max(2, Math.round(cfg.linealY));
  ctx.fillStyle = "rgb(95,95,95)";
  for (let x = 0; x < w; x += lx) ctx.fillRect(x, 0, 1, h);
  for (let y = 0; y < h; y += ly) ctx.fillRect(0, y, w, 1);
  return c;
}

function buildNoiseOverlay(
  w: number,
  h: number,
  grain: number,
  speckle: number,
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  ctx.fillStyle = "rgb(128,128,128)";
  ctx.fillRect(0, 0, w, h);
  const rand = makeBlendLcg(0xb13ed);
  // Fine grain — sample every few pixels for speed.
  if (grain > 0.005) {
    const step = Math.max(1, Math.round(3 - grain * 2));
    const amp = Math.round(grain * 55);
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const v = 128 + Math.round((rand() - 0.5) * 2 * amp);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(x, y, step, step);
      }
    }
  }
  // Coarse sparse speckle.
  if (speckle > 0.005) {
    const count = Math.round((w * h * speckle) / 900);
    for (let i = 0; i < count; i++) {
      const x = Math.floor(rand() * w);
      const y = Math.floor(rand() * h);
      const dark = rand() > 0.5;
      const v = dark ? Math.round(40 + rand() * 50) : Math.round(180 + rand() * 50);
      const s = 1 + Math.floor(rand() * 2);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x, y, s, s);
    }
  }
  return c;
}

/** Real tapestry blank × art using shipped FabricBlendConfig defaults. */
function applySimpleBlankMultiply(
  artCanvas: HTMLCanvasElement,
  artCtx: CanvasRenderingContext2D,
  blank: HTMLImageElement,
  w: number,
  h: number,
): void {
  const cfg = getFabricBlendConfig();
  const multiplyAlpha = Math.max(0, Math.min(1, 1 - cfg.transparency));

  const cloth = document.createElement("canvas");
  cloth.width = w;
  cloth.height = h;
  const cctx = cloth.getContext("2d");
  if (!cctx) return;

  const sat = Math.max(0, Math.min(2, cfg.vibrance));
  cctx.filter = `saturate(${Math.round(sat * 100)}%)`;
  cctx.drawImage(blank, 0, 0, w, h);
  cctx.filter = "none";
  clipLayerToArt(cloth, artCanvas);

  artCtx.save();
  if (multiplyAlpha > 0.001) {
    artCtx.globalCompositeOperation = "multiply";
    artCtx.globalAlpha = multiplyAlpha;
    artCtx.drawImage(cloth, 0, 0);
  }
  if (cfg.cream > 0.001) {
    artCtx.globalCompositeOperation = "soft-light";
    artCtx.globalAlpha = Math.max(0, Math.min(1, cfg.cream));
    artCtx.drawImage(cloth, 0, 0);
  }
  if (cfg.darkening > 0.001) {
    // Mid-grey multiply darkens fabric without crushing blacks to solid.
    const shade = document.createElement("canvas");
    shade.width = w;
    shade.height = h;
    const sctx = shade.getContext("2d");
    if (sctx) {
      const g = Math.round(255 * (1 - Math.max(0, Math.min(1, cfg.darkening)) * 0.55));
      sctx.fillStyle = `rgb(${g},${g},${g})`;
      sctx.fillRect(0, 0, w, h);
      clipLayerToArt(shade, artCanvas);
      artCtx.globalCompositeOperation = "multiply";
      artCtx.globalAlpha = 1;
      artCtx.drawImage(shade, 0, 0);
    }
  }
  if (cfg.linealAlpha > 0.001) {
    const lineal = buildLinealOverlay(w, h, cfg);
    clipLayerToArt(lineal, artCanvas);
    artCtx.globalCompositeOperation = "overlay";
    artCtx.globalAlpha = Math.max(0, Math.min(1, cfg.linealAlpha));
    artCtx.drawImage(lineal, 0, 0);
  }
  if (cfg.grain > 0.005 || cfg.speckle > 0.005) {
    const noise = buildNoiseOverlay(w, h, cfg.grain, cfg.speckle);
    clipLayerToArt(noise, artCanvas);
    artCtx.globalCompositeOperation = "overlay";
    artCtx.globalAlpha = Math.max(
      0,
      Math.min(1, Math.max(cfg.grain, cfg.speckle) * 0.85),
    );
    artCtx.drawImage(noise, 0, 0);
  }
  artCtx.restore();
}

/**
 * Emboss art with a tiled warp/weft pattern. Two passes:
 * overlay (texture contrast — highlights in shadow, grooves in light) then
 * multiply (overall fabric darkening to match Printify renders).
 * Instant: one cached tile, no network, no getImageData.
 *
 * `strengthScale` damps both passes when blank multiply already supplies body shading.
 */
function applyProceduralFabricWeave(
  artCanvas: HTMLCanvasElement,
  artCtx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts?: { strengthScale?: number },
): void {
  const cfg = getWeaveConfig();
  const strength = Math.max(0, Math.min(1, opts?.strengthScale ?? 1));
  if (strength <= 0) return;

  const tile = getFabricWeaveTile(cfg);
  const weave = document.createElement("canvas");
  weave.width = w;
  weave.height = h;
  const wctx = weave.getContext("2d");
  if (!wctx) return;

  const scale = Math.max(0.25, cfg.scale);
  const pattern = wctx.createPattern(tile, "repeat");
  if (!pattern) return;
  wctx.save();
  wctx.scale(scale, scale);
  wctx.fillStyle = pattern;
  wctx.fillRect(0, 0, w / scale + 1, h / scale + 1);
  wctx.restore();

  wctx.globalCompositeOperation = "destination-in";
  wctx.drawImage(artCanvas, 0, 0);
  wctx.globalCompositeOperation = "source-over";

  artCtx.save();
  // Pass 1: overlay — yarn ridges/grooves visible in both light and dark art.
  artCtx.globalCompositeOperation = "overlay";
  artCtx.globalAlpha = Math.max(0, Math.min(1, cfg.overlayAlpha * strength));
  artCtx.drawImage(weave, 0, 0);
  // Pass 2: hard-light — Printify-like knot micro-contrast (breaks up flats).
  artCtx.globalCompositeOperation = "hard-light";
  artCtx.globalAlpha = Math.max(0, Math.min(1, 0.35 * strength));
  artCtx.drawImage(weave, 0, 0);
  // Pass 3: multiply — fabric absorbs light, matching Printify's heavier blend.
  artCtx.globalCompositeOperation = "multiply";
  artCtx.globalAlpha = Math.max(0, Math.min(1, cfg.multiplyAlpha * strength));
  artCtx.drawImage(weave, 0, 0);
  artCtx.restore();
}

function scaleRectAroundCenter(rect: Rect, scale: number): Rect {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const w = rect.width * scale;
  const h = rect.height * scale;
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
}

type DrawAssetScaledFn = (
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dest: Rect,
  opts?: { refW?: number; refH?: number; useCrop?: boolean },
) => void;

/** Draw harvested mask into output space (same mapping as clipMaskToDest). */
function drawEdgeWrapMaskAt(
  ctx: CanvasRenderingContext2D,
  mask: HTMLImageElement,
  dest: Rect,
  view: FlatViewCalibration,
  maskAligned: boolean,
  crop: Rect | null | undefined,
  drawAssetScaled: DrawAssetScaledFn,
): void {
  if (maskAligned) {
    drawAssetScaled(ctx, mask, dest, { useCrop: true });
  } else {
    const mw = mask.naturalWidth || mask.width;
    const mh = mask.naturalHeight || mask.height;
    const maskCrop = resolveEdgeWrapSourceCrop(view, mask);
    if (maskCrop && mw > 0 && mh > 0) {
      ctx.drawImage(
        mask,
        maskCrop.x,
        maskCrop.y,
        maskCrop.width,
        maskCrop.height,
        dest.x,
        dest.y,
        dest.width,
        dest.height,
      );
    } else if (mw > 0 && mh > 0) {
      ctx.drawImage(mask, 0, 0, mw, mh, dest.x, dest.y, dest.width, dest.height);
    }
  }
}

/**
 * Mask pixels that are transparent but not connected to the canvas border
 * (camera cutouts), plus a thin outer rim ring. Avoids square phoneBack rects.
 */
function buildBlankHardwarePunchMask(
  outW: number,
  outH: number,
  mask: HTMLImageElement,
  maskDraw: Rect,
  view: FlatViewCalibration,
  maskAligned: boolean,
  crop: Rect | null | undefined,
  drawAssetScaled: DrawAssetScaledFn,
): HTMLCanvasElement | null {
  const alphaCanvas = document.createElement("canvas");
  alphaCanvas.width = outW;
  alphaCanvas.height = outH;
  const actx = alphaCanvas.getContext("2d");
  if (!actx) return null;
  drawEdgeWrapMaskAt(actx, mask, maskDraw, view, maskAligned, crop, drawAssetScaled);

  let data: ImageData;
  try {
    data = actx.getImageData(0, 0, outW, outH);
  } catch {
    return null;
  }

  const n = outW * outH;
  const isTransparent = (idx: number) => data.data[idx * 4 + 3] <= 10;
  const exterior = new Uint8Array(n);
  const queue: number[] = [];
  const pushIfExterior = (x: number, y: number) => {
    if (x < 0 || x >= outW || y < 0 || y >= outH) return;
    const idx = y * outW + x;
    if (exterior[idx] || !isTransparent(idx)) return;
    exterior[idx] = 1;
    queue.push(idx);
  };
  for (let x = 0; x < outW; x++) {
    pushIfExterior(x, 0);
    pushIfExterior(x, outH - 1);
  }
  for (let y = 0; y < outH; y++) {
    pushIfExterior(0, y);
    pushIfExterior(outW - 1, y);
  }
  while (queue.length > 0) {
    const idx = queue.pop()!;
    const x = idx % outW;
    const y = (idx / outW) | 0;
    pushIfExterior(x - 1, y);
    pushIfExterior(x + 1, y);
    pushIfExterior(x, y - 1);
    pushIfExterior(x, y + 1);
  }

  const punchMask = document.createElement("canvas");
  punchMask.width = outW;
  punchMask.height = outH;
  const pmCtx = punchMask.getContext("2d");
  if (!pmCtx) return null;
  const punchData = pmCtx.createImageData(outW, outH);
  for (let idx = 0; idx < n; idx++) {
    if (isTransparent(idx) && !exterior[idx]) {
      const o = idx * 4;
      punchData.data[o] = 255;
      punchData.data[o + 1] = 255;
      punchData.data[o + 2] = 255;
      punchData.data[o + 3] = 255;
    }
  }
  pmCtx.putImageData(punchData, 0, 0);

  // Thin outer rim — case bevel over artwork. Keep tiny so corners don't look like
  // missing art where plastic reflections should read instead.
  const outerDraw = scaleRectAroundCenter(maskDraw, 1.003);
  pmCtx.globalCompositeOperation = "source-over";
  pmCtx.fillStyle = "#ffffff";
  drawEdgeWrapMaskAt(pmCtx, mask, outerDraw, view, maskAligned, crop, drawAssetScaled);
  pmCtx.globalCompositeOperation = "destination-out";
  drawEdgeWrapMaskAt(pmCtx, mask, maskDraw, view, maskAligned, crop, drawAssetScaled);

  return punchMask;
}

/**
 * Redraw blank on top of art for camera cutouts and the outer case lip.
 * Printable mask regions stay art-only; holes + rim show the blank photo again.
 */
function compositeBlankHardwareOnTop(
  ctx: CanvasRenderingContext2D,
  layout: FlatPrintCanvasLayout,
  blank: HTMLImageElement,
  mask: HTMLImageElement,
  blankDraw: Rect,
  maskDraw: Rect,
  view: FlatViewCalibration,
  maskAligned: boolean,
  crop: Rect | null | undefined,
  maskRefW: number,
  maskRefH: number,
  blankRefW: number,
  blankRefH: number,
  drawAssetScaled: DrawAssetScaledFn,
): void {
  const outW = layout.previewW;
  const outH = layout.previewH;

  const punchMask = buildBlankHardwarePunchMask(
    outW,
    outH,
    mask,
    maskDraw,
    view,
    maskAligned,
    crop,
    drawAssetScaled,
  );
  if (!punchMask) return;

  const hwLayer = document.createElement("canvas");
  hwLayer.width = outW;
  hwLayer.height = outH;
  const hwCtx = hwLayer.getContext("2d");
  if (!hwCtx) return;
  drawAssetScaled(hwCtx, blank, blankDraw, {
    refW: maskAligned ? maskRefW : blankRefW,
    refH: maskAligned ? maskRefH : blankRefH,
    useCrop: !!crop,
  });
  hwCtx.globalCompositeOperation = "destination-in";
  hwCtx.drawImage(punchMask, 0, 0);
  ctx.drawImage(hwLayer, 0, 0);
}

/**
 * Composite `input` onto `input.target`. Always paints the blank base; if
 * artwork is present, draws it (flat blit or mesh warp), clips to the mask,
 * applies shading, and composites over the blank. Throws nothing it can avoid
 * — callers should still try/catch and fall back to the Printify flow.
 */
export function renderFlatView(input: FlatRenderInput): void {
  const {
    target,
    blank,
    mask,
    shading,
    artwork,
    view,
    placement,
    tier,
    artworkCorsClean = true,
    forceShadingMap = false,
    edgeWrapMode = false,
    printCanvasBackgroundColor = null,
    decorMode = false,
    fabricWeave = false,
    layerAdjust,
    previewLayers,
    garmentColorHex = null,
  } = input;
  const coloredBlank =
    !edgeWrapMode &&
    !decorMode &&
    garmentColorHex &&
    parseCssHex(garmentColorHex)
      ? colorizeApparelBlank(blank, garmentColorHex)
      : null;
  const blankDrawSource = coloredBlank || blank;
  const { w: W, h: H } = imgDims(blank);
  if (W <= 0 || H <= 0) return;

  if (edgeWrapMode) {
    const layout = flatPrintCanvasLayout(view, { mask, blank });
    const outW = layout.previewW;
    const outH = layout.previewH;
    const crop = layout.sourceCrop;
    const baseDraw = layout.imageDraw;
    const blankDraw = adjustCalibratorDrawRect(baseDraw, layerAdjust?.blank, outW, outH);
    const maskDraw = adjustCalibratorDrawRect(baseDraw, layerAdjust?.mask, outW, outH);
    const shadeDraw = adjustCalibratorDrawRect(baseDraw, layerAdjust?.shading, outW, outH);
    const maskAligned = maskAlignsWithBlank(blank, mask);

    const maskRefW = mask ? (mask.naturalWidth || mask.width) : W;
    const maskRefH = mask ? (mask.naturalHeight || mask.height) : H;

    const drawAssetScaled = (
      ctx: CanvasRenderingContext2D,
      img: HTMLImageElement,
      dest: Rect,
      opts?: { refW?: number; refH?: number; useCrop?: boolean },
    ) => {
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      if (iw <= 0 || ih <= 0) return;
      const refW = opts?.refW ?? maskRefW;
      const refH = opts?.refH ?? maskRefH;
      const useCrop = opts?.useCrop ?? !!crop;
      const sx = refW > 0 ? iw / refW : 1;
      const sy = refH > 0 ? ih / refH : 1;
      if (useCrop && crop) {
        ctx.drawImage(
          img,
          crop.x * sx,
          crop.y * sy,
          crop.width * sx,
          crop.height * sy,
          dest.x,
          dest.y,
          dest.width,
          dest.height,
        );
      } else {
        ctx.drawImage(img, 0, 0, iw, ih, dest.x, dest.y, dest.width, dest.height);
      }
    };

    const clipMaskToDest = (ctx: CanvasRenderingContext2D, dest: Rect) => {
      if (!mask) return;
      ctx.globalCompositeOperation = "destination-in";
      if (maskAligned) {
        drawAssetScaled(ctx, mask, dest, { useCrop: true });
      } else {
        const mw = mask.naturalWidth || mask.width;
        const mh = mask.naturalHeight || mask.height;
        const maskCrop = resolveEdgeWrapSourceCrop(view, mask);
        if (maskCrop && mw > 0 && mh > 0) {
          ctx.drawImage(
            mask,
            maskCrop.x,
            maskCrop.y,
            maskCrop.width,
            maskCrop.height,
            dest.x,
            dest.y,
            dest.width,
            dest.height,
          );
        } else if (mw > 0 && mh > 0) {
          ctx.drawImage(mask, 0, 0, mw, mh, dest.x, dest.y, dest.width, dest.height);
        }
      }
      ctx.globalCompositeOperation = "source-over";
    };

    const showBlankLayer = previewLayers?.blank !== false;
    const showShadingLayer = previewLayers?.shading !== false;
    const showArtLayer = previewLayers?.artwork !== false && !!artwork;

    target.width = outW;
    target.height = outH;
    const ctx = target.getContext("2d");
    if (!ctx) return;

    const customerBg = parsePrintCanvasFillHex(printCanvasBackgroundColor);

    // Step 1: Always Printify grey guide chrome for the print canvas (blue
    // dashed). Customer bg is mask-clipped in step 2b so the outer grey box
    // never floods with colour — bake still fills the full print file.
    ctx.clearRect(0, 0, outW, outH);
    ctx.fillStyle = PRINT_CANVAS_GREY;
    ctx.fillRect(0, 0, outW, outH);

    // Step 2: Blank phone photo, clipped to the phone silhouette so the JPEG
    // white background never bleeds over the grey margins.
    if (showBlankLayer) {
      const blankLayer = document.createElement("canvas");
      blankLayer.width = outW;
      blankLayer.height = outH;
      const blCtx = blankLayer.getContext("2d");
      if (blCtx) {
        drawAssetScaled(blCtx, blank, blankDraw, {
          refW: maskAligned ? maskRefW : W,
          refH: maskAligned ? maskRefH : H,
          useCrop: !!crop,
        });
        clipMaskToDest(blCtx, maskDraw);
      }
      ctx.drawImage(blankLayer, 0, 0);
    }

    const punchBlankHardware = () => {
      if (!showBlankLayer || !mask) return;
      compositeBlankHardwareOnTop(
        ctx,
        layout,
        blank,
        mask,
        blankDraw,
        maskDraw,
        view,
        maskAligned,
        crop,
        maskRefW,
        maskRefH,
        W,
        H,
        drawAssetScaled,
      );
    };

    // Step 2b: Customer bg on the masked phone (face + wrap edges under art).
    if (customerBg) {
      const bgLayer = document.createElement("canvas");
      bgLayer.width = outW;
      bgLayer.height = outH;
      const bgCtx = bgLayer.getContext("2d");
      if (bgCtx) {
        bgCtx.fillStyle = customerBg;
        bgCtx.fillRect(
          layout.printCanvas.x,
          layout.printCanvas.y,
          layout.printCanvas.width,
          layout.printCanvas.height,
        );
        if (mask) {
          clipMaskToDest(bgCtx, maskDraw);
        } else {
          const pb = layout.phoneBack;
          bgCtx.save();
          bgCtx.beginPath();
          bgCtx.rect(pb.x, pb.y, pb.width, pb.height);
          bgCtx.clip();
          bgCtx.globalCompositeOperation = "destination-in";
          bgCtx.fillStyle = "#fff";
          bgCtx.fillRect(pb.x, pb.y, pb.width, pb.height);
          bgCtx.restore();
        }
        ctx.drawImage(bgLayer, 0, 0);
      }
    }

    if (!showArtLayer || !artwork) {
      punchBlankHardware();
      return;
    }
    const { w: artW, h: artH } = imgDims(artwork);
    if (artW <= 0 || artH <= 0) return;

    const rect = layout.printCanvas;
    const art = document.createElement("canvas");
    art.width = outW;
    art.height = outH;
    const actx = art.getContext("2d");
    if (!actx) return;

    const box = flatArtBox(rect, placement, artW, artH);
    drawFlatArtwork(actx, artwork, box, placement.rotationDeg ?? 0);

    if (mask) {
      clipMaskToDest(actx, maskDraw);
    } else {
      const pb = layout.phoneBack;
      actx.save();
      actx.beginPath();
      actx.rect(pb.x, pb.y, pb.width, pb.height);
      actx.clip();
      actx.globalCompositeOperation = "destination-in";
      actx.fillStyle = "#fff";
      actx.fillRect(pb.x, pb.y, pb.width, pb.height);
      actx.restore();
    }

    if (showShadingLayer) {
      const shadeMode: "blank" | "map" =
        view.shadingMode === "map" || (forceShadingMap && shading) ? "map" : view.shadingMode;

      // Shading blank: same position as the clipped blank layer so luminance
      // normalization samples the correct phone surface, not white margins.
      const shadeBlankCanvas = document.createElement("canvas");
      shadeBlankCanvas.width = outW;
      shadeBlankCanvas.height = outH;
      const sbCtx = shadeBlankCanvas.getContext("2d");
      if (sbCtx) {
        drawAssetScaled(sbCtx, blank, blankDraw, {
          refW: maskAligned ? maskRefW : W,
          refH: maskAligned ? maskRefH : H,
          useCrop: !!crop,
        });
        clipMaskToDest(sbCtx, maskDraw);
      }

      let shadeMapImg: HTMLImageElement | HTMLCanvasElement | null = shading;
      if (shading) {
        const sc = document.createElement("canvas");
        sc.width = outW;
        sc.height = outH;
        const scx = sc.getContext("2d");
        if (scx) {
          drawAssetScaled(scx, shading, shadeDraw, {
            refW: maskAligned ? maskRefW : W,
            refH: maskAligned ? maskRefH : H,
            useCrop: !!crop,
          });
          clipMaskToDest(scx, maskDraw);
          shadeMapImg = sc;
        }
      }

      applyShading(
        art,
        actx,
        shadeMode,
        shadeBlankCanvas as unknown as HTMLImageElement,
        shadeMapImg as HTMLImageElement | null,
        outW,
        outH,
        artworkCorsClean,
        {
          phoneCaseMap: shadeMode === "map" && !!shadeMapImg,
          fabricWeave: fabricWeave && !edgeWrapMode,
        },
      );
    }

    ctx.drawImage(art, 0, 0);
    punchBlankHardware();
    return;
  }

  target.width = W;
  target.height = H;
  const ctx = target.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(blankDrawSource, 0, 0, W, H);

  const areaFill = parsePrintCanvasFillHex(printCanvasBackgroundColor);
  const { w: artW, h: artH } = artwork ? imgDims(artwork) : { w: 0, h: 0 };
  const hasArt = !!(artwork && artW > 0 && artH > 0);
  // Fill both faces even when this view's artwork is off (print-on-back
  // independent of bg). Matches tote / pillow bake.
  if (!hasArt && !areaFill) return;

  const rect = flatPlacementRectPx(view, mask, W, H, { edgeWrapMode, decorMode });

  const art = document.createElement("canvas");
  art.width = W;
  art.height = H;
  const actx = art.getContext("2d");
  if (!actx) return;

  let drewMesh = false;
  if (tier === "mesh" && view.meshNodes && view.meshNodes.length > 0) {
    const md = view.mockupDims;
    const scaleX = md && md.width > 0 ? W / md.width : 1;
    const scaleY = md && md.height > 0 ? H / md.height : 1;

    const printW = Math.max(2, Math.round(view.printFileDims.width));
    const printH = Math.max(2, Math.round(view.printFileDims.height));
    const printCanvas = document.createElement("canvas");
    printCanvas.width = printW;
    printCanvas.height = printH;
    const pctx = printCanvas.getContext("2d");
    const printRect: Rect = { x: 0, y: 0, width: printW, height: printH };
    const mesh = buildMeshGrid(view, scaleX, scaleY, printRect);
    if (pctx && mesh) {
      if (areaFill) {
        pctx.fillStyle = areaFill;
        pctx.fillRect(printRect.x, printRect.y, printRect.width, printRect.height);
      }
      if (hasArt && artwork) {
        const box = flatArtBox(printRect, placement, artW, artH);
        drawFlatArtwork(pctx, artwork, box, placement.rotationDeg ?? 0);
      }
      if (areaFill || hasArt) {
        drawMeshWarp(actx, printCanvas, printW, printH, mesh, { inflateSeams: true });
        drewMesh = true;
      }
    }
  }

  if (!drewMesh) {
    if (areaFill) {
      actx.fillStyle = areaFill;
      actx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
    if (hasArt && artwork) {
      const box = flatArtBox(rect, placement, artW, artH);
      drawFlatArtwork(actx, artwork, box, placement.rotationDeg ?? 0);
    }
  }

  clipFlatArtToPrintArea(actx, {
    mask,
    rect,
    canvasW: W,
    canvasH: H,
    fabricWeave: fabricWeave && !edgeWrapMode,
  });

  const shadeMode: "blank" | "map" =
    view.shadingMode === "map" || (forceShadingMap && shading) ? "map" : view.shadingMode;
  applyShading(
    art,
    actx,
    shadeMode,
    blank,
    shading,
    W,
    H,
    artworkCorsClean,
    {
      phoneCaseMap: shadeMode === "map" && !!shading && !!edgeWrapMode,
      fabricWeave: fabricWeave && !edgeWrapMode,
    },
  );

  ctx.drawImage(art, 0, 0);
}
