import { describe, expect, it } from "vitest";
import { PETPOSTEROUS_CONCEPT_FRAMEWORKS, PETPOSTEROUS_VISUAL_SYSTEMS } from "./petposterousCreative";
import {
  PETPOSTEROUS_APPAREL_PRINT,
  PETPOSTEROUS_ART_STYLE_BATCH,
  PETPOSTEROUS_ART_STYLES,
  PETPOSTEROUS_TYPE_RESTRAINT,
  artStyleConceptHeading,
  artStyleConceptShotFlags,
  artStyleMarker,
  composePetposterousArtStylePrompt,
  compositionLocksAboveStyle,
} from "./petposterousArtStyles";

const FRAMEWORK_KEYS = [
  "pp-minimal-deadpan",
  "pp-domestic-affairs",
  "pp-petty-crimes",
  "pp-behavioural-studies",
  "pp-portrait-character",
  "pp-hostile-negotiations",
  "pp-retro-ad",
  "pp-forensic",
  "pp-domestic-epic",
  "pp-owner-vs-pet",
  "pp-old-master",
  "pp-domestic-drama",
  "pp-illustrated-character",
  "pp-pet-propaganda",
  "pp-head-household",
  "pp-sleep-warfare",
];

describe("Petposterous apparel art styles", () => {
  it("leaves the sixteen joke frameworks and the six looks untouched", () => {
    expect(Object.keys(PETPOSTEROUS_CONCEPT_FRAMEWORKS)).toEqual(FRAMEWORK_KEYS);
    expect(PETPOSTEROUS_VISUAL_SYSTEMS.map((look) => look.label)).toEqual([
      "Deadpan", "Field Notes", "Vintage Print", "Character", "Portrait", "Domestic Cinema",
    ]);
  });

  it("composes the funny truth, the shared rules once, then the style block", () => {
    expect(PETPOSTEROUS_ART_STYLES).toHaveLength(10);
    expect(PETPOSTEROUS_ART_STYLE_BATCH.concept).toBe("the dog has claimed the passenger seat and will not move");
    for (const style of PETPOSTEROUS_ART_STYLES) {
      expect(style.rendererId).toBeNull();
      expect(style.prompt).not.toContain("APPAREL PRINT");
      const composed = composePetposterousArtStylePrompt({
        styleId: style.id,
        concept: PETPOSTEROUS_ART_STYLE_BATCH.concept,
        words: PETPOSTEROUS_ART_STYLE_BATCH.words,
      });
      const marker = artStyleMarker(style);
      expect(composed.length).toBe("short");
      expect(composed.prompt.split(PETPOSTEROUS_APPAREL_PRINT)).toHaveLength(2);
      expect(composed.prompt.split(PETPOSTEROUS_TYPE_RESTRAINT)).toHaveLength(2);
      expect(composed.prompt.startsWith(artStyleConceptHeading(PETPOSTEROUS_ART_STYLE_BATCH.concept, PETPOSTEROUS_ART_STYLE_BATCH.words))).toBe(true);
      expect(composed.prompt.indexOf("CONCEPT:")).toBeLessThan(composed.prompt.indexOf("APPAREL PRINT:"));
      expect(composed.prompt.indexOf("APPAREL PRINT:")).toBeLessThan(composed.prompt.indexOf("TYPE:"));
      expect(composed.prompt.indexOf("TYPE:")).toBeLessThan(composed.prompt.indexOf(marker));
      expect(composed.prompt).toContain(PETPOSTEROUS_APPAREL_PRINT);
      expect(composed.prompt).toContain(PETPOSTEROUS_TYPE_RESTRAINT);
      expect(composed.prompt).toContain(style.prompt);
      expect(composed.prompt).toContain("PASSENGER SELECTED.");
      expect(composed.prompt).toContain(PETPOSTEROUS_ART_STYLE_BATCH.concept);
      expect(composed.prompt).not.toContain("driver's door");
      expect(composed.prompt).not.toContain("back seat");
      expect(composed.prompt).not.toContain("mutual eye contact");
      expect(composed.prompt).not.toContain(PETPOSTEROUS_CONCEPT_FRAMEWORKS["pp-hostile-negotiations"]);
      expect(compositionLocksAboveStyle(composed.prompt, marker)).toEqual([]);
      expect(composed.prompt).not.toContain("LOOK —");
      expect(composed.prompt).not.toContain("PRODUCT AUTHORITY");
      expect(composed.prompt).not.toContain("prefer no words");
    }
  });

  it("uses the same short compose for every style, including a former long request", () => {
    const pinned = { concept: PETPOSTEROUS_ART_STYLE_BATCH.concept, words: PETPOSTEROUS_ART_STYLE_BATCH.words };
    const woodcut = composePetposterousArtStylePrompt({ styleId: "woodcut", length: "short", ...pinned });
    const requestedLong = composePetposterousArtStylePrompt({ styleId: "woodcut", length: "full", ...pinned });
    expect(requestedLong.prompt).toBe(woodcut.prompt);
    expect(woodcut.prompt).toContain("WOODCUT:");
    expect(woodcut.prompt).not.toContain("WOODCUT STYLE:");
    for (const style of PETPOSTEROUS_ART_STYLES) {
      const composed = composePetposterousArtStylePrompt({
        styleId: style.id,
        concept: PETPOSTEROUS_ART_STYLE_BATCH.concept,
        words: PETPOSTEROUS_ART_STYLE_BATCH.words,
      });
      expect(composed.prompt.length).toBeGreaterThan(700);
      expect(composed.prompt.length).toBeLessThan(1600);
    }
  });

  it("treats a truth as clean and a shot as flagged", () => {
    expect(artStyleConceptShotFlags("the dog has decided the bed is not for sharing")).toEqual([]);
    expect(artStyleConceptShotFlags(PETPOSTEROUS_ART_STYLE_BATCH.concept)).toEqual([]);
    const shot = artStyleConceptShotFlags("dog in the front seat, door open, owner waiting");
    expect(shot).toContain("position");
    expect(shot).toContain("staging");
    expect(shot).toContain("second person");
    expect(() => composePetposterousArtStylePrompt({ styleId: "woodcut", concept: "  ", words: "HI" })).toThrow(/concept/);
  });
});
