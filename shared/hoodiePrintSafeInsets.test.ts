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
  it("returns per-panel pullover insets and skips zip / unknown keys", () => {
    const hood = printSafeInsetsForPanel("left_hood", PULOVER_HOODIE_BLUEPRINT_ID);
    const front = printSafeInsetsForPanel("front", PULOVER_HOODIE_BLUEPRINT_ID);
    const pocket = printSafeInsetsForPanel("front_pocket", PULOVER_HOODIE_BLUEPRINT_ID);
    expect(hood).toEqual({ left: 0.1316, right: 0.0714, top: 0.0371, bottom: 0.0525 });
    expect(front).toEqual({ left: 0.0681, right: 0.0681, top: 0.0227, bottom: 0.0212 });
    expect(printSafeInsetsForPanel("right_hood", PULOVER_HOODIE_BLUEPRINT_ID)?.left).toBe(
      0.0714,
    );
    expect(pocket).toEqual({
      left: PULLOVER_POCKET_FINISHED_INSET.left,
      right: PULLOVER_POCKET_FINISHED_INSET.right,
      top: PULLOVER_POCKET_FINISHED_INSET.top,
      bottom: PULLOVER_POCKET_FINISHED_INSET.bottom,
    });
    expect(printSafeInsetsForPanel("front", ZIP_HOODIE_BLUEPRINT_ID)).toBeNull();
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
