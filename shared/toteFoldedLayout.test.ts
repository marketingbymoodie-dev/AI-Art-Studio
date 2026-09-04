import { describe, expect, it } from "vitest";
import {
  composeToteFoldedCanvas,
  normalizeToteFoldedPanelDims,
  TOTE_FOLDED_CONTAIN_BOOST,
  TOTE_FOLDED_PRINT_CALIBRATION,
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

    // Sample inside the art box, well into the right (red) half — panel
    // centre can fall on the split after calibration rounding.
    const box = toteFoldedArtBox(w, h);
    const sampleX = box.left + Math.floor(box.drawW * 0.75);
    const sampleY = box.top + Math.floor(box.drawH * 0.5);
    const topIdx = (sampleY * TOTE_FOLDED_CANVAS_WIDTH + sampleX) * 4;
    const bottomIdx =
      ((TOTE_FOLDED_PANEL_HEIGHT + sampleY) * TOTE_FOLDED_CANVAS_WIDTH + sampleX) *
      4;
    expect(out.pixels[topIdx]).toBe(255);
    expect(out.pixels[bottomIdx]).toBe(0);
  });

  it("is 10% smaller than the 0.96 bake (does not cover the face)", () => {
    const box = toteFoldedArtBox(512, 1024, { scale: 0.6, offsetX: 0, offsetY: 0 });
    const containK = Math.min(TOTE_FOLDED_PANEL_WIDTH / 512, TOTE_FOLDED_PANEL_HEIGHT / 1024) * 0.6;
    const containH = Math.round(1024 * containK);
    const prior096H = Math.round(1024 * containK * 0.96);
    expect(box.drawH).toBe(
      Math.round(
        1024 *
          containK *
          TOTE_FOLDED_CONTAIN_BOOST *
          TOTE_FOLDED_PRINT_CALIBRATION,
      ),
    );
    expect(TOTE_FOLDED_CONTAIN_BOOST).toBeCloseTo(0.864, 5);
    expect(TOTE_FOLDED_PRINT_CALIBRATION).toBeCloseTo(1.03, 5);
    expect(box.drawH).toBeLessThan(containH);
    expect(box.drawH).toBeLessThan(prior096H);
    expect(box.drawH).toBeLessThan(TOTE_FOLDED_PANEL_HEIGHT);
  });

  it("print calibration is print-only and only used by tote folded bake (bp 1300)", () => {
    expect(ADJUSTABLE_TOTE_BLUEPRINT_ID).toBe(1300);
    expect(TOTE_FOLDED_PRINT_CALIBRATION).toBeGreaterThan(1);
    expect(
      usesToteFoldedFulfillment({
        isAllOverPrint: true,
        printifyBlueprintId: 836,
      }),
    ).toBe(false);
  });

  it("uses full-face offset fractions with no print-only Y lift", () => {
    const a = toteFoldedArtBox(100, 100, { scale: 1, offsetX: 0, offsetY: 0 });
    const b = toteFoldedArtBox(100, 100, { scale: 1, offsetX: 0.1, offsetY: 0 });
    expect(b.left - a.left).toBe(Math.round(TOTE_FOLDED_PANEL_WIDTH * 0.1));
    expect(a.top).toBe(Math.round(TOTE_FOLDED_PANEL_HEIGHT * 0.5 - a.drawH / 2));
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
