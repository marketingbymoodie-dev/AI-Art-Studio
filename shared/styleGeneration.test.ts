import { describe, expect, it } from "vitest";
import { APPAREL_CHROMA_STYLE_BY_NAME } from "./apparel-chroma-prompts";
import {
  chromaPlateLeakMatches,
  composeTransparentPrompt,
  estimatedGptImage2CostUsd,
  mapGptImage2AspectRatio,
  persistVectorizeEnabled,
  resolveGenerationQuality,
  resolveStyleGeneration,
  stripChromaPlateLanguage,
} from "./styleGeneration";

describe("resolveStyleGeneration", () => {
  it("defaults to current model and low quality when unset", () => {
    expect(resolveStyleGeneration(null)).toEqual({
      model: null,
      quality: "low",
      nativeTransparent: false,
    });
  });

  it("turns on native transparent for gpt-image-2", () => {
    const g = resolveStyleGeneration({ generationModel: "openai/gpt-image-2" });
    expect(g.model).toBe("gpt-image-2");
    expect(g.nativeTransparent).toBe(true);
    expect(g.quality).toBe("low");
  });

  it("honors explicit medium override", () => {
    expect(
      resolveStyleGeneration({ generationModel: "gpt-image-2", generationQuality: "medium" }).quality,
    ).toBe("medium");
  });
});

describe("quality cost map", () => {
  it("defaults unknown to low", () => {
    expect(resolveGenerationQuality(null)).toBe("low");
    expect(resolveGenerationQuality("nope")).toBe("low");
  });

  it("persists vectorizeEnabled as true or null", () => {
    expect(persistVectorizeEnabled(undefined)).toBeUndefined();
    expect(persistVectorizeEnabled(true)).toBe(true);
    expect(persistVectorizeEnabled(null)).toBeNull();
  });

  it("maps list prices", () => {
    expect(estimatedGptImage2CostUsd("low")).toBe(0.01);
    expect(estimatedGptImage2CostUsd("medium")).toBe(0.05);
    expect(estimatedGptImage2CostUsd("high")).toBe(0.13);
    expect(estimatedGptImage2CostUsd("auto")).toBe(0.13);
  });
});

describe("mapGptImage2AspectRatio", () => {
  it("maps only 1:1 / 3:2 / 2:3", () => {
    expect(mapGptImage2AspectRatio("1:1")).toBe("1:1");
    expect(mapGptImage2AspectRatio("16:9")).toBe("3:2");
    expect(mapGptImage2AspectRatio("9:16")).toBe("2:3");
    expect(mapGptImage2AspectRatio("2:3")).toBe("2:3");
    // Gemini maps 50:60 → 4:5; GPT then maps 4:5 (0.8) → 2:3 (taller),
    // which resizeToAspectRatio used to center-crop top/bottom to 5:6.
    expect(mapGptImage2AspectRatio("4:5")).toBe("2:3");
    expect(mapGptImage2AspectRatio("50:60")).toBe("1:1");
  });
});

describe("chroma plate strip", () => {
  it("clears leftover plate language around a style-only Opinionated prefix", () => {
    const prefix = APPAREL_CHROMA_STYLE_BY_NAME.opinionated;
    expect(prefix.toLowerCase()).not.toContain("#ff00ff");
    const composed = composeTransparentPrompt(
      `CATCH THIS, ${prefix} isolated on a solid hot pink (#FF00FF) background`,
    );
    expect(chromaPlateLeakMatches(composed)).toEqual([]);
    expect(composed.toLowerCase()).toContain("transparent background");
    expect(composed).toMatch(/CATCH THIS/i);
  });

  it("strips #FF00FF and hot pink background leftovers", () => {
    const out = stripChromaPlateLanguage(
      "isolated on a solid hot pink (#FF00FF) background, no white mat",
    );
    expect(chromaPlateLeakMatches(out)).toEqual([]);
  });
});
