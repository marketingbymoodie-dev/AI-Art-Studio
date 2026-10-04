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
      expect(result.mode).toBe("pinned");
      expect(result.idea).toBeNull();
    }
  });

  it("full flow renders the selected idea and not the pinned punchline", () => {
    const result = composeArtStyleProbe({
      styleId: "woodcut",
      mode: "full",
      behaviour: "dog refuses to get into the back seat of the car",
      referenceDataUrl: "data:image/png;base64,aaaa",
      idea: {
        funnyTruth: "the dog believes the good seat is a right, not a request",
        visualJoke: "a spaniel already buckled into the front seat, utterly unmoved",
        punchline: "SEAT TAKEN.",
        subjectPriority: "the spaniel's face",
        conceptFramework: "pp-hostile-negotiations",
      },
    });
    expect(result.mode).toBe("full");
    expect(result.sentPrompt).toContain("a spaniel already buckled into the front seat, utterly unmoved");
    expect(result.sentPrompt).toContain("SEAT TAKEN.");
    expect(result.sentPrompt).not.toContain("PASSENGER SELECTED.");
    expect(result.sentPrompt).not.toContain("the dog has claimed the passenger seat and will not move");
    expect(result.idea?.conceptFramework).toBe("pp-hostile-negotiations");
  });
});
