import { describe, expect, it } from "vitest";
import { PETPOSTEROUS_ART_STYLES, artStyleMarker, compositionLocksAboveStyle } from "@shared/petposterousArtStyles";
import { composeArtStyleProbe } from "./art-style-probe";

describe("art style probe compose", () => {
  it("sends the short style block on Flare without the apparel vignette lock", () => {
    for (const style of PETPOSTEROUS_ART_STYLES) {
      const result = composeArtStyleProbe({
        styleId: style.id,
        referenceDataUrl: "data:image/png;base64,aaaa",
      });
      const marker = artStyleMarker(result.composed.style);
      expect(result.recipe.model).toMatch(/flare/i);
      expect(result.recipe.aspectRatio).toBe("2:3");
      expect(result.params.aspectRatio).toBe("1:1");
      expect(result.params.packLayered).toBe(true);
      expect(result.params.transparencyCheck).toBe("enforce");
      expect(result.sentPrompt).toBe(result.composed.prompt);
      expect(result.sentPrompt).toContain(marker);
      expect(result.sentPrompt.length).toBeGreaterThan(700);
      expect(result.sentPrompt.length).toBeLessThan(1600);
      expect(compositionLocksAboveStyle(result.sentPrompt, marker)).toEqual([]);
      expect(result.sentPrompt).toContain("PASSENGER SELECTED.");
      expect(result.sentPrompt).toContain("the dog has claimed the passenger seat and will not move");
      expect(result.sentPrompt).not.toContain("driver's door");
    }
  });
});
