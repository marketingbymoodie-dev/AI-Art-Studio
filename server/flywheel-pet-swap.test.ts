import { describe, expect, it } from "vitest";
import { petSwapRenderInput } from "./flywheel-pet-swap";

describe("stored pet swap", () => {
  it("sends the stored recipe through the art-style render and does not insert a candidate", () => {
    const input = petSwapRenderInput({
      artStyle: "pen-ink",
      funnyTruth: "he is wearing the situation",
      punchline: "How was your day?",
      deviceText: "A dog sits with his head tilted, a hinged wooden toilet seat stuck fast around his neck, the lid hanging down over his back.",
      deviceStructure: "object_evidence",
      humourOperator: "pp-sleep-warfare",
      darknessLevel: 2,
      species: "dog",
      behaviour: "He has a toilet seat stuck around his neck.",
      productFamily: "apparel",
      shopDomain: "demo-store.myshopify.com",
    }, "abc123abc123abcd", "abatch01");
    expect(input.petSwap).toBe(true);
    expect(input.device).toContain("toilet seat");
    expect(input.funnyTruth).toBe("he is wearing the situation");
    expect(input.variant).toBe(1);
    expect(input).not.toHaveProperty("suppliedTruth");
  });
});