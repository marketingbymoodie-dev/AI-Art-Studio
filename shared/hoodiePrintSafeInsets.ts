import {
  isPulloverHoodieBlueprint,
  isZipHoodieBlueprint,
  type HoodiePanelKey,
} from "./hoodieTemplate";
import { PULLOVER_POCKET_FINISHED_INSET } from "./pulloverPocketPrintMerge";

/** Axis-aligned Safe rect as fractions of the Printify Print placeholder. */
export type PrintSafeInsets = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type PrintSafeDestRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Pullover bp 450 — Safe AABB vs Print placeholder (catalog SVG, 2026-09).
 * Dest-only. Do not reuse as source bleed or pocket sample inset.
 * Pocket numbers match `PULLOVER_POCKET_FINISHED_INSET` (top is 0 so the
 * stitch-line mural is captured). Dest applies them here, source in
 * `applyFinishedPocketSampleToBbox` — not twice on dest.
 *
 * BODY PANELS ARE FULL-BLEED (2026-09). `front`, `back`, both hoods and both
 * sleeves used to carry a Safe-rect dest inset, which mapped their art into a
 * sub-rect of the placeholder and left the margin as flat background — i.e.
 * UNPRINTED FABRIC at the shoulders, front-panel sides and back of the hood on
 * the real garment. Measured on a bake: `front` reached only 86% of the
 * placeholder width (art x 186..2576 of 2768, matching the 6.81% inset almost
 * exactly) against the zip's 100%. The zip removed its equivalent table in
 * `fe7bb5e1` ("placeholders stay full-bleed"); this brings the pullover's body
 * panels into line. An AOP garment wants bleed past the visible outline, not a
 * safe margin inside it.
 *
 * `front_pocket` DELIBERATELY KEEPS its entry. Its dest inset is paired with
 * the matching SOURCE inset in `applyFinishedPocketSampleToBbox` — source
 * samples the finished sewn region, dest maps it into the finished region of
 * the placeholder. Removing only the dest half would leave a source/dest
 * mismatch and move pocket art vertically. Do not "tidy" this entry away to
 * make the table look uniform.
 */
const PULLOVER_PRINT_SAFE_INSETS: Partial<Record<HoodiePanelKey, PrintSafeInsets>> = {
  front_pocket: {
    left: PULLOVER_POCKET_FINISHED_INSET.left,
    right: PULLOVER_POCKET_FINISHED_INSET.right,
    top: PULLOVER_POCKET_FINISHED_INSET.top,
    bottom: PULLOVER_POCKET_FINISHED_INSET.bottom,
  },
};

export function printSafeInsetsForPanel(
  panelKey: HoodiePanelKey | null | undefined,
  blueprintId?: number | null,
): PrintSafeInsets | null {
  if (!isPulloverHoodieBlueprint(blueprintId) || !panelKey) return null;
  return PULLOVER_PRINT_SAFE_INSETS[panelKey] ?? null;
}

/** Pixel Safe rect inside a placeholder-sized canvas. */
export function printSafeDestRect(
  flatW: number,
  flatH: number,
  insets: PrintSafeInsets,
): PrintSafeDestRect {
  const x = Math.round(insets.left * flatW);
  const y = Math.round(insets.top * flatH);
  const right = Math.round(insets.right * flatW);
  const bottom = Math.round(insets.bottom * flatH);
  return {
    x,
    y,
    width: Math.max(1, flatW - x - right),
    height: Math.max(1, flatH - y - bottom),
  };
}

/**
 * Print panels drawn at the artwork's TRUE aspect, and which edge of the art
 * slice stays fixed while its width is reshaped to the destination aspect.
 * Every other panel still stretches its sample window to fill the placeholder
 * per axis (x and y scaled independently), which printed body panels ~15-30%
 * wide against Printify's placeholders.
 *
 * Zip front halves and pockets anchor on their ZIPPER edge, so the window only
 * grows outward toward the side seam — widening about the centre (or from the
 * wrong edge) pulls art from across the zipper and prints it on both halves.
 * The mockup is a front view, so the wearer's-left pieces (front_left,
 * pocket_left) hold the design's RIGHT half: their zipper is the slice's
 * min-x edge; the right pieces' zipper is their max-x edge.
 */
export type TrueAspectAnchor = "center" | "min" | "max";

const PULLOVER_TRUE_ASPECT_PRINT_ANCHORS: Partial<Record<HoodiePanelKey, TrueAspectAnchor>> = {
  front: "center",
  back: "center",
  front_pocket: "center",
};

const ZIP_TRUE_ASPECT_PRINT_ANCHORS: Partial<Record<HoodiePanelKey, TrueAspectAnchor>> = {
  back: "center",
  front_left: "min",
  pocket_left: "min",
  front_right: "max",
  pocket_right: "max",
};

export function printTrueAspectAnchor(
  panelKey: HoodiePanelKey | null | undefined,
  blueprintId?: number | null,
): TrueAspectAnchor | null {
  if (!panelKey) return null;
  if (isPulloverHoodieBlueprint(blueprintId)) {
    return PULLOVER_TRUE_ASPECT_PRINT_ANCHORS[panelKey] ?? null;
  }
  if (isZipHoodieBlueprint(blueprintId)) {
    return ZIP_TRUE_ASPECT_PRINT_ANCHORS[panelKey] ?? null;
  }
  return null;
}

export function printDrawsAtTrueAspect(
  panelKey: HoodiePanelKey | null | undefined,
  blueprintId?: number | null,
): boolean {
  return printTrueAspectAnchor(panelKey, blueprintId) != null;
}

/**
 * Reshape an artwork sample window to the destination's aspect so the
 * slice → dest map is one uniform scale (dest.height / slice.height) on both
 * axes. Height and y are kept, so vertical placement is unchanged; the window
 * widens (or narrows) horizontally about its centre, or away from a fixed
 * min/max edge. Anything it reaches past the artwork's edges draws
 * transparent — blank stays blank.
 */
export function sliceAtDestAspect<T extends { x: number; y: number; width: number; height: number }>(
  slice: T,
  destAspect: number,
  anchor: TrueAspectAnchor = "center",
): T {
  if (!(destAspect > 0) || !(slice.height > 0)) return slice;
  const width = slice.height * destAspect;
  const x =
    anchor === "min"
      ? slice.x
      : anchor === "max"
        ? slice.x + slice.width - width
        : slice.x + slice.width / 2 - width / 2;
  return { ...slice, x, width };
}
