import {
  isPulloverHoodieBlueprint,
  mergeFrontBodyPanelPlacementBias,
  type DesignGroup,
  type FrontBodyPanelPlacementBias,
  type HoodiePanelKey,
} from "./hoodieTemplate";

export type PulloverPocketOverlayRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MockupBbox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MockupPoint = { x: number; y: number };

/**
 * Pullover kangaroo pocket is exported as its own Printify panel (like zip
 * `pocket_left` / `pocket_right`), not baked into `front`. Live bp 450
 * placeholders include a pocket slot — omitting it makes the mockup server
 * fill that slot with solid bgColor (blank pocket overlay).
 */
export function shouldExportPulloverPocketAsPrintifyPanel(
  blueprintId: number | null | undefined,
  pocketsEnabled: boolean,
  hoodieType?: string | null,
): boolean {
  if (!pocketsEnabled) return false;
  return (
    isPulloverHoodieBlueprint(blueprintId) ||
    hoodieType === "pullover-hoodie-aop"
  );
}

/** @deprecated Use shouldExportPulloverPocketAsPrintifyPanel */
export function shouldMergePulloverPocketForPrintify(
  blueprintId: number | null | undefined,
  pocketsEnabled: boolean,
  hoodieType?: string | null,
): boolean {
  return shouldExportPulloverPocketAsPrintifyPanel(
    blueprintId,
    pocketsEnabled,
    hoodieType,
  );
}

/**
 * Printify may name the pullover kangaroo placeholder `front_pocket`, `pocket`,
 * or similar. Match uploaded panel URLs onto discovered placeholder positions.
 */
export function resolvePrintifyPanelImageId(
  position: string,
  panelImageIds: Map<string, string>,
): string | undefined {
  if (panelImageIds.has(position)) return panelImageIds.get(position);
  // Case-insensitive exact key (bp 449 uses `Collar`, client historically sent `collar`).
  const lower = position.toLowerCase();
  for (const [key, id] of panelImageIds) {
    if (key.toLowerCase() === lower) return id;
  }
  const aliases =
    PRINTIFY_PANEL_POSITION_ALIASES[position] ??
    PRINTIFY_PANEL_POSITION_ALIASES[lower];
  if (aliases) {
    for (const alias of aliases) {
      if (panelImageIds.has(alias)) return panelImageIds.get(alias);
      for (const [key, id] of panelImageIds) {
        if (key.toLowerCase() === alias.toLowerCase()) return id;
      }
    }
  }
  // Any pocket-like placeholder ↔ any uploaded pocket-like panel.
  if (isPocketLikePrintifyPosition(position)) {
    for (const [key, id] of panelImageIds) {
      if (isPocketLikePrintifyPosition(key)) return id;
    }
  }
  return undefined;
}

/**
 * When the client omitted the kangaroo panel, reuse the front-body print
 * image instead of solid bgColor — blank white pockets are worse than a
 * slightly mismatched tile scale on the pocket overlay.
 */
export function resolvePocketFallbackImageId(
  panelImageIds: Map<string, string>,
): string | undefined {
  return (
    panelImageIds.get("front") ??
    panelImageIds.get("front_left") ??
    panelImageIds.get("front_right")
  );
}

/** Placeholder position → accepted client panelUrl position names. */
export const PRINTIFY_PANEL_POSITION_ALIASES: Record<string, string[]> = {
  front_pocket: ["front_pocket", "pocket", "kangaroo_pocket", "front_pocket_panel"],
  pocket: ["pocket", "front_pocket", "kangaroo_pocket", "front_pocket_panel"],
  kangaroo_pocket: ["kangaroo_pocket", "front_pocket", "pocket", "front_pocket_panel"],
  front_pocket_panel: ["front_pocket_panel", "front_pocket", "pocket", "kangaroo_pocket"],
  // bp 449 sweatshirt — Printify catalog uses title-case `Collar`.
  Collar: ["Collar", "collar"],
  collar: ["collar", "Collar"],
};

const POCKET_ALIAS_NAMES = new Set(
  Object.keys(PRINTIFY_PANEL_POSITION_ALIASES).concat(
    ...Object.values(PRINTIFY_PANEL_POSITION_ALIASES),
  ),
);

export function isPocketLikePrintifyPosition(position: string): boolean {
  return /pocket/i.test(position) || POCKET_ALIAS_NAMES.has(position);
}

