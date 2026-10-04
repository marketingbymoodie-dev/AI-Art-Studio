import { describe, expect, it } from "vitest";
import { PETPOSTEROUS_CONCEPT_FRAMEWORKS, PETPOSTEROUS_VISUAL_SYSTEMS } from "./petposterousCreative";
import {
  PETPOSTEROUS_APPAREL_PRINT,
  PETPOSTEROUS_ART_STYLE_BATCH,
  PETPOSTEROUS_ART_STYLES,
  PETPOSTEROUS_TYPE_RESTRAINT,
  ART_STYLE_TRUTH_FAIL,
  ART_STYLE_TRUTH_PASS,
  artStyleConceptHeading,
  artStyleConceptShotFlags,
  artStyleDeviceLine,
  artStyleMarker,
  composePetposterousArtStylePrompt,
  compositionLocksAboveStyle,
  settleArtStyleTruth,
} from "./petposterousArtStyles";

const DEVICE = "one carved mass, the dog occupying the block";

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
        device: DEVICE,
      });
      const marker = artStyleMarker(style);
      expect(composed.length).toBe("short");
      expect(composed.prompt.split(PETPOSTEROUS_APPAREL_PRINT)).toHaveLength(2);
      expect(composed.prompt.split(PETPOSTEROUS_TYPE_RESTRAINT)).toHaveLength(2);
      expect(composed.prompt.startsWith(artStyleConceptHeading(PETPOSTEROUS_ART_STYLE_BATCH.concept, PETPOSTEROUS_ART_STYLE_BATCH.words))).toBe(true);
      expect(composed.prompt.indexOf("CONCEPT:")).toBeLessThan(composed.prompt.indexOf("DEVICE:"));
      expect(composed.prompt.indexOf("DEVICE:")).toBeLessThan(composed.prompt.indexOf("APPAREL PRINT:"));
      expect(composed.prompt.indexOf("APPAREL PRINT:")).toBeLessThan(composed.prompt.indexOf("TYPE:"));
      expect(composed.prompt).toContain(artStyleDeviceLine(DEVICE));
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
    const pinned = { concept: PETPOSTEROUS_ART_STYLE_BATCH.concept, words: PETPOSTEROUS_ART_STYLE_BATCH.words, device: DEVICE };
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
        device: DEVICE,
      });
      expect(composed.prompt.length).toBeGreaterThan(700);
      expect(composed.prompt.length).toBeLessThan(2200);
    }
  });

  it("passes the truth fixture and fails the shot fixture", () => {
    for (const truth of ART_STYLE_TRUTH_PASS) {
      expect(artStyleConceptShotFlags(truth), truth).toEqual([]);
    }
    for (const truth of ART_STYLE_TRUTH_FAIL) {
      expect(artStyleConceptShotFlags(truth).length, truth).toBeGreaterThan(0);
    }
    expect(artStyleConceptShotFlags(PETPOSTEROUS_ART_STYLE_BATCH.concept)).toContain("position");
    expect(PETPOSTEROUS_APPAREL_PRINT).not.toContain("at most one supporting object");
    expect(PETPOSTEROUS_APPAREL_PRINT).toContain("abstracted prop");
    expect(() => composePetposterousArtStylePrompt({ styleId: "woodcut", concept: "  ", words: "HI", device: DEVICE })).toThrow(/concept/);
    expect(() => composePetposterousArtStylePrompt({ styleId: "woodcut", concept: ART_STYLE_TRUTH_PASS[0], words: "", device: "  " })).toThrow(/device/);
  });

  it("keeps a clean rewrite and leaves a failed rewrite available to render anyway", () => {
    const clean = settleArtStyleTruth(ART_STYLE_TRUTH_PASS[2], "MINE.", null);
    expect(clean.funnyTruth).toBe(ART_STYLE_TRUTH_PASS[2]);
    expect(clean.shotFlags).toEqual([]);
    expect(clean.rewritten).toBe(false);
    const shot = ART_STYLE_TRUTH_FAIL[0];
    const rewritten = settleArtStyleTruth(shot, "MINE.", ART_STYLE_TRUTH_PASS[0]);
    expect(rewritten.funnyTruth).toBe(ART_STYLE_TRUTH_PASS[0]);
    expect(rewritten.originalTruth).toBe(shot);
    expect(rewritten.originalFlags.length).toBeGreaterThan(0);
    expect(rewritten.shotFlags).toEqual([]);
    const stillShot = settleArtStyleTruth(shot, "MINE.", ART_STYLE_TRUTH_FAIL[2]);
    expect(stillShot.funnyTruth).toBe(shot);
    expect(stillShot.shotFlags.length).toBeGreaterThan(0);
    expect(stillShot.rewritten).toBe(false);
  });
});
