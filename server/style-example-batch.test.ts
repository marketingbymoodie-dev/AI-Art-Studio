import { describe, expect, it } from "vitest";
import { PETPOSTEROUS_CONCEPT_FRAMEWORKS, PETPOSTEROUS_VISUAL_SYSTEMS } from "@shared/petposterousCreative";
import { getStylePackProfile } from "@shared/stylePackProfiles";
import {
  composeStyleExample,
  pinnedPackConceptEngine,
  styleExampleFamilyError,
  styleExampleRecipe,
  type StyleExampleConcept,
} from "./style-example-batch";

const concept: StyleExampleConcept = {
  funnyTruth: "The dog has already decided the couch is his.",
  visualJoke: "A dog sits dead centre on the couch, staring down the empty cushion beside him.",
  punchline: "VACANCY FILLED.",
  subjectPriority: "the dog in the reference photo",
};
const behavior = "He takes the middle of the couch and waits for someone to move him.";
const framework = "pp-petty-crimes";

describe("style example batch composition", () => {
  it("uses the apparel storefront route for every look", () => {
    const recipe = styleExampleRecipe("apparel");
    expect(recipe.route).toBe("openai-flare");
    expect(recipe.credentialRef).toBe("openai:petposterous");
    expect(recipe.aspectRatio).toBe("2:3");
    expect(recipe.model).toBe("gpt-image-2.5-flare");
  });

  it("uses the poster storefront route, including full-bleed decor rules", () => {
    const recipe = styleExampleRecipe("poster");
    expect(recipe.route).toBe("google-nb2");
    expect(recipe.credentialRef).toBe("google:petposterous");
    expect(recipe.imageSize).toBe("2K");
    const { sentPrompt } = composeStyleExample({
      behavior,
      conceptFramework: framework,
      productFamily: "poster",
      visualSystem: "vintage-print",
      concept,
    });
    expect(sentPrompt).toContain("PRINT ARTWORK OUTPUT");
    expect(sentPrompt).toContain("FULL BLEED");
    expect(sentPrompt).toContain("PRODUCT RENDERER — WALL ART");
  });

  it("keeps the pinned framework and changes only the look", () => {
    const prompts = PETPOSTEROUS_VISUAL_SYSTEMS.map((look) => {
      const { sentPrompt } = composeStyleExample({
        behavior,
        conceptFramework: framework,
        productFamily: "apparel",
        visualSystem: look.id,
        concept,
        referenceDataUrl: "data:image/png;base64,aaaa",
      });
      expect(sentPrompt).toContain(look.prompt);
      expect(sentPrompt).toContain(`JOKE FRAMEWORK: ${PETPOSTEROUS_CONCEPT_FRAMEWORKS[framework]}`);
      expect(sentPrompt).toContain(concept.visualJoke);
      expect(sentPrompt).toContain(behavior);
      expect(sentPrompt).toContain("REFERENCE IMAGES (1, in order)");
      expect(sentPrompt).not.toContain("STYLE — PETTY CRIMES");
      expect(sentPrompt.indexOf("PRODUCT RENDERER — APPAREL")).toBeGreaterThan(sentPrompt.indexOf(look.prompt.slice(0, 24)));
      return sentPrompt.replace(look.prompt, "«LOOK»");
    });
    expect(new Set(prompts).size).toBe(1);
  });

  it("re-composes the same prompt from the same inputs", () => {
    const input = {
      behavior,
      conceptFramework: framework,
      productFamily: "apparel" as const,
      visualSystem: "editorial-deadpan",
      concept,
    };
    expect(composeStyleExample(input).sentPrompt).toBe(composeStyleExample(input).sentPrompt);
  });

  it("rejects a product that hides a look", () => {
    expect(styleExampleFamilyError("bedding")).toMatch(/apparel, poster, or pillow/);
    expect(styleExampleFamilyError("apparel")).toBeNull();
  });

  it("rejects a concept whose framework is not the pin", () => {
    const profile = getStylePackProfile("petposterous")!;
    const engine = pinnedPackConceptEngine(profile, framework);
    const option = {
      funny_truth: concept.funnyTruth,
      visual_joke: concept.visualJoke,
      punchline: concept.punchline,
      subject_priority: concept.subjectPriority,
      concept_framework: framework,
    };
    expect(engine.parse({ options: [option, option, option] })?.[0].conceptFramework).toBe(framework);
    expect(engine.parse({ options: [option, { ...option, concept_framework: "pp-sleep-warfare" }, option] })).toBeNull();
    expect(engine.system).toContain(`"${framework}"`);
  });
});