/**
 * After uploading client panelUrls, register each pocket image under every
 * known alias so live bp 450 placeholder names cannot miss the art.
 */
export function expandPanelImageIdsWithPocketAliases(
  panelImageIds: Map<string, string>,
): void {
  const additions: Array<[string, string]> = [];
  for (const [position, imageId] of panelImageIds) {
    if (!isPocketLikePrintifyPosition(position)) continue;
    const aliases =
      PRINTIFY_PANEL_POSITION_ALIASES[position] ??
      Array.from(POCKET_ALIAS_NAMES);
    for (const alias of aliases) {
      if (!panelImageIds.has(alias)) {
        additions.push([alias, imageId]);
      }
    }
  }
  for (const [alias, imageId] of additions) {
    panelImageIds.set(alias, imageId);
  }
}

/** Register collar uploads under both `Collar` (bp 449) and `collar`. */
export function expandPanelImageIdsWithCollarAliases(
  panelImageIds: Map<string, string>,
): void {
  const additions: Array<[string, string]> = [];
  for (const [position, imageId] of panelImageIds) {
    if (!/collar/i.test(position)) continue;
    for (const alias of ["Collar", "collar"]) {
      if (!panelImageIds.has(alias)) {
        additions.push([alias, imageId]);
      }
    }
  }
  for (const [alias, imageId] of additions) {
    panelImageIds.set(alias, imageId);
  }
}

/**
 * If one hood half uploaded and the other didn't, reuse the sibling image.
 * Prevents a blank true-left/true-right hood when a single panel is omitted.
 */
export function expandHoodPanelImageIdsWithSiblingFallback(
  panelImageIds: Map<string, string>,
): void {
  const left = panelImageIds.get("left_hood");
  const right = panelImageIds.get("right_hood");
  if (left && !right) panelImageIds.set("right_hood", left);
  if (right && !left) panelImageIds.set("left_hood", right);
}

/** Map overlay rect using reference bboxes (mesh target or polygon) in mockup space. */
export function overlayRectOnReferencePanel(
  hostBb: MockupBbox,
  overlayBb: MockupBbox,
  hostCanvasW: number,
  hostCanvasH: number,
): PulloverPocketOverlayRect {
  return pocketOverlayRectOnFrontPanel(hostBb, overlayBb, hostCanvasW, hostCanvasH);
}

export function mapMockupPointToFrontFlat(
  p: MockupPoint,
  hostBb: MockupBbox,
  flatW: number,
  flatH: number,
): MockupPoint {
  return {
    x: ((p.x - hostBb.x) / Math.max(1, hostBb.width)) * flatW,
    y: ((p.y - hostBb.y) / Math.max(1, hostBb.height)) * flatH,
  };
}

export function mapMockupPointsToFrontFlat(
  points: MockupPoint[],
  hostBb: MockupBbox,
  flatW: number,
  flatH: number,
): MockupPoint[] {
  return points.map((p) => mapMockupPointToFrontFlat(p, hostBb, flatW, flatH));
}

export function punchOutRectOnCanvas(
  ctx: CanvasRenderingContext2D,
  rect: PulloverPocketOverlayRect,
  fillColor: string,
): void {
  ctx.fillStyle = fillColor;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
}

/**
 * Place-mode pocket crop tunables.
 * Aspect is always the live pocket placeholder (never hardcoded).
 *
 * `POCKET_WINDOW_SCALE` = 1 is the smallest placeholder-aspect rect in
 * front-canvas px that covers the mapped pocket-mask AABB (art reaches
 * every pocket edge, no extra zoom). Derived from published L masks:
 * zip cover is max(mappedW, mappedH×aspect) — height-only at scale 1
 * would miss ~6% of pocket width after the canvas-space rebuild.
 * Multiply this cover size; do not use separate X/Y scales.
 *
 * `POCKET_SEAM_PIN_X`: mockup-px zip line, mapped to canvas once, then
 * pins the window's inner edge. `null` = midpoint of the two pocket-mask
 * inner edges. Zip only.
 */
