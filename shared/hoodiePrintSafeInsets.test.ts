import { describe, expect, it } from "vitest";
import {
  PULOVER_HOODIE_BLUEPRINT_ID,
  ZIP_HOODIE_BLUEPRINT_ID,
} from "./hoodieTemplate";
import { PULLOVER_POCKET_FINISHED_INSET } from "./pulloverPocketPrintMerge";
import {
  printSafeDestRect,
  printSafeInsetsForPanel,
} from "./hoodiePrintSafeInsets";

describe("printSafeInsetsForPanel", () => {
  it("pullover BODY panels are full-bleed (no Safe-rect dest inset)", () => {
    // These six used to carry a Safe-rect inset, which mapped their art into a
    // sub-rect and left the margin as unprinted fabric on the garment
    // (shoulders, front-panel sides, back of hood). A null inset means dest is
    // null, so buildFlatMeshTargetPoints spans the whole placeholder.
    for (const panel of [
      "front", "back", "left_hood", "right_hood", "left_sleeve", "right_sleeve",
    ] as const) {
      expect(printSafeInsetsForPanel(panel, PULOVER_HOODIE_BLUEPRINT_ID)).toBeNull();
    }
  });

  it("pullover front_pocket KEEPS its inset — dest is paired with the source inset", () => {
    // applyFinishedPocketSampleToBbox applies the same inset on the SOURCE
    // side. Dropping only the dest half would leave a source/dest mismatch and
    // move pocket art vertically, so this entry must survive the body-panel
    // full-bleed change.
    expect(printSafeInsetsForPanel("front_pocket", PULOVER_HOODIE_BLUEPRINT_ID)).toEqual({
      left: PULLOVER_POCKET_FINISHED_INSET.left,
      right: PULLOVER_POCKET_FINISHED_INSET.right,
      top: PULLOVER_POCKET_FINISHED_INSET.top,
      bottom: PULLOVER_POCKET_FINISHED_INSET.bottom,
    });
  });

  it("skips zip and unknown keys", () => {
    expect(printSafeInsetsForPanel("front", ZIP_HOODIE_BLUEPRINT_ID)).toBeNull();
    expect(printSafeInsetsForPanel("front_left", ZIP_HOODIE_BLUEPRINT_ID)).toBeNull();
    expect(printSafeInsetsForPanel("pocket_left", ZIP_HOODIE_BLUEPRINT_ID)).toBeNull();
    expect(printSafeInsetsForPanel("front_pocket", ZIP_HOODIE_BLUEPRINT_ID)).toBeNull();
    expect(printSafeInsetsForPanel("waistband", PULOVER_HOODIE_BLUEPRINT_ID)).toBeNull();
  });

  it("rounds a Safe dest rect inside the placeholder", () => {
    const dest = printSafeDestRect(1000, 2000, {
      left: 0.1,
      right: 0.2,
      top: 0.05,
      bottom: 0.15,
    });
    expect(dest).toEqual({ x: 100, y: 100, width: 700, height: 1600 });
  });
});
