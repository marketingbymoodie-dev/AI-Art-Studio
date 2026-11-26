import { describe, expect, it } from "vitest";
import { recipeGaps, requireRecipe, type ApprovalRecipe } from "./catalogue-approval";

const imported: ApprovalRecipe = {
  candidateId: "aa1b262b-68ad-4762-82dc-e539cf6b08bf",
  panelId: "Mockup_01",
  selectedColors: [{ name: "White", hex: "FFFFFF" }],
  artStyle: "retro-character",
  species: "boxer dog",
  humourOperator: "pp-sleep-warfare",
  punchline: "Round one",
  behaviour: "",
  funnyTruth: "The dog stays in the ring.",
  deviceText: "The dog is drawn flat.",
  deviceStructure: "",
  darknessLevel: 0,
  title: "Round one",
};

describe("catalogue approval fields", () => {
  it("does not require generation fields on a catalogue import", () => {
    const checked = requireRecipe(imported, "manual");
    expect(checked.structure).toBe("");
    expect(checked.behaviour).toBe("");
    expect(checked.darkness).toBe(0);
  });

  it("lists every missing import field before any of them is spent on", () => {
    const gaps = recipeGaps({
      ...imported,
      artStyle: "",
      species: "",
      humourOperator: "",
      funnyTruth: "",
      deviceText: "",
      panelId: "",
      selectedColors: [],
    }, "manual");
    expect(gaps).toEqual([
      "Style is not stored. Approval needs a launch style.",
      "Species is not stored.",
      "Humour operator is not stored.",
      "Truth is not stored.",
      "Device is not stored.",
      "Scene is not stored.",
      "No colours selected.",
    ]);
  });

  it("still requires device structure, behaviour, and darkness on a generated candidate", () => {
    expect(() => requireRecipe(imported, "generated")).toThrow(/Device structure is not stored/);
    expect(() => requireRecipe({ ...imported, deviceStructure: "occupied_territory" }, "generated")).toThrow(/Darkness is not stored/);
    expect(() => requireRecipe({
      ...imported,
      deviceStructure: "occupied_territory",
      darknessLevel: 2,
    }, "generated")).toThrow(/Behaviour is not stored/);
  });
});
