import { describe, expect, it } from "vitest";
import {
  PULOVER_HOODIE_BLUEPRINT_ID,
  ZIP_HOODIE_BLUEPRINT_ID,
} from "./hoodieTemplate";
import { PULLOVER_POCKET_FINISHED_INSET } from "./pulloverPocketPrintMerge";
import {
  printDrawsAtTrueAspect,
  printSafeDestRect,
  printSafeInsetsForPanel,
  sliceAtDestAspect,
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

describe("printDrawsAtTrueAspect", () => {
  it("pullover front, back and pocket only", () => {
    for (const k of ["front", "back", "front_pocket"] as const) {
      expect(printDrawsAtTrueAspect(k, PULOVER_HOODIE_BLUEPRINT_ID)).toBe(true);
    }
    for (const k of ["left_sleeve", "left_hood", "waistband"] as const) {
      expect(printDrawsAtTrueAspect(k, PULOVER_HOODIE_BLUEPRINT_ID)).toBe(false);
    }
    expect(printDrawsAtTrueAspect("front_left", ZIP_HOODIE_BLUEPRINT_ID)).toBe(false);
    expect(printDrawsAtTrueAspect("front", null)).toBe(false);
  });
});

describe("sliceAtDestAspect", () => {
  const slice = { x: 10, y: 300, width: 575, height: 774 };

  it("matches the dest aspect by width only: height, y and centre x kept", () => {
    const out = sliceAtDestAspect(slice, 3511 / 3557);
    expect(out.width / out.height).toBeCloseTo(3511 / 3557, 12);
    expect(out.height).toBe(slice.height);
    expect(out.y).toBe(slice.y);
    expect(out.x + out.width / 2).toBeCloseTo(slice.x + slice.width / 2, 12);
  });

  it("gives one uniform slice->dest scale on both axes", () => {
    const out = sliceAtDestAspect(slice, 3200 / 1597);
    expect(3200 / out.width).toBeCloseTo(1597 / out.height, 10);
  });

  it("is a no-op for degenerate input", () => {
    expect(sliceAtDestAspect(slice, 0)).toBe(slice);
    expect(sliceAtDestAspect({ ...slice, height: 0 }, 1)).toEqual({ ...slice, height: 0 });
  });
});
