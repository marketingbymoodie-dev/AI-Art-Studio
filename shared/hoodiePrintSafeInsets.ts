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
 */
const PULLOVER_PRINT_SAFE_INSETS: Partial<Record<HoodiePanelKey, PrintSafeInsets>> = {
  left_hood: { left: 0.1316, right: 0.0714, top: 0.0371, bottom: 0.0525 },
  right_hood: { left: 0.0714, right: 0.1316, top: 0.0375, bottom: 0.0525 },
  front: { left: 0.0681, right: 0.0681, top: 0.0227, bottom: 0.0212 },
  back: { left: 0.0661, right: 0.0661, top: 0.0222, bottom: 0.0212 },
  left_sleeve: { left: 0.0782, right: 0.0782, top: 0.0238, bottom: 0.0232 },
  right_sleeve: { left: 0.0782, right: 0.0782, top: 0.024, bottom: 0.0232 },
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
