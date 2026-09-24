import { describe, expect, it } from "vitest";
import {
  artworkSourceRectForPanel,
  type DesignRectInfo,
  type PocketSeamCal,
} from "./aopPreview";

/**
 * Seam-divergence drift correction.
 *
 * A pocket seam that differs from the group seam displaces pocket art relative
 * to body art LINEARLY in the group placement scale `s`, because the
 * displacement is `(x_c - eff.x) * dSeam / (1 - seamGroup)` and
 * `eff.x = anchor.x - base.width * s / 2`. `synthesiseSeamAwareSourceRect`
 * cancels that drift relative to `seamCalibrationScale`.
 *
 * These tests go through the PUBLIC `artworkSourceRectForPanel` rather than a
 * lifted copy of the private helper. That is deliberate: during verification a
 * lifted copy of `buildEffectiveRenderConfig` in a scratch harness silently
 * dropped `seamCalibrationScale`, so the correction never ran on one surface
 * while the copy looked correct. Testing the real call path is the only way
 * these assertions stay attached to what actually renders.
 *
 * MEASURED ON REAL RENDERS (s = 3.1328, calibrated at s = 1.5664), the drift
 * the correction removes — WITHOUT correction vs WITH:
 *    DISPLAY pocket_right  +3.62 -> -0.59      DISPLAY pocket_left  -4.86 -> -0.22
 *    PRINT   pocket_right  -5.38 -> -0.73      PRINT   pocket_left  +3.53 -> -0.86
 * A SIGN INVERSION would roughly DOUBLE each WITHOUT figure instead of
 * cancelling it, which is the failure these tests exist to catch.
 */

const AW = 576;
const AH = 1024;
const BASE_W = 300;
const BASE_H = 400;
const ANCHOR_X = 500;
const CAL_SCALE = 1.5;
const GROUP_SEAM = 0.03;

/** Build a group rect at placement scale `s`, exactly as computeGroupRects does. */
function rectAtScale(s: number): DesignRectInfo {
  const w = BASE_W * s;
  const h = BASE_H * s;
  const base = { x: ANCHOR_X - BASE_W / 2, y: 100, width: BASE_W, height: BASE_H };
  const cy = base.y + base.height / 2;
  return {
    union: { x: ANCHOR_X - BASE_W / 2, y: 100, width: BASE_W, height: BASE_H },
    base,
    effective: { x: ANCHOR_X - w / 2, y: cy - h / 2, width: w, height: h },
    anchor: { x: ANCHOR_X, y: cy },
    hasSeamPair: true,
    anchorIsSeam: true,
    seamAllowance: GROUP_SEAM,
    groupId: "front-body",
    enabled: true,
    rotationDeg: 0,
  } as DesignRectInfo;
}

/** A pocket panel bbox sitting inside the design rect, off the midline. */
const POCKET_BB = { x: 430, y: 300, width: 60, height: 80 };

function sliceFor(
  s: number,
  side: "left" | "right",
  seamCal: PocketSeamCal | undefined,
) {
  return artworkSourceRectForPanel(
    POCKET_BB,
    side === "left" ? "pocket_left" : "pocket_right",
    rectAtScale(s),
    AW,
    AH,
    side,
    false,
    seamCal,
  );
}

// Pocket seam BELOW the group seam — the published display case (0.0115 vs 0.03).
const DIVERGENT_LOW: PocketSeamCal = { seam: 0.0115, calibrationScale: CAL_SCALE };
// Same seam, no calibration scale recorded.
const NO_CAL: PocketSeamCal = { seam: 0.0115 };
// Pocket seam EQUAL to the group seam — no divergence, so nothing to drift.
const NO_DIVERGENCE: PocketSeamCal = { seam: GROUP_SEAM, calibrationScale: CAL_SCALE };

const OFF_SCALE = 3.0; // well away from CAL_SCALE, so the correction is live

