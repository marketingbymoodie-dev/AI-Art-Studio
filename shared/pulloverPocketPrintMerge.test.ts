import { describe, expect, it } from "vitest";
import {
  expandHoodPanelImageIdsWithSiblingFallback,
  expandPanelImageIdsWithCollarAliases,
  expandPanelImageIdsWithPocketAliases,
  isDegeneratePocketPrintDims,
  isPocketLikePrintifyPosition,
  buildPocketWindowOnFrontCanvas,
  canvasSpacePocketCoverSize,
  computeZipPocketSeamPinX,
  intersectRectWithCanvas,
  mapMockupPointToFrontCanvas,
  pocketOverlayRectOnFrontPanel,
  pocketPlacementBiasIsNonzero,
  pocketPrintHostPanelKey,
  templateHasNonzeroFrontBakeMismatchRisk,
  templateHasNonzeroPocketPlacementBias,
  zipPocketSeamSide,
  resolvePocketFallbackImageId,
  resolvePrintifyPanelImageId,
  shouldExportPulloverPocketAsPrintifyPanel,
  shouldMergePulloverPocketForPrintify,
} from "./pulloverPocketPrintMerge";
import { PULOVER_HOODIE_BLUEPRINT_ID } from "./hoodieTemplate";

describe("shouldExportPulloverPocketAsPrintifyPanel", () => {
  it("exports for pullover when pockets are on", () => {
    expect(shouldExportPulloverPocketAsPrintifyPanel(PULOVER_HOODIE_BLUEPRINT_ID, true)).toBe(
      true,
    );
  });

  it("exports when blueprint id is missing but hoodie type is pullover", () => {
    expect(
      shouldExportPulloverPocketAsPrintifyPanel(undefined, true, "pullover-hoodie-aop"),
    ).toBe(true);
  });

  it("skips for zip hoodie or pockets off", () => {
    expect(shouldExportPulloverPocketAsPrintifyPanel(451, true)).toBe(false);
    expect(shouldExportPulloverPocketAsPrintifyPanel(PULOVER_HOODIE_BLUEPRINT_ID, false)).toBe(
      false,
    );
  });

  it("keeps deprecated alias in sync", () => {
    expect(shouldMergePulloverPocketForPrintify(PULOVER_HOODIE_BLUEPRINT_ID, true)).toBe(true);
  });
});

describe("resolvePrintifyPanelImageId", () => {
  it("matches exact position", () => {
    const ids = new Map([["front_pocket", "img-1"]]);
    expect(resolvePrintifyPanelImageId("front_pocket", ids)).toBe("img-1");
  });

  it("matches pocket alias when Printify uses pocket and client uploads front_pocket", () => {
    const ids = new Map([["front_pocket", "img-pocket"]]);
    expect(resolvePrintifyPanelImageId("pocket", ids)).toBe("img-pocket");
  });

  it("fuzzy-matches any pocket-like upload to any pocket-like placeholder", () => {
    const ids = new Map([["outer_pocket", "img-x"]]);
    expect(resolvePrintifyPanelImageId("pocket", ids)).toBe("img-x");
  });

  it("matches bp 449 title-case Collar to lowercase collar upload", () => {
    const ids = new Map([["collar", "img-collar"]]);
    expect(resolvePrintifyPanelImageId("Collar", ids)).toBe("img-collar");
  });
});

describe("expandPanelImageIdsWithCollarAliases", () => {
  it("registers collar under both Collar and collar", () => {
    const ids = new Map([["collar", "img-c"]]);
    expandPanelImageIdsWithCollarAliases(ids);
    expect(ids.get("Collar")).toBe("img-c");
    expect(ids.get("collar")).toBe("img-c");
  });
});

describe("resolvePocketFallbackImageId", () => {
  it("prefers front then split front halves", () => {
    expect(resolvePocketFallbackImageId(new Map([["front", "f"]]))).toBe("f");
    expect(
      resolvePocketFallbackImageId(new Map([["front_left", "fl"], ["back", "b"]])),
    ).toBe("fl");
  });
});

