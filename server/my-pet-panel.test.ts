import { describe, expect, it } from "vitest";
import { chooseMyPetPanelId, myPetCompositeColours, resolveMyPetCompositeColor, type MyPetColourPalette } from "./my-pet-panel";

const comfort = "comfort-colours-1717-white-hex-ffffff-colour";

describe("chooseMyPetPanelId", () => {
  it("keeps the candidate panel when that scene exists on the product type", () => {
    expect(chooseMyPetPanelId(comfort, [
      { panelId: comfort, isDefault: true, kind: "white-master" },
      { panelId: comfort, isDefault: true, kind: "produced" },
    ])).toBe(comfort);
  });

  it("does not reuse a panel that belongs to another type", () => {
    expect(chooseMyPetPanelId(comfort, [
      { panelId: "Mockup_02", isDefault: false, kind: "white-master" },
      { panelId: "Mockup_01", isDefault: true, kind: "white-master" },
      { panelId: "Mockup_01", isDefault: true, kind: "produced" },
    ])).toBe("Mockup_01");
  });

  it("falls back to the type's white master when nothing is marked default", () => {
    expect(chooseMyPetPanelId(comfort, [
      { panelId: "Mockup_08", kind: "white-master" },
      { panelId: "Mockup_01", kind: "produced" },
    ])).toBe("Mockup_08");
  });

  it("returns null when the product type has no scenes", () => {
    expect(chooseMyPetPanelId(comfort, [])).toBeNull();
  });
});

const softstyleScene = [
  { name: "White", hex: "FFFFFF" },
  { name: "Sport Grey", hex: "97999B" },
  { name: "Black", hex: "000000" },
];

function palette(overrides: Partial<MyPetColourPalette> = {}): MyPetColourPalette {
  return {
    requestedName: "Sport Grey",
    publishTicks: ["White", "Black", "Sport Grey", "Navy"],
    sceneColours: softstyleScene,
    libraryColours: [{ name: "Sport Grey", hex: "CACACA" }],
    selectedColors: [
      { name: "White", hex: "FFFFFF" },
      { name: "Bay", hex: "94A596" },
    ],
    ...overrides,
  };
}

describe("resolveMyPetCompositeColor", () => {
  it("uses the Softstyle scene hex when the shared colour list is Comfort Colors", () => {
    expect(resolveMyPetCompositeColor(palette())).toEqual({ name: "Sport Grey", hex: "97999B" });
  });

  it("does not replace an unknown colour with the first shared colour", () => {
    expect(resolveMyPetCompositeColor(palette({ requestedName: "Bay" }))).toBeNull();
  });

  it("uses this type's first tick when the shopper has not picked a colour", () => {
    expect(resolveMyPetCompositeColor(palette({
      requestedName: "",
      publishTicks: ["Sport Grey"],
      selectedColors: [{ name: "Bay", hex: "94A596" }],
    }))).toEqual({ name: "Sport Grey", hex: "97999B" });
  });

  it("keeps a Comfort Colors colour that this type actually has", () => {
    expect(resolveMyPetCompositeColor(palette({
      requestedName: "Bay",
      publishTicks: ["Black", "Bay", "Grey"],
      sceneColours: [{ name: "Bay", hex: "94A596" }, { name: "Grey", hex: "716E6A" }],
      libraryColours: [],
      selectedColors: [{ name: "White", hex: "FFFFFF" }, { name: "Sport Grey", hex: "97999B" }],
    }))).toEqual({ name: "Bay", hex: "94A596" });
  });

  it("precomposes the ticked colours and leaves the other shirt's colours out", () => {
    expect(myPetCompositeColours(palette()).map((color) => color.name)).toEqual(["White", "Black", "Sport Grey"]);
  });

  it("precomposes a scene colour the shopper picked when this type has no ticks", () => {
    const colours = myPetCompositeColours(palette({
      publishTicks: [],
      selectedColors: [{ name: "Bay", hex: "94A596" }, { name: "Black", hex: "25282A" }],
    }));
    expect(colours.map((color) => color.name)).toEqual(["Black", "Sport Grey"]);
  });
});
