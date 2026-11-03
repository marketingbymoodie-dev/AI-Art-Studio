import { describe, expect, it } from "vitest";
import { catalogueTruthIsSentence, parseCatalogueListing } from "@shared/catalogueListing";

describe("parseCatalogueListing", () => {
  it("keeps a supplied title and the written description", () => {
    expect(parseCatalogueListing(
      { title: "Something else", description: "The dog takes the bed." },
      "Bed Etiquette",
    )).toEqual([{ title: "Bed Etiquette", description: "The dog takes the bed." }]);
  });

  it("rejects an empty description", () => {
    expect(parseCatalogueListing({ title: "Bed Etiquette", description: "  " }, "Bed Etiquette")).toBeNull();
  });

  it("keeps a sentence about the picture and rejects a vision stutter", () => {
    expect(catalogueTruthIsSentence(
      "A tabby cat sits on a crescent moon and fishes with a rod into a goldfish bowl below.",
    )).toBe(true);
    expect(catalogueTruthIsSentence("fishes with a rod into a rod into")).toBe(false);
    expect(catalogueTruthIsSentence("Fishes with a rod into a rod into.")).toBe(false);
    expect(catalogueTruthIsSentence("")).toBe(false);
  });
});