describe("expandHoodPanelImageIdsWithSiblingFallback", () => {
  it("fills missing left_hood from right_hood", () => {
    const ids = new Map([["right_hood", "img-r"]]);
    expandHoodPanelImageIdsWithSiblingFallback(ids);
    expect(ids.get("left_hood")).toBe("img-r");
  });

  it("fills missing right_hood from left_hood", () => {
    const ids = new Map([["left_hood", "img-l"]]);
    expandHoodPanelImageIdsWithSiblingFallback(ids);
    expect(ids.get("right_hood")).toBe("img-l");
  });
});

describe("expandPanelImageIdsWithPocketAliases", () => {
  it("registers front_pocket upload under pocket aliases", () => {
    const ids = new Map([["front_pocket", "img-pocket"], ["front", "img-front"]]);
    expandPanelImageIdsWithPocketAliases(ids);
    expect(ids.get("pocket")).toBe("img-pocket");
    expect(ids.get("kangaroo_pocket")).toBe("img-pocket");
    expect(ids.get("front")).toBe("img-front");
  });
});

describe("isPocketLikePrintifyPosition", () => {
  it("detects pocket-related placeholder names", () => {
    expect(isPocketLikePrintifyPosition("front_pocket")).toBe(true);
    expect(isPocketLikePrintifyPosition("pocket")).toBe(true);
    expect(isPocketLikePrintifyPosition("left_sleeve")).toBe(false);
  });
});

describe("pocketOverlayRectOnFrontPanel", () => {
  it("maps pocket bbox into front canvas space", () => {
    const frontBb = { x: 100, y: 50, width: 400, height: 500 };
    const pocketBb = { x: 200, y: 400, width: 200, height: 120 };
    const dest = pocketOverlayRectOnFrontPanel(frontBb, pocketBb, 800, 1000);
    expect(dest.x).toBeCloseTo(200);
    expect(dest.y).toBeCloseTo(700);
    expect(dest.width).toBeCloseTo(400);
    expect(dest.height).toBeCloseTo(240);
  });
});

