import { describe, expect, it } from "vitest";
import { PETPOSTEROUS_STYLES } from "@shared/packs/petposterous";
import { selectRenderer } from "./generation-providers";
import { compressPrompt } from "./replit_integrations/image/client";
import { assembleCatalogueConceptPrompt, catalogueApparelPlan, parseCatalogueConceptInput } from "./catalogue-concept";

const input = {
  concept: "The dog has taken the whole bed and left the person on the edge.",
  species: "dog",
  humor: "dry",
  look: "editorial-deadpan",
  wordsMode: "exact" as const,
  exactWords: "I LIVE HERE",
  garment: "dark" as const,
  aspect: "3:4",
  draws: 1,
};

describe("catalogue concept apparel plan", () => {
  it("resolves Petposterous apparel to the dedicated transparent OpenAI renderer, not the escalation model", () => {
    const seed = PETPOSTEROUS_STYLES[0]?.generationModel ?? null;
    const { path } = catalogueApparelPlan(seed);
    const renderer = selectRenderer(path);
    expect(path.kind).toBe("direct-openai");
    expect(path.background).toBe("transparent");
    expect(path.credential.id).toBe("openai:petposterous");
    expect(renderer.id).toBe("openai-flare");
    expect(renderer.model).toBe("gpt-image-2.5-flare");
    expect(path.escalation?.model).toBe("gpt-image-2.5-sunburst");
    expect(selectRenderer(path, { escalate: true }).model).toBe("gpt-image-2.5-sunburst");
  });

  it("assembles the pack prompt the model receives", () => {
    const seed = PETPOSTEROUS_STYLES[0]?.generationModel ?? null;
    const assembled = assembleCatalogueConceptPrompt(input, seed);
    expect(assembled.model).toBe("gpt-image-2.5-flare");
    expect(assembled.prompt).toContain("PETPOSTEROUS CREATIVE DIRECTION");
    expect(assembled.prompt).toContain("CONCEPT: The dog has taken the whole bed");
    expect(assembled.prompt).toContain("a dog");
    expect(assembled.prompt).toContain("HUMOUR: dry");
    expect(assembled.prompt).toContain("LOOK — DEADPAN");
    expect(assembled.prompt).toContain("PRODUCT RENDERER — APPAREL");
    expect(assembled.prompt).toContain("GARMENT COLOUR: printed on a dark garment");
    expect(assembled.prompt).toContain('EXACTLY as written, verbatim');
    expect(assembled.prompt).toContain("I LIVE HERE");
    expect(assembled.prompt).not.toContain("#FF00FF");
    expect(assembled.prompt).not.toContain("RELATIONSHIP:");
    const again = compressPrompt(assembled.prompt, true, false, null, false, "3:4", false, true, true, true);
    expect(again).toBe(assembled.prompt);
  });

  it("rejects a fifth draw and a humour that is a concept framework", () => {
    expect(() => parseCatalogueConceptInput({ ...input, draws: 5 })).toThrow(/1 to 4/);
    expect(() => parseCatalogueConceptInput({ ...input, humor: "pp-sleep-warfare" })).toThrow(/humour/i);
  });
});
