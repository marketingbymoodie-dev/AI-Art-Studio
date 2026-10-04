import { describe, expect, it } from "vitest";
import { artStyleMarker, compositionLocksAboveStyle } from "@shared/petposterousArtStyles";
import { composeArtStyleProbe } from "./art-style-probe";

describe("art style probe compose", () => {
  it("sends the full style block on Flare without the apparel vignette lock", () => {
    const result = composeArtStyleProbe({
      styleId: "woodcut",
      referenceDataUrl: "data:image/png;base64,aaaa",
    });
    const marker = artStyleMarker(result.composed.style);
    expect(result.recipe.model).toMatch(/flare/i);
    expect(result.recipe.aspectRatio).toBe("2:3");
    expect(result.params.aspectRatio).toBe("1:1");
    expect(result.params.packLayered).toBe(true);
    expect(result.params.transparencyCheck).toBe("enforce");
    expect(result.sentPrompt.length).toBeGreaterThan(4000);
    expect(result.sentPrompt).toContain(marker);
    expect(compositionLocksAboveStyle(result.sentPrompt, marker)).toEqual([]);
    expect(result.sentPrompt).toContain("PASSENGER SELECTED.");
  });

  it("keeps the woodcut control near 800 characters after compression", () => {
    const result = composeArtStyleProbe({
      styleId: "woodcut",
      length: "short",
      referenceDataUrl: "data:image/png;base64,aaaa",
    });
    expect(result.sentPrompt.length).toBeGreaterThan(700);
    expect(result.sentPrompt.length).toBeLessThan(900);
    expect(result.sentPrompt).toContain("WOODCUT:");
  });
});