/** Pullover pocket vs new front zoom: 1.1527 / 1.0371. Applied to the live sample bbox (front_pocket only). */
export const POCKET_WINDOW_SCALE = 1.1115;
export const POCKET_WINDOW_OFFSET_X = 0;
/** Sewn-fold source inset (canvas px, negative = sample higher on the body). */
export const POCKET_WINDOW_OFFSET_Y = -100;
export const POCKET_SEAM_PIN_X: number | null = null;
/** Canvas-H used to convert `POCKET_WINDOW_OFFSET_Y` into mockup px (~10 mm at 3200). */
export const POCKET_SOURCE_INSET_CANVAS_REF_H = 3200;

/** Canvas-px inset → mockup-px shift on the pocket sample bbox. */
export function pocketSampleInsetMockupY(
  frontMaskH: number,
  canvasH = POCKET_SOURCE_INSET_CANVAS_REF_H,
  offsetY = POCKET_WINDOW_OFFSET_Y,
): number {
  if (!(frontMaskH > 0) || !(canvasH > 0)) return 0;
  return offsetY * (frontMaskH / canvasH);
}

/** Shift a pocket sample bbox up/down for the sewn-fold inset. */
export function applyPocketSourceInsetToBbox<T extends MockupBbox>(
  bb: T,
  frontMaskH: number,
): T {
  const dy = pocketSampleInsetMockupY(frontMaskH);
  if (dy === 0) return bb;
  return { ...bb, y: bb.y + dy };
}

/** Grow/shrink a pocket sample bbox about its center (live Place path). */
export function applyPocketSourceScaleToBbox<T extends MockupBbox>(
  bb: T,
  scale = POCKET_WINDOW_SCALE,
): T {
  if (!(scale > 0) || scale === 1) return bb;
  const cx = bb.x + bb.width / 2;
  const cy = bb.y + bb.height / 2;
  const w = bb.width * scale;
  const h = bb.height * scale;
  return { ...bb, x: cx - w / 2, y: cy - h / 2, width: w, height: h };
}

/**
 * Sewn-fold Y inset, then (pullover `front_pocket` only) sample-bbox scale.
 * Zip halves keep inset-only so 1.1115 does not change zip zoom.
 */
export function applyPocketLiveSampleToBbox<T extends MockupBbox>(
  bb: T,
  frontMaskH: number,
  panelKey?: HoodiePanelKey | null,
): T {
  const inset = applyPocketSourceInsetToBbox(bb, frontMaskH);
  if (panelKey === "front_pocket") {
    return applyPocketSourceScaleToBbox(inset);
  }
  return inset;
}

/** Mockup point → host-canvas px. The anisotropic map is only for points. */
export function mapMockupPointToFrontCanvas(
  frontMaskBb: MockupBbox,
  pt: MockupPoint,
  frontCanvasW: number,
  frontCanvasH: number,
): MockupPoint | null {
  if (!(frontMaskBb.width > 0) || !(frontMaskBb.height > 0)) return null;
  if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return null;
  return {
    x: (pt.x - frontMaskBb.x) * (frontCanvasW / frontMaskBb.width),
    y: (pt.y - frontMaskBb.y) * (frontCanvasH / frontMaskBb.height),
  };
}

/**
 * Smallest placeholder-aspect size that covers a canvas-space box, then × scale.
 * Width and height share one basis — never scaleX for width and scaleY for height.
 */
export function canvasSpacePocketCoverSize(
  mappedPocketW: number,
  mappedPocketH: number,
  aspect: number,
  scale = 1,
): { width: number; height: number } | null {
  if (!(aspect > 0) || !Number.isFinite(aspect)) return null;
  if (!(mappedPocketW > 0) || !(mappedPocketH > 0) || !(scale > 0)) return null;
  const coverW = Math.max(mappedPocketW, mappedPocketH * aspect);
  const width = coverW * scale;
  const height = width / aspect;
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  return { width, height };
}

/** Shift a rect to sit inside the canvas without changing size (aspect stays). */
export function shiftRectToFitCanvas(
  rect: PulloverPocketOverlayRect,
  canvasW: number,
  canvasH: number,
): PulloverPocketOverlayRect | null {
  if (rect.width > canvasW + 1e-6 || rect.height > canvasH + 1e-6) return null;
  let x = rect.x;
  let y = rect.y;
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x + rect.width > canvasW) x = canvasW - rect.width;
  if (y + rect.height > canvasH) y = canvasH - rect.height;
  return { x, y, width: rect.width, height: rect.height };
}

