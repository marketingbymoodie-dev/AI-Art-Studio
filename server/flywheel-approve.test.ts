import { describe, expect, it } from "vitest";
import { requireRecipe, type ApprovalRecipe } from "./catalogue-approval";

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
