import { describe, expect, it } from "vitest";
import {
  DEFAULT_DECOR_BACKGROUND_FILL,
  FALLBACK_OPENING_BLEED_FRACTION,
  isDecorFloatingNativeFillPath,
  parseDecorBackgroundFill,
  parseLiveFillHex,
  resolveDecorBakeBleedSpec,
  resolveDesignLiveFillHex,
  resolveLiveFillHex,
  resolveStyleGenerationForProduct,
  productBakeSupportsDecorFill,
  shouldShowDecorFloatingFill,
} from "./decorBackgroundFill";

describe("parseDecorBackgroundFill", () => {
  it("defaults to white", () => {
    expect(parseDecorBackgroundFill(undefined)).toBe(DEFAULT_DECOR_BACKGROUND_FILL);
    expect(parseDecorBackgroundFill(null)).toBe("#FFFFFF");
    expect(parseDecorBackgroundFill("not-a-color")).toBe("#FFFFFF");
  });

  it("accepts none and hex", () => {
    expect(parseDecorBackgroundFill("none")).toBe("none");
    expect(parseDecorBackgroundFill("")).toBe("none");
    expect(parseDecorBackgroundFill("#00ffaa")).toBe("#00FFAA");
  });
});

describe("parseLiveFillHex / resolveLiveFillHex", () => {
  it("treats none as transparent and hex as live color", () => {
    expect(parseLiveFillHex("none")).toBeNull();
    expect(parseLiveFillHex("#00ffaa")).toBe("#00FFAA");
    expect(resolveLiveFillHex(undefined, { shown: true })).toBe(DEFAULT_DECOR_BACKGROUND_FILL);
    expect(resolveLiveFillHex("none", { shown: true })).toBeNull();
  });
});

describe("resolveDecorBakeBleedSpec", () => {
  it("fills the existing print file (provider bleed) and keeps subject on the opening", () => {
    const spec = resolveDecorBakeBleedSpec({
      kind: "flat",
      printFile: { width: 3000, height: 4000 },
      opening: { x: 150, y: 200, width: 2700, height: 3600 },
    });
    expect(spec.kind).toBe("print-file");
    expect(spec.fillRect).toEqual({ x: 0, y: 0, width: 3000, height: 4000 });
    expect(spec.subjectRect).toEqual({ x: 150, y: 200, width: 2700, height: 3600 });
    expect(spec.canvas).toEqual({ width: 3000, height: 4000 });
  });

  it("labels tote / AOP canvases as their provider spec, not fallback", () => {
    expect(
      resolveDecorBakeBleedSpec({ kind: "tote", printFile: { width: 2650, height: 5250 } }).kind,
    ).toBe("tote-canvas");
    expect(
      resolveDecorBakeBleedSpec({ kind: "aop", printFile: { width: 4000, height: 4000 } }).kind,
    ).toBe("aop-panel");
  });

  it("reads one hex for preview and bake", () => {
    expect(
      resolveDesignLiveFillHex({
        flatPlacerState: { backgroundColor: "#112233" },
        decorBackgroundFill: "#445566",
      }),
    ).toBe("#112233");
    expect(resolveDesignLiveFillHex({ decorBackgroundFill: "none" })).toBeNull();
  });

  it("fallback expands color ~5% past the opening without moving the subject rect", () => {
    const opening = { x: 0, y: 0, width: 200, height: 100 };
    const spec = resolveDecorBakeBleedSpec({ opening });
    expect(spec.kind).toBe("fallback-5");
    expect(spec.subjectRect).toEqual(opening);
    expect(spec.fillRect.width).toBeCloseTo(200 * (1 + 2 * FALLBACK_OPENING_BLEED_FRACTION));
    expect(spec.fillRect.height).toBeCloseTo(100 * (1 + 2 * FALLBACK_OPENING_BLEED_FRACTION));
    expect(spec.fillRect.x).toBeLessThan(opening.x);
    expect(spec.fillRect.y).toBeLessThan(opening.y);
  });
});

describe("isDecorFloatingNativeFillPath", () => {
  it("is one gate for every floating style on decor + GPT", () => {
    expect(
      isDecorFloatingNativeFillPath({
        catalogSlug: "centered-graphic",
        outputMode: "floating",
        generationModel: "gpt-image-2",
        isApparelGeneration: false,
      }),
    ).toBe(true);
    expect(
      isDecorFloatingNativeFillPath({
        catalogSlug: "illustrated-motif",
        outputMode: "floating",
        generationModel: "gpt-image-2",
        isApparelGeneration: false,
      }),
    ).toBe(true);
    expect(
      isDecorFloatingNativeFillPath({
        catalogSlug: "pattern-maker",
        outputMode: "floating",
        generationModel: "gpt-image-2",
        isApparelGeneration: false,
      }),
    ).toBe(true);
    expect(
      isDecorFloatingNativeFillPath({
        catalogSlug: "minimal-line",
        generationModel: "gpt-image-2",
        isApparelGeneration: false,
      }),
    ).toBe(true);
  });

  it("does not fire for apparel, full-bleed, or Nano Minimalist", () => {
    expect(
      isDecorFloatingNativeFillPath({
        catalogSlug: "centered-graphic",
        outputMode: "floating",
        generationModel: "gpt-image-2",
        isApparelGeneration: true,
      }),
    ).toBe(false);
    expect(
      isDecorFloatingNativeFillPath({
        catalogSlug: "watercolor",
        generationModel: "gpt-image-2",
        isApparelGeneration: false,
      }),
    ).toBe(false);
    expect(
      isDecorFloatingNativeFillPath({
        catalogSlug: "minimal-line",
        generationModel: null,
        isApparelGeneration: false,
      }),
    ).toBe(false);
  });
});

