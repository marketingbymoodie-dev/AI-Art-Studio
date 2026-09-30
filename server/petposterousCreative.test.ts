import { describe, expect, it, vi } from "vitest";
vi.mock("./style-packs", () => ({ resolveGeneratePack: vi.fn(async () => ({ allowed: true, pack: { pack: { id: "pack", slug: "petposterous-v1", promptProfileKey: "petposterous" } } })) }));
vi.mock("./customer-references", () => ({ signReferencePath: vi.fn(), storeReferenceDataUrl: vi.fn() }));
import { packConceptEngine } from "./pack-concept-engine";
import { getStylePackProfile } from "@shared/stylePackProfiles";
import { creativeBriefFromContext, packLayersForCompose, preparePackGeneration, type PackGenerationContext } from "./pack-generation";
import { composeLayeredPrompt } from "@shared/promptLayers";

const profile = getStylePackProfile("petposterous")!;
const ctx: PackGenerationContext = { packId: "pack", packSlug: "petposterous-v1", profile, capabilities: null, humorId: "dry", relationshipId: "rivals", concept: "The dog sprawls across 90% of the bedding.", punchline: "SHARED EQUALLY.", wordsMode: "exact", petName: "Malcolm", species: "Dog", personalityTraits: [], behavior: "owns the bed", funnyTruth: "Unequal territory", subjectPriority: "golden retriever", conceptIndex: 0, conceptFramework: "pp-sleep-warfare", visualSystem: "cinematic-domestic", productRenderer: "bedding" };

describe("Petposterous V2 generation boundary", () => {
  it("requires a valid internal framework in Petposterous concept output", () => {
    const engine = packConceptEngine(profile)!;
    const option = { funny_truth: "He knows", visual_joke: "Dog takes the entire bed", punchline: "SHARED EQUALLY.", subject_priority: "golden coat", concept_framework: "pp-sleep-warfare" };
    expect(engine.parse({ options: [option, option, option] })?.[0].conceptFramework).toBe("pp-sleep-warfare");
    expect(engine.parse({ options: [option, { ...option, concept_framework: "arbitrary" }, option] })).toBeNull();
  });
  it("rejects invalid look/framework before generation", async () => {
    const result = await preparePackGeneration({ style: { id: "s", catalogSlug: "pp-owner-vs-pet" }, merchantId: "m", body: { stylePackId: "pack", packInputs: { visualSystem: "fake", conceptFramework: "pp-sleep-warfare" } }, referenceImages: [] });
    expect(result.ok).toBe(false);
  });
  it("suppresses stale framework art direction, with renderer following look", () => {
    const layers = packLayersForCompose(ctx, { isApparel: false, styleImageCount: 0, customerImages: [] });
    const prompt = composeLayeredPrompt({ category: "all", isApparelGeneration: false, styleLayer: "STALE LEGACY ROYAL COSTUME", subStyleLayer: "STALE SUBSTYLE", userInput: ctx.behavior!, packLayers: layers }).prompt;
    expect(prompt).not.toContain("STALE LEGACY");
    expect(prompt).not.toContain("STALE SUBSTYLE");
    expect(prompt).toContain("90% of the actual bedding surface");
    expect(prompt.indexOf("PRODUCT RENDERER — BEDDING")).toBeGreaterThan(prompt.indexOf("LOOK — DOMESTIC CINEMA"));
    expect(creativeBriefFromContext(ctx, { styleSlug: "pp-owner-vs-pet", subStyle: null, references: [] }).productRenderer).toBe("bedding");
  });
  it("enforces hidden look compatibility and recomposes cinema for apparel", () => {
    expect(() => packLayersForCompose({ ...ctx, visualSystem: "editorial-deadpan" }, { isApparel: false, styleImageCount: 0, customerImages: [] })).toThrow("unavailable");
    const layers = packLayersForCompose({ ...ctx, productRenderer: "apparel" }, { isApparel: true, styleImageCount: 0, customerImages: [] });
    expect(layers.rendererExtra).toContain("native transparent outer background");
    expect(layers.rendererExtra).toContain("No rectangular scene boundary");
  });
});
