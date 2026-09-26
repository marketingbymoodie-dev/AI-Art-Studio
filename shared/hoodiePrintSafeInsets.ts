import {
  isPulloverHoodieBlueprint,
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
