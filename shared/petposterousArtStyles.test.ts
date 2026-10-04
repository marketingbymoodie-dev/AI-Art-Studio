import { describe, expect, it } from "vitest";
import { PETPOSTEROUS_CONCEPT_FRAMEWORKS, PETPOSTEROUS_VISUAL_SYSTEMS } from "./petposterousCreative";
import {
  PETPOSTEROUS_APPAREL_OUTPUT_RULE,
  PETPOSTEROUS_ART_STYLES,
  WOODCUT_SHORT_PROMPT,
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

  it("gives each style its own block and shares the apparel rule once, above the style", () => {
    expect(PETPOSTEROUS_ART_STYLES).toHaveLength(10);
    expect(new Set(PETPOSTEROUS_ART_STYLES.map((style) => style.id)).size).toBe(10);
    for (const style of PETPOSTEROUS_ART_STYLES) {
      expect(style.rendererId).toBeNull();
      expect(style.prompt).not.toContain("APPAREL OUTPUT RULE");
      const composed = composePetposterousArtStylePrompt({ styleId: style.id });
      const marker = artStyleMarker(style);
      expect(composed.prompt.split("APPAREL OUTPUT RULE:")).toHaveLength(2);
      expect(composed.prompt.indexOf("APPAREL OUTPUT RULE:")).toBeLessThan(composed.prompt.indexOf(marker));
      expect(composed.prompt.indexOf(marker)).toBeGreaterThan(composed.prompt.indexOf("JOKE FRAMEWORK — Hostile Negotiations:"));
      expect(composed.prompt).toContain(PETPOSTEROUS_CONCEPT_FRAMEWORKS["pp-hostile-negotiations"]);
      expect(composed.prompt).toContain("PASSENGER SELECTED.");
      expect(composed.prompt).toContain(style.prompt);
      expect(compositionLocksAboveStyle(composed.prompt, marker)).toEqual([]);
      expect(composed.prompt).not.toContain("LOOK —");
      expect(composed.prompt).not.toContain("STYLE — HOSTILE");
      expect(composed.prompt).not.toContain("prefer no words");
      expect(composed.prompt).not.toContain("COLOUR-LIGHT");
      expect(composed.prompt).not.toContain("avoid white and very pale");
    }
  });

  it("compresses the woodcut control to about 800 characters and refuses other styles", () => {
    expect(WOODCUT_SHORT_PROMPT.length).toBeGreaterThan(700);
    expect(WOODCUT_SHORT_PROMPT.length).toBeLessThan(900);
    const short = composePetposterousArtStylePrompt({ styleId: "woodcut", length: "short" });
    expect(short.prompt).toBe(WOODCUT_SHORT_PROMPT);
    expect(short.prompt).toContain("WOODCUT:");
    expect(short.prompt).toContain("PASSENGER SELECTED.");
    expect(() => composePetposterousArtStylePrompt({ styleId: "ornamental", length: "short" })).toThrow(/woodcut/);
  });
});