describe("buildPocketWindowOnFrontCanvas", () => {
  const frontBb = { x: 100, y: 50, width: 400, height: 500 };
  const pocketBb = { x: 200, y: 400, width: 150, height: 100 };

  it("locks canvas-space aspect to the resolved pocket dims (not a hardcoded zip ratio)", () => {
    const aspect = 1375 / 1430;
    const win = buildPocketWindowOnFrontCanvas({
      frontMaskBb: frontBb,
      pocketMaskBb: pocketBb,
      frontCanvasW: 800,
      frontCanvasH: 1000,
      pocketAspect: aspect,
    });
    expect(win).not.toBeNull();
    expect(win!.width / win!.height).toBeCloseTo(aspect, 5);
    const pulloverAspect = 4200 / 2550;
    const pullover = buildPocketWindowOnFrontCanvas({
      frontMaskBb: frontBb,
      pocketMaskBb: pocketBb,
      frontCanvasW: 800,
      frontCanvasH: 1000,
      pocketAspect: pulloverAspect,
    });
    expect(pullover!.width / pullover!.height).toBeCloseTo(pulloverAspect, 5);
  });

  it("does not let the anisotropic map set width and height independently", () => {
    const aspect = 1375 / 1430;
    const win = buildPocketWindowOnFrontCanvas({
      frontMaskBb: { x: 513.23, y: 310.15, width: 206.37, height: 517.79 },
      pocketMaskBb: { x: 513.59, y: 635.3, width: 150.27, height: 187.85 },
      frontCanvasW: 1622,
      frontCanvasH: 3200,
      pocketAspect: aspect,
    });
    expect(win).not.toBeNull();
    expect(win!.width / win!.height).toBeCloseTo(aspect, 5);
    expect(win!.width / win!.height).not.toBeCloseTo(aspect * (1622 / 206.37) / (3200 / 517.79), 2);
  });

  it("centers on the mapped pocket center and applies scale / canvas offsets", () => {
    const aspect = 2;
    const base = buildPocketWindowOnFrontCanvas({
      frontMaskBb: frontBb,
      pocketMaskBb: pocketBb,
      frontCanvasW: 800,
      frontCanvasH: 1000,
      pocketAspect: aspect,
      scale: 1,
    });
    const zoomed = buildPocketWindowOnFrontCanvas({
      frontMaskBb: frontBb,
      pocketMaskBb: pocketBb,
      frontCanvasW: 800,
      frontCanvasH: 1000,
      pocketAspect: aspect,
      scale: 1.25,
    });
    expect(zoomed!.width).toBeCloseTo(base!.width * 1.25);
    expect(zoomed!.height).toBeCloseTo(base!.height * 1.25);
    expect(zoomed!.x + zoomed!.width / 2).toBeCloseTo(base!.x + base!.width / 2);
    expect(zoomed!.y + zoomed!.height / 2).toBeCloseTo(base!.y + base!.height / 2);
    const center = mapMockupPointToFrontCanvas(
      frontBb,
      { x: pocketBb.x + pocketBb.width / 2, y: pocketBb.y + pocketBb.height / 2 },
      800,
      1000,
    );
    expect(base!.x + base!.width / 2).toBeCloseTo(center!.x);
    expect(base!.y + base!.height / 2).toBeCloseTo(center!.y);
    const nudged = buildPocketWindowOnFrontCanvas({
      frontMaskBb: frontBb,
      pocketMaskBb: pocketBb,
      frontCanvasW: 800,
      frontCanvasH: 1000,
      pocketAspect: aspect,
      scale: 1,
      offsetX: 12,
      offsetY: -8,
    });
    expect(nudged!.x).toBeCloseTo(base!.x + 12);
    expect(nudged!.y).toBeCloseTo(base!.y - 8);
  });

  it("returns null for degenerate aspect instead of inventing a fallback", () => {
    expect(
      buildPocketWindowOnFrontCanvas({
        frontMaskBb: frontBb,
        pocketMaskBb: pocketBb,
        frontCanvasW: 800,
        frontCanvasH: 1000,
        pocketAspect: 0,
      }),
    ).toBeNull();
    expect(isDegeneratePocketPrintDims(null)).toBe(true);
    expect(isDegeneratePocketPrintDims({ width: 1375, height: 0 })).toBe(true);
    expect(isDegeneratePocketPrintDims({ width: 1375, height: 1430 })).toBe(false);
    expect(canvasSpacePocketCoverSize(100, 100, 0)).toBeNull();
  });

  it("maps zip/pullover pocket keys to the host front bake", () => {
    expect(pocketPrintHostPanelKey("pocket_left")).toBe("front_left");
    expect(pocketPrintHostPanelKey("pocket_right")).toBe("front_right");
    expect(pocketPrintHostPanelKey("front_pocket")).toBe("front");
    expect(pocketPrintHostPanelKey("back")).toBeNull();
  });

  it("pins zip inner edges to the canvas-mapped zip line, then stays on the host canvas", () => {
    const pocketLeft = { x: 513.59, y: 635.3, width: 150.27, height: 187.85 };
    const pocketRight = { x: 348.21, y: 635.69, width: 154.99, height: 187.64 };
    const pinX = computeZipPocketSeamPinX(pocketLeft, pocketRight);
    expect(pinX).toBeCloseTo((513.59 + 348.21 + 154.99) / 2, 5);
    expect(zipPocketSeamSide("pocket_left")).toBe("left");
    expect(zipPocketSeamSide("pocket_right")).toBe("right");
    expect(zipPocketSeamSide("front_pocket")).toBeNull();

    const frontLeft = { x: 513.23, y: 310.15, width: 206.37, height: 517.79 };
    const frontRight = { x: 292.86, y: 311.12, width: 210.54, height: 516.78 };
    const aspect = 1375 / 1430;
    const leftWin = buildPocketWindowOnFrontCanvas({
      frontMaskBb: frontLeft,
      pocketMaskBb: pocketLeft,
      frontCanvasW: 1622,
      frontCanvasH: 3200,
      pocketAspect: aspect,
      seamSide: "left",
      seamPinX: pinX,
    });
    const rightWin = buildPocketWindowOnFrontCanvas({
      frontMaskBb: frontRight,
      pocketMaskBb: pocketRight,
      frontCanvasW: 1622,
      frontCanvasH: 3200,
      pocketAspect: aspect,
      seamSide: "right",
      seamPinX: pinX,
    });
    expect(leftWin).not.toBeNull();
    expect(rightWin).not.toBeNull();
    expect(leftWin!.width / leftWin!.height).toBeCloseTo(aspect, 5);
    expect(rightWin!.width / rightWin!.height).toBeCloseTo(aspect, 5);
    expect(leftWin!.x).toBeGreaterThanOrEqual(-1e-6);
    expect(leftWin!.x + leftWin!.width).toBeLessThanOrEqual(1622 + 1e-6);
    expect(rightWin!.x).toBeGreaterThanOrEqual(-1e-6);
    expect(rightWin!.x + rightWin!.width).toBeLessThanOrEqual(1622 + 1e-6);
    const leftPin = mapMockupPointToFrontCanvas(
      frontLeft,
      { x: pinX!, y: pocketLeft.y },
      1622,
      3200,
    );
    expect(leftPin!.x).toBeLessThan(0);
    expect(leftWin!.x).toBeCloseTo(0, 5);
  });

  it("returns null when the mapped window misses the host canvas", () => {
    expect(
      buildPocketWindowOnFrontCanvas({
        frontMaskBb: { x: 100, y: 50, width: 400, height: 500 },
        pocketMaskBb: { x: 200, y: 400, width: 150, height: 100 },
        frontCanvasW: 800,
        frontCanvasH: 1000,
        pocketAspect: 2,
        offsetX: 5000,
      }),
    ).toBeNull();
    expect(intersectRectWithCanvas({ x: -10, y: 0, width: 5, height: 10 }, 100, 100)).toBeNull();
    expect(intersectRectWithCanvas({ x: -10, y: 0, width: 40, height: 10 }, 100, 100)).toEqual({
      x: 0,
      y: 0,
      width: 30,
      height: 10,
    });
  });

  it("detects chest bias / seamAllowance bake-mismatch risk", () => {
    expect(
      templateHasNonzeroFrontBakeMismatchRisk([
        {
          id: "front-body",
          name: "Front body",
          panelKeys: ["front"],
          placement: {
            front: { scale: 1, offsetX: 0, offsetY: 0 },
            back: { scale: 1, offsetX: 0, offsetY: 0 },
          },
          seamAllowance: 0,
          lockedRatio: null,
          enabled: true,
        },
      ]),
    ).toBe(false);
    expect(
      templateHasNonzeroFrontBakeMismatchRisk([
        {
          id: "front-body",
          name: "Front body",
          panelKeys: ["front"],
          placement: {
            front: { scale: 1, offsetX: 0, offsetY: 0 },
            back: { scale: 1, offsetX: 0, offsetY: 0 },
          },
          seamAllowance: 0.02,
          lockedRatio: null,
          enabled: true,
        },
      ]),
    ).toBe(true);
    expect(
      templateHasNonzeroFrontBakeMismatchRisk([
        {
          id: "front-body",
          name: "Front body",
          panelKeys: ["front_left", "front_right"],
          placement: {
            front: { scale: 1, offsetX: 0, offsetY: 0 },
            back: { scale: 1, offsetX: 0, offsetY: 0 },
          },
          seamAllowance: 0,
          lockedRatio: null,
          enabled: true,
          panelPlacementBias: { chest: { offsetXPercent: 1, offsetYPercent: 0 } },
        },
      ]),
    ).toBe(true);
  });

  it("detects nonzero pocket placement bias", () => {
    expect(pocketPlacementBiasIsNonzero({ offsetXPercent: 0, offsetYPercent: 0 })).toBe(false);
    expect(pocketPlacementBiasIsNonzero({ offsetXPercent: 0, offsetYPercent: 1 })).toBe(true);
    expect(
      templateHasNonzeroPocketPlacementBias([
        {
          id: "front-body",
          name: "Front body",
          panelKeys: ["front"],
          placement: {
            front: { scale: 1, offsetX: 0, offsetY: 0 },
            back: { scale: 1, offsetX: 0, offsetY: 0 },
          },
          seamAllowance: 0,
          lockedRatio: null,
          enabled: true,
          panelPlacementBias: { pocket: { offsetXPercent: 0, offsetYPercent: 2 } },
        },
      ]),
    ).toBe(true);
  });
});