/** Canvas-space overlap of a crop window with the host bake. */
export function intersectRectWithCanvas(
  rect: PulloverPocketOverlayRect,
  canvasW: number,
  canvasH: number,
): PulloverPocketOverlayRect | null {
  const x0 = Math.max(rect.x, 0);
  const y0 = Math.max(rect.y, 0);
  const x1 = Math.min(rect.x + rect.width, canvasW);
  const y1 = Math.min(rect.y + rect.height, canvasH);
  const width = x1 - x0;
  const height = y1 - y0;
  if (!(width > 1e-6) || !(height > 1e-6)) return null;
  return { x: x0, y: y0, width, height };
}

export function zipPocketSeamSide(
  pocketKey: HoodiePanelKey | string | null | undefined,
): "left" | "right" | null {
  if (pocketKey === "pocket_left") return "left";
  if (pocketKey === "pocket_right") return "right";
  return null;
}

/**
 * Zip line in mockup px: midpoint of pocket_left's left edge and
 * pocket_right's right edge (the two mask inner edges across the zipper gap).
 */
export function computeZipPocketSeamPinX(
  pocketLeftBb: MockupBbox | null | undefined,
  pocketRightBb: MockupBbox | null | undefined,
): number | null {
  if (!pocketLeftBb || !pocketRightBb) return null;
  if (!(pocketLeftBb.width > 0) || !(pocketRightBb.width > 0)) return null;
  const leftInner = pocketLeftBb.x;
  const rightInner = pocketRightBb.x + pocketRightBb.width;
  if (!Number.isFinite(leftInner) || !Number.isFinite(rightInner)) return null;
  return (leftInner + rightInner) / 2;
}

/** Zip halves crop from that half's front bake; pullover kangaroo from `front`. */
export function pocketPrintHostPanelKey(
  pocketKey: HoodiePanelKey | string | null | undefined,
): HoodiePanelKey | null {
  if (pocketKey === "pocket_left") return "front_left";
  if (pocketKey === "pocket_right") return "front_right";
  if (pocketKey === "front_pocket") return "front";
  return null;
}

export function isDegeneratePocketPrintDims(
  dims: { width: number; height: number } | null | undefined,
): boolean {
  return (
    !dims ||
    !(dims.width > 0) ||
    !(dims.height > 0) ||
    !Number.isFinite(dims.width) ||
    !Number.isFinite(dims.height)
  );
}

/**
 * Placeholder-aspect pocket window, built in front-canvas pixels.
 * 1. Map pocket center (+ zip pin X) through the anisotropic AABB→canvas
 *    map once. After this, that map must not touch width or height.
 * 2. Size from one canvas-space cover rect × pocketWindowScale, aspect
 *    locked to the live placeholder. Pullover: center on mapped center.
 *    Zip: pin inner edge to the mapped zip line, grow outward, then
 *    shift-to-fit so the half stays on its host canvas (zipper-gap only).
 * Returns null if aspect is unusable or the rect misses the canvas —
 * callers must skip, not invent a zip fallback aspect.
 */
