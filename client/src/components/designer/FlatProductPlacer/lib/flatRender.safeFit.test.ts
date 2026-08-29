import { describe, expect, it } from "vitest";
import {
  flatArtBox,
  flatContainPlacementScale,
  flatFitPlacementToSafeArea,
  flatOverflows,
  flatShouldFitToSafeArea,
  FLAT_APPAREL_DEFAULT_SCALE,
} from "./flatRender";

const TALL_GUIDE = { x: 100, y: 50, width: 200, height: 400 };

describe("flatShouldFitToSafeArea", () => {
  it("fits apparel (non-bleed) bases", () => {
    expect(flatShouldFitToSafeArea({})).toBe(true);
  });

  it("skips full-bleed decor, edge-wrap, and tapestry weave", () => {
    expect(flatShouldFitToSafeArea({ decorMode: true })).toBe(false);
    expect(flatShouldFitToSafeArea({ edgeWrapMode: true })).toBe(false);
    expect(flatShouldFitToSafeArea({ fabricWeave: true })).toBe(false);
  });
});

describe("flatContainPlacementScale", () => {
  it("is 1 when artwork aspect matches the guide", () => {
    expect(flatContainPlacementScale(TALL_GUIDE, 100, 200)).toBeCloseTo(1, 5);
  });

  it("is contain/cover when a wide design sits on a tall guide", () => {
    // cover = max(200/400, 400/100) = 4; contain = min(0.5, 4) / 4 = 0.125
    expect(flatContainPlacementScale(TALL_GUIDE, 400, 100)).toBeCloseTo(0.125, 5);
  });

  it("never exceeds 1 (scale=1 is already cover)", () => {
    expect(flatContainPlacementScale(TALL_GUIDE, 200, 200)).toBeLessThanOrEqual(1);
  });
});

describe("flatFitPlacementToSafeArea", () => {
  it("scales a wide design down so the box stays inside the dashed guide", () => {
    const fitted = flatFitPlacementToSafeArea(TALL_GUIDE, 400, 100, {
      scale: FLAT_APPAREL_DEFAULT_SCALE,
      offsetX: 0.15,
      offsetY: -0.2,
    });
    expect(fitted.offsetX).toBe(0);
    expect(fitted.offsetY).toBe(0);
    expect(fitted.scale).toBeCloseTo(0.125, 5);
    const box = flatArtBox(TALL_GUIDE, fitted, 400, 100);
    expect(flatOverflows(TALL_GUIDE, box, 0.5)).toBe(false);
  });

  it("does not scale up art that is already smaller than the guide", () => {
    const fitted = flatFitPlacementToSafeArea(TALL_GUIDE, 100, 200, {
      scale: 0.4,
      offsetX: 0.3,
      offsetY: 0.1,
    });
    expect(fitted.scale).toBeCloseTo(0.4, 5);
    expect(fitted.offsetX).toBe(0);
    expect(fitted.offsetY).toBe(0);
  });

  it("keeps a matching-aspect 0.85 seed (already inside) and only recenters", () => {
    const fitted = flatFitPlacementToSafeArea(TALL_GUIDE, 100, 200, {
      scale: FLAT_APPAREL_DEFAULT_SCALE,
      offsetX: 0.2,
      offsetY: 0,
    });
    expect(fitted.scale).toBeCloseTo(FLAT_APPAREL_DEFAULT_SCALE, 5);
    expect(fitted.offsetX).toBe(0);
  });
});