describe("productBakeSupportsDecorFill", () => {
  it("allows tote / tapestry / mug hex-fill bakes", () => {
    expect(productBakeSupportsDecorFill({ designerType: "generic" })).toBe(true);
    expect(productBakeSupportsDecorFill({ designerType: "mug" })).toBe(true);
    expect(productBakeSupportsDecorFill({ designerType: "pillow" })).toBe(true);
  });

  it("rejects apparel, phone edge-wrap, and PatternCustomizer AOP", () => {
    expect(productBakeSupportsDecorFill({ designerType: "apparel" })).toBe(false);
    expect(productBakeSupportsDecorFill({ isApparelProduct: true, designerType: "generic" })).toBe(
      false,
    );
    expect(productBakeSupportsDecorFill({ designerType: "generic", edgeWrapMode: true })).toBe(
      false,
    );
    expect(
      productBakeSupportsDecorFill({ designerType: "all-over-print", useAopCustomizer: true }),
    ).toBe(false);
  });
});

describe("shouldShowDecorFloatingFill", () => {
  it("shows for floating styles on framed-print even when only a numeric id + name exist", () => {
    expect(
      shouldShowDecorFloatingFill({
        designerType: "framed-print",
        isApparelProduct: false,
        styleId: "14",
        styleName: "Centered Graphic",
        catalogSlug: null,
        outputMode: null,
        generationModel: null,
      }),
    ).toBe(true);
    expect(
      shouldShowDecorFloatingFill({
        designerType: "framed-print",
        styleName: "Illustrated Motif",
        generationModel: null,
      }),
    ).toBe(true);
    expect(
      shouldShowDecorFloatingFill({
        designerType: "pillow",
        outputMode: "floating",
        catalogSlug: "pattern-maker",
      }),
    ).toBe(true);
    expect(
      shouldShowDecorFloatingFill({
        isApparelProduct: true,
        designerType: "framed-print",
        catalogSlug: "centered-graphic",
        outputMode: "floating",
      }),
    ).toBe(true);
  });

  it("shows for floating styles on tote / tapestry (generic), not only pillow/poster", () => {
    expect(
      shouldShowDecorFloatingFill({
        designerType: "generic",
        styleName: "Centered Graphic",
        outputMode: "floating",
        catalogSlug: "centered-graphic",
      }),
    ).toBe(true);
    expect(
      shouldShowDecorFloatingFill({
        designerType: "generic",
        styleId: "14",
        styleName: "Illustrated Motif",
        catalogSlug: null,
        outputMode: null,
      }),
    ).toBe(true);
    expect(
      shouldShowDecorFloatingFill({
        designerType: "generic",
        catalogSlug: "playful-cartoon",
        styleName: "Playful Cartoon",
      }),
    ).toBe(true);
    expect(
      shouldShowDecorFloatingFill({
        designerType: "pillow",
        catalogSlug: "vintage-print",
      }),
    ).toBe(true);
  });

  it("stays off for apparel, full-bleed decor, and PatternCustomizer AOP", () => {
    expect(
      shouldShowDecorFloatingFill({
        designerType: "apparel",
        catalogSlug: "centered-graphic",
        outputMode: "floating",
      }),
    ).toBe(false);
    expect(
      shouldShowDecorFloatingFill({
        designerType: "framed-print",
        catalogSlug: "watercolor",
      }),
    ).toBe(false);
    expect(
      shouldShowDecorFloatingFill({
        designerType: "generic",
        catalogSlug: "watercolor",
        outputMode: "full_bleed",
      }),
    ).toBe(false);
    expect(
      shouldShowDecorFloatingFill({
        designerType: "all-over-print",
        useAopCustomizer: true,
        catalogSlug: "centered-graphic",
        outputMode: "floating",
      }),
    ).toBe(false);
  });
});

describe("resolveStyleGenerationForProduct", () => {
  it("forces GPT-Image-2 for floating styles on decor", () => {
    const g = resolveStyleGenerationForProduct(
      { catalogSlug: "centered-graphic", outputMode: "floating", generationModel: null },
      "framed-print",
    );
    expect(g.model).toBe("gpt-image-2");
    expect(g.nativeTransparent).toBe(true);
  });

  it("forces GPT-Image-2 for floating styles on apparel (native transparent garment float)", () => {
    const g = resolveStyleGenerationForProduct(
      { catalogSlug: "centered-graphic", outputMode: "floating", generationModel: null },
      "apparel",
    );
    expect(g.model).toBe("gpt-image-2");
    expect(g.nativeTransparent).toBe(true);
  });

  it("routes the 2026-08 floating styles to GPT-Image-2 on decor and apparel", () => {
    for (const slug of [
      "vintage-print",
      "one-color-print",
      "retro-sunset-stack",
      "playful-cartoon",
    ] as const) {
      const decor = resolveStyleGenerationForProduct({ catalogSlug: slug }, "generic");
      expect(decor.model).toBe("gpt-image-2");
      expect(decor.nativeTransparent).toBe(true);
      const apparel = resolveStyleGenerationForProduct({ catalogSlug: slug }, "apparel");
      expect(apparel.model).toBe("gpt-image-2");
    }
  });
});