export function buildPocketWindowOnFrontCanvas(opts: {
  frontMaskBb: MockupBbox;
  pocketMaskBb: MockupBbox;
  frontCanvasW: number;
  frontCanvasH: number;
  pocketAspect: number;
  scale?: number;
  offsetX?: number;
  offsetY?: number;
  /** Zip only: "left" pins the window's left edge (pocket_left); "right" pins the right. */
  seamSide?: "left" | "right" | null;
  /** Mockup-px zip line. Mapped to canvas once. Ignored when `seamSide` is null. */
  seamPinX?: number | null;
}): PulloverPocketOverlayRect | null {
  const aspect = opts.pocketAspect;
  if (!(aspect > 0) || !Number.isFinite(aspect)) return null;
  if (
    !(opts.pocketMaskBb.width > 0) ||
    !(opts.pocketMaskBb.height > 0) ||
    !(opts.frontMaskBb.width > 0) ||
    !(opts.frontMaskBb.height > 0)
  ) {
    return null;
  }
  const center = mapMockupPointToFrontCanvas(
    opts.frontMaskBb,
    {
      x: opts.pocketMaskBb.x + opts.pocketMaskBb.width / 2,
      y: opts.pocketMaskBb.y + opts.pocketMaskBb.height / 2,
    },
    opts.frontCanvasW,
    opts.frontCanvasH,
  );
  const pocketMin = mapMockupPointToFrontCanvas(
    opts.frontMaskBb,
    { x: opts.pocketMaskBb.x, y: opts.pocketMaskBb.y },
    opts.frontCanvasW,
    opts.frontCanvasH,
  );
  const pocketMax = mapMockupPointToFrontCanvas(
    opts.frontMaskBb,
    {
      x: opts.pocketMaskBb.x + opts.pocketMaskBb.width,
      y: opts.pocketMaskBb.y + opts.pocketMaskBb.height,
    },
    opts.frontCanvasW,
    opts.frontCanvasH,
  );
  if (!center || !pocketMin || !pocketMax) return null;
  const size = canvasSpacePocketCoverSize(
    Math.abs(pocketMax.x - pocketMin.x),
    Math.abs(pocketMax.y - pocketMin.y),
    aspect,
    opts.scale ?? POCKET_WINDOW_SCALE,
  );
  if (!size) return null;
  const { width, height } = size;
  let x: number;
  let y = center.y - height / 2;
  const pinX = opts.seamPinX;
  if (
    (opts.seamSide === "left" || opts.seamSide === "right") &&
    pinX != null &&
    Number.isFinite(pinX)
  ) {
    const pin = mapMockupPointToFrontCanvas(
      opts.frontMaskBb,
      { x: pinX, y: opts.pocketMaskBb.y + opts.pocketMaskBb.height / 2 },
      opts.frontCanvasW,
      opts.frontCanvasH,
    );
    if (!pin) return null;
    x = opts.seamSide === "left" ? pin.x : pin.x - width;
  } else {
    x = center.x - width / 2;
  }
  const placed: PulloverPocketOverlayRect = {
    x: x + (opts.offsetX ?? POCKET_WINDOW_OFFSET_X),
    y: y + (opts.offsetY ?? POCKET_WINDOW_OFFSET_Y),
    width,
    height,
  };
  if (!intersectRectWithCanvas(placed, opts.frontCanvasW, opts.frontCanvasH)) {
    return null;
  }
  return shiftRectToFitCanvas(placed, opts.frontCanvasW, opts.frontCanvasH);
}

export function pocketPlacementBiasIsNonzero(
  bias: { offsetXPercent?: number; offsetYPercent?: number } | null | undefined,
): boolean {
  if (!bias) return false;
  return (
    Math.abs(bias.offsetXPercent ?? 0) > 1e-9 ||
    Math.abs(bias.offsetYPercent ?? 0) > 1e-9
  );
}

/** Crop frontBb is the raw mask AABB; bake uses biased AABB + seam remap. */
export function templateHasNonzeroFrontBakeMismatchRisk(
  groups: DesignGroup[] | undefined,
  overrides?: Record<string, FrontBodyPanelPlacementBias | null | undefined>,
): boolean {
  for (const g of groups ?? []) {
    if ((g.seamAllowance ?? 0) > 1e-9) return true;
    const merged = mergeFrontBodyPanelPlacementBias(
      g.panelPlacementBias,
      overrides?.[g.id],
    );
    if (pocketPlacementBiasIsNonzero(merged.chest)) return true;
  }
  return false;
}

/** True when a front-body group (or override) stores a pocket UV nudge. */
export function templateHasNonzeroPocketPlacementBias(
  groups: DesignGroup[] | undefined,
  overrides?: Record<string, FrontBodyPanelPlacementBias | null | undefined>,
): boolean {
  for (const g of groups ?? []) {
    const merged = mergeFrontBodyPanelPlacementBias(
      g.panelPlacementBias,
      overrides?.[g.id],
    );
    if (pocketPlacementBiasIsNonzero(merged.pocket)) return true;
  }
  return false;
}

export function pocketOverlayRectOnFrontPanel(
  frontBb: MockupBbox,
  pocketBb: MockupBbox,
  frontCanvasW: number,
  frontCanvasH: number,
): PulloverPocketOverlayRect {
  if (frontBb.width <= 0 || frontBb.height <= 0) {
    return { x: 0, y: 0, width: frontCanvasW, height: frontCanvasH };
  }
  const scaleX = frontCanvasW / frontBb.width;
  const scaleY = frontCanvasH / frontBb.height;
  return {
    x: (pocketBb.x - frontBb.x) * scaleX,
    y: (pocketBb.y - frontBb.y) * scaleY,
    width: pocketBb.width * scaleX,
    height: pocketBb.height * scaleY,
  };
}
