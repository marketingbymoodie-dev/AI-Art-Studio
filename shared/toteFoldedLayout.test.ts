import { describe, expect, it } from "vitest";
import {
  composeToteFoldedCanvas,
  normalizeToteFoldedPanelDims,
  toteFoldedArtBox,
  TOTE_FOLDED_CANVAS_HEIGHT,
  TOTE_FOLDED_CANVAS_WIDTH,
  TOTE_FOLDED_PANEL_HEIGHT,
  TOTE_FOLDED_PANEL_WIDTH,
} from "./toteFoldedLayout";
import {
  ADJUSTABLE_TOTE_BLUEPRINT_ID,
  resolveFulfillmentLayout,
  resolveStorefrontMockupMode,
  shouldAllowFlatHarvest,
  shouldForceFlatTierDespiteProbe,
  usesAopStorefrontCustomizer,
  usesToteFoldedFulfillment,
} from "./productLayoutPolicy";

describe("composeToteFoldedCanvas", () => {
  it("outputs 2650×5250 with distinct top/bottom panels", () => {
    const w = 100;
    const h = 50;
    const pixels = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        pixels[i] = x >= w / 2 ? 255 : 0;
        pixels[i + 1] = 0;
        pixels[i + 2] = 0;
        pixels[i + 3] = 255;
      }
    }

    const out = composeToteFoldedCanvas({ sourceWidth: w, sourceHeight: h, pixels });
    expect(out.width).toBe(TOTE_FOLDED_CANVAS_WIDTH);
    expect(out.height).toBe(TOTE_FOLDED_CANVAS_HEIGHT);

    const cx = Math.floor(TOTE_FOLDED_PANEL_WIDTH / 2);
    const topRow = Math.floor(TOTE_FOLDED_PANEL_HEIGHT / 2);
    const bottomRow = TOTE_FOLDED_PANEL_HEIGHT + Math.floor(TOTE_FOLDED_PANEL_HEIGHT / 2);
    const topIdx = (topRow * TOTE_FOLDED_CANVAS_WIDTH + cx) * 4;
    const bottomIdx = (bottomRow * TOTE_FOLDED_CANVAS_WIDTH + cx) * 4;
    expect(out.pixels[topIdx]).toBe(255);
    expect(out.pixels[bottomIdx]).toBe(0);
  });

  it("cover-fits tall art so scale 0.6 fills the face like the app placer", () => {
    // Saved tote art is often 1:2 (folded-canvas targetDims) on a ~1:1 face.
    // Contain at 0.6 → 60% of face height; cover at 0.6 still overflows the face
    // (matches flatArtBox on the visible bag).
    const box = toteFoldedArtBox(512, 1024, { scale: 0.6, offsetX: 0, offsetY: 0 });
    const containH = Math.round(1024 * Math.min(TOTE_FOLDED_PANEL_WIDTH / 512, TOTE_FOLDED_PANEL_HEIGHT / 1024) * 0.6);
    expect(box.drawH).toBeGreaterThan(containH);
    expect(box.drawH).toBeGreaterThan(TOTE_FOLDED_PANEL_HEIGHT);
    expect(box.top).toBeLessThan(0);
    expect(box.top + box.drawH).toBeGreaterThan(TOTE_FOLDED_PANEL_HEIGHT);
  });

  it("uses full-face offset fractions (same as flatArtBox)", () => {
    const centered = toteFoldedArtBox(100, 100, { scale: 1, offsetX: 0, offsetY: 0 });
    const shifted = toteFoldedArtBox(100, 100, { scale: 1, offsetX: 0.1, offsetY: 0 });
    expect(shifted.left - centered.left).toBe(Math.round(TOTE_FOLDED_PANEL_WIDTH * 0.1));
  });
});

describe("productLayoutPolicy", () => {
  it("defaults adjustable tote to flat mockups + folded fulfillment", () => {
    const product = {
      isAllOverPrint: true,
      printifyBlueprintId: ADJUSTABLE_TOTE_BLUEPRINT_ID,
    };
    expect(resolveFulfillmentLayout(product)).toBe("tote_folded_v1");
    expect(resolveStorefrontMockupMode(product)).toBe("flat");
    expect(usesToteFoldedFulfillment(product)).toBe(true);
    expect(usesAopStorefrontCustomizer(product)).toBe(false);
  });

  it("does not let a leftover mesh template steal the folded tote editor", () => {
    const product = {
      isAllOverPrint: true,
      printifyBlueprintId: ADJUSTABLE_TOTE_BLUEPRINT_ID,
      panelMappingTemplate: "unisex-zip-hoodie-aop-L",
    };
    expect(resolveStorefrontMockupMode(product)).toBe("flat");
    expect(usesAopStorefrontCustomizer(product)).toBe(false);
  });

  it("respects explicit storefront override to AOP", () => {
    expect(
      usesAopStorefrontCustomizer({
        isAllOverPrint: true,
        printifyBlueprintId: ADJUSTABLE_TOTE_BLUEPRINT_ID,
        storefrontMockupMode: "aop",
      }),
    ).toBe(true);
  });

  it("allows flat harvest for adjustable tote without explicit force flag", () => {
    expect(
      shouldAllowFlatHarvest({
        name: "Adjustable Tote Bag (AOP)",
        blueprintId: ADJUSTABLE_TOTE_BLUEPRINT_ID,
        isAllOverPrint: true,
      }),
    ).toBe(true);
    expect(
      shouldForceFlatTierDespiteProbe({
        printifyBlueprintId: ADJUSTABLE_TOTE_BLUEPRINT_ID,
      }),
    ).toBe(true);
  });

  it("normalizes full folded canvas to panel dims", () => {
    expect(normalizeToteFoldedPanelDims(2650, 5250)).toEqual({ width: 2650, height: 2625 });
    expect(normalizeToteFoldedPanelDims(2650, 2625)).toEqual({ width: 2650, height: 2625 });
  });
});
