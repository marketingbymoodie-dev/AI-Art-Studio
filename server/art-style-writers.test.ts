import { describe, expect, it } from "vitest";
import { parseArtStyleDevice, parseArtStyleTruths } from "./art-style-writers";

const option = {
  funny_truth: "the bed is not for sharing",
  punchline: "MINE.",
  humour_operator: "pp-sleep-warfare",
  darkness_level: 2,
  species: "dog",
};

describe("art style writer recipe", () => {
  it("keeps a truth only when operator, darkness, and species are valid", () => {
    const parsed = parseArtStyleTruths({ options: [option, { ...option, funny_truth: "he sneezes when he wants something" }, { ...option, funny_truth: "she considers the sofa hers" }] });
    expect(parsed?.[0]).toMatchObject({ humourOperator: "pp-sleep-warfare", darknessLevel: 2, species: "dog" });
    expect(parseArtStyleTruths({ options: [option, option, { ...option, humour_operator: "deadpan" }] })).toBeNull();
    expect(parseArtStyleTruths({ options: [option, option, { ...option, darkness_level: 9 }] })).toBeNull();
    expect(parseArtStyleTruths({ options: [option, option, { ...option, species: "parrot" }] })).toBeNull();
  });

  it("requires a closed device structure before the sentence", () => {
    expect(parseArtStyleDevice({
      device_structure: "occupied_territory",
      device_text: "The dog takes the middle of the bed.",
    })).toEqual({
      deviceStructure: "occupied_territory",
      deviceText: "The dog takes the middle of the bed.",
    });
    expect(parseArtStyleDevice({ device: "The dog takes the middle of the bed." })).toBeNull();
    expect(parseArtStyleDevice({ device_structure: "a picture", device_text: "The dog takes the middle." })).toBeNull();
  });
});
