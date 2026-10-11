import { describe, expect, it } from "vitest";
import { artStyleProfile } from "@shared/petposterousArtStyleProfiles";
import { ART_STYLE_DEVICE_BINDING, artStyleDeviceSystem, artStyleDeviceUserMessage, deviceContradictsSpecies, parseArtStyleDevice, parseArtStyleTruths, suppliedWordingFromBehaviour } from "./art-style-writers";

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

  it("keeps supplied wording on every idea and rejects a device that changes the animal", () => {
    expect(suppliedWordingFromBehaviour("He's got a toilet seat stuck around his neck. Text reads: How was your day")).toEqual({
      situation: "He's got a toilet seat stuck around his neck",
      wording: "How was your day",
    });
    expect(suppliedWordingFromBehaviour("He's got a toilet seat stuck around his neck. Text says How was your day?")).toEqual({
      situation: "He's got a toilet seat stuck around his neck",
      wording: "How was your day?",
    });
    const locked = parseArtStyleTruths({
      options: [option, { ...option, punchline: "Nailed it" }, { ...option, funny_truth: "she considers the sofa hers", punchline: "How was your day" }],
    }, "How was your day");
    expect(locked?.map((row) => row.punchline)).toEqual(["How was your day", "How was your day", "How was your day"]);
    expect(deviceContradictsSpecies("A cat silhouette mid-air, launched from a tipped glass.", "dog")).toBe(true);
    expect(deviceContradictsSpecies("A dog wearing the seat, inked in pen lines.", "dog")).toBe(false);
  });

  it("sends the original behaviour and the species in the device prompt", () => {
    const behaviour = "He's got a toilet seat stuck around his neck. Text reads: How was your day";
    const message = artStyleDeviceUserMessage({
      behaviour,
      truth: "he escalated the situation faster than anyone could intervene",
      words: "How was your day",
      species: "dog",
      styleLabel: "Pen & Ink",
      surfaceLine: "Apparel: one subject, a strong silhouette.",
    });
    expect(message).toContain("BEHAVIOUR: " + behaviour);
    expect(message).toContain("TRUTH: he escalated the situation faster than anyone could intervene");
    expect(message).toContain("WORDS: How was your day");
    expect(message).toContain("SPECIES: dog");
    expect(message).not.toContain("the truth above");
    const system = artStyleDeviceSystem(artStyleProfile("pen-ink")!, "apparel");
    expect(system).toContain(ART_STYLE_DEVICE_BINDING);
    expect(system).toContain("Do not repeat it, quote it, or describe how it appears.");
    expect(system).toContain("NAME THE OBJECT, THEN COMPARE IT.");
    expect(system).toContain("a reader who does not know the joke");
    expect(system).toContain("POSE IS THE PERFORMANCE.");
    expect(system).toContain("deadpan front-on stare is itself the joke");
    expect(system).not.toContain("they are the only lettering");
  });
});