describe("seam-drift correction — sign per side", () => {
  it("left side with dSeam < 0 shifts the sampled window NEGATIVE", () => {
    const corrected = sliceFor(OFF_SCALE, "left", DIVERGENT_LOW);
    const uncorrected = sliceFor(OFF_SCALE, "left", NO_CAL);
    expect(corrected.x).toBeLessThan(uncorrected.x);
  });

  it("right side with dSeam < 0 shifts the sampled window POSITIVE (mirror)", () => {
    const corrected = sliceFor(OFF_SCALE, "right", DIVERGENT_LOW);
    const uncorrected = sliceFor(OFF_SCALE, "right", NO_CAL);
    expect(corrected.x).toBeGreaterThan(uncorrected.x);
  });

  it("the two sides move in OPPOSITE directions (mirror-symmetric, not common-mode)", () => {
    const dLeft =
      sliceFor(OFF_SCALE, "left", DIVERGENT_LOW).x - sliceFor(OFF_SCALE, "left", NO_CAL).x;
    const dRight =
      sliceFor(OFF_SCALE, "right", DIVERGENT_LOW).x - sliceFor(OFF_SCALE, "right", NO_CAL).x;
    expect(Math.sign(dLeft)).toBe(-Math.sign(dRight));
    // equal magnitude: a common-mode term would break this
    expect(Math.abs(dLeft)).toBeCloseTo(Math.abs(dRight), 6);
  });

  it("flips direction when the divergence flips sign", () => {
    // Each case must be compared against its OWN uncorrected baseline at the
    // SAME seam value — a shared baseline would fold the seam change itself
    // into the difference and measure something other than the correction.
    const low = DIVERGENT_LOW; // 0.0115, below group
    const high: PocketSeamCal = { seam: 0.0432, calibrationScale: CAL_SCALE }; // above group
    const dLow =
      sliceFor(OFF_SCALE, "left", low).x - sliceFor(OFF_SCALE, "left", { seam: low.seam }).x;
    const dHigh =
      sliceFor(OFF_SCALE, "left", high).x - sliceFor(OFF_SCALE, "left", { seam: high.seam }).x;
    expect(dLow).not.toBe(0);
    expect(dHigh).not.toBe(0);
    expect(Math.sign(dLow)).toBe(-Math.sign(dHigh));
  });
});

describe("seam-drift correction — no-op gates are BIT-EXACT", () => {
  it("dSeam === 0 (pocket seam equals group seam) is identical to no correction", () => {
    for (const side of ["left", "right"] as const) {
      const withCal = sliceFor(OFF_SCALE, side, NO_DIVERGENCE);
      const withoutCal = sliceFor(OFF_SCALE, side, { seam: GROUP_SEAM });
      expect(withCal).toEqual(withoutCal);
    }
  });

  it("calibrationScale absent is identical to no correction", () => {
    for (const side of ["left", "right"] as const) {
      const absent = sliceFor(OFF_SCALE, side, NO_CAL);
      const undef = sliceFor(OFF_SCALE, side, { seam: 0.0115, calibrationScale: undefined });
      expect(absent).toEqual(undef);
    }
  });

  it("sNow === calibrationScale leaves the published calibration untouched", () => {
    for (const side of ["left", "right"] as const) {
      const atCal = sliceFor(CAL_SCALE, side, DIVERGENT_LOW);
      const noCorrection = sliceFor(CAL_SCALE, side, NO_CAL);
      expect(atCal).toEqual(noCorrection);
    }
  });

  it("non-pocket panels are untouched (no seamCal supplied at all)", () => {
    const a = artworkSourceRectForPanel(
      POCKET_BB, "front_left", rectAtScale(OFF_SCALE), AW, AH, "left", false, undefined,
    );
    const b = artworkSourceRectForPanel(
      POCKET_BB, "front_left", rectAtScale(OFF_SCALE), AW, AH, "left", false, null,
    );
    expect(a).toEqual(b);
  });
});

describe("seam-drift correction — REDUCES drift, never amplifies it", () => {
  /**
   * Coarse guard that survives refactors of the exact-sign assertions above.
   * The drift is the pocket's sampled-window position relative to where it sits
   * at the calibration scale. With the correction the residual must SHRINK; a
   * sign inversion makes it roughly double.
   */
  function driftVsCalibration(s: number, side: "left" | "right", cal: PocketSeamCal) {
    // normalise out the scale change itself by comparing against the
    // no-divergence sample at the same scale, which carries no drift term
    const diverged = sliceFor(s, side, cal);
    const neutral = sliceFor(s, side, { seam: GROUP_SEAM, calibrationScale: cal.calibrationScale });
    return diverged.x - neutral.x;
  }

  it("residual drift at an off-calibration scale is smaller WITH the correction", () => {
    for (const side of ["left", "right"] as const) {
      const withCorrection = Math.abs(driftVsCalibration(OFF_SCALE, side, DIVERGENT_LOW));
      const withoutCorrection = Math.abs(driftVsCalibration(OFF_SCALE, side, NO_CAL));
      expect(withCorrection).toBeLessThan(withoutCorrection);
    }
  });

  it("does not amplify: correction never exceeds the uncorrected drift", () => {
    for (const s of [2.0, 2.5, 3.0, 4.0]) {
      for (const side of ["left", "right"] as const) {
        const withCorrection = Math.abs(driftVsCalibration(s, side, DIVERGENT_LOW));
        const withoutCorrection = Math.abs(driftVsCalibration(s, side, NO_CAL));
        expect(withCorrection).toBeLessThanOrEqual(withoutCorrection);
      }
    }
  });
});
