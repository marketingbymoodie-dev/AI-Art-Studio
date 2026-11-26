import { describe, expect, it } from "vitest";
import {
  SOFTSTYLE_COLOUR_SEED,
  blankNameMatch,
  colourMatchKeys,
  composeBlankChoice,
  newestUploadedBlank,
  listedSceneColours,
  describeColourUse,
  inUseBlankKind,
  frameColourHidden,
  normaliseBlankHex,
  publishColourScene,
  resolvePublishPanelId,
} from "./colourBlanks";

describe("softstyle colour seed", () => {
  it("seeds the ten Choice colours and keeps heather off the paint path", () => {
    expect(SOFTSTYLE_COLOUR_SEED.map((row) => row.name)).toEqual([
      "White", "Black", "Sport Grey", "Light Blue", "Military Green",
      "Natural", "Navy", "Red", "Royal", "Dark Heather",
    ]);
    expect(SOFTSTYLE_COLOUR_SEED.find((row) => row.name === "Sport Grey")).toMatchObject({
      printifyOptionId: 358,
      hex: "CACACA",
      finish: "heather",
      linkStoredName: "Light grey",
    });
    expect(SOFTSTYLE_COLOUR_SEED.find((row) => row.name === "Dark Heather")?.finish).toBe("heather");
    expect(SOFTSTYLE_COLOUR_SEED.filter((row) => row.finish === "solid")).toHaveLength(8);
  });

  it("matches an exact stored name and only then a suggested link", () => {
    expect(blankNameMatch("Sport Grey", "Light grey", ["Light grey", "White"]).state).toBe("name-mismatch");
    expect(blankNameMatch("Sport Grey", "Light grey", ["Sport Grey", "Light grey"])).toEqual({ state: "present" });
    expect(blankNameMatch("Light Blue", null, ["White"])).toEqual({ state: "missing" });
    expect(normaliseBlankHex("#d6e6f7")).toBe("D6E6F7");
  });

  it("uses the newest exact name and otherwise the white master", () => {
    const rows = [
      { id: "new", name: "Light Blue", hex: "D6E6F7", kind: "produced" as const },
      { id: "old", name: "Light Blue", hex: "AAAAAA", kind: "produced" as const },
      { id: "white", name: "White", hex: "FFFFFF", kind: "white-master" as const },
    ];
    expect(composeBlankChoice(rows, "Light Blue").rowId).toBe("new");
    expect(composeBlankChoice(rows, "White").mode).toBe("produced");
    expect(composeBlankChoice(rows, "Navy")).toEqual({ mode: "recolour", sourceName: "White", rowId: "white" });
    expect(composeBlankChoice([], "Navy").mode).toBe("unavailable");
  });

  it("drops test colour names that are not on the active list", () => {
    const stored = [
      { name: "Black" },
      { name: "Blue" },
      { name: "Sport Grey" },
      { name: "Pink" },
      { name: "Dark Heather" },
    ];
    expect(listedSceneColours(stored, ["White", "Black", "Sport Grey", "Dark Heather"]).map((row) => row.name)).toEqual([
      "Black",
      "Sport Grey",
      "Dark Heather",
    ]);
    expect(listedSceneColours(stored, []).map((row) => row.name)).toEqual(stored.map((row) => row.name));
  });

  it("treats a colour's own white master as an approved blank and not a recolour", () => {
    const panels = [
      { panelId: "front", name: "White", kind: "white-master" },
      { panelId: "front", name: "White", kind: "produced" },
      { panelId: "front", name: "Black", kind: "produced" },
      { panelId: "back", name: "Bay", kind: "produced" },
    ];
    expect(inUseBlankKind(panels, "White")).toBe("white-master");
    expect(inUseBlankKind(panels, "Black")).toBe("produced");
    expect(inUseBlankKind(panels, "Bay")).toBe("produced");
    expect(inUseBlankKind(panels, "Navy")).toBeNull();
  });

  it("uses the approved stored blank and blocks a colour that was never stored", () => {
    const rows = [
      { name: "Black", kind: "produced", maskSource: "copied-from-white" },
      { name: "Black", kind: "produced", maskSource: "scene-reference" },
      { name: "Light Blue", kind: "produced", maskSource: "painted" },
      { name: "White", kind: "produced", maskSource: "copied-from-white" },
      { name: "White", kind: "white-master", maskSource: "scene-reference" },
      { name: "Sport Grey", kind: "produced", maskSource: "copied-from-white" },
      { name: "Light grey", kind: "produced", maskSource: "scene-reference" },
    ];
    expect(newestUploadedBlank(rows, "Black")?.maskSource).toBe("scene-reference");
    expect(newestUploadedBlank(rows, "Light Blue")?.maskSource).toBe("painted");
    expect(newestUploadedBlank(rows, "White")?.maskSource).toBe("scene-reference");
    expect(newestUploadedBlank(rows, "Navy")).toBeNull();
    expect(newestUploadedBlank(rows, "Sport Grey")?.name).toBe("Sport Grey");
    expect(newestUploadedBlank(rows, "Royal", "Light grey")?.name).toBe("Light grey");
    expect(composeBlankChoice([
      { id: "paint", name: "Red", hex: "C00", kind: "produced", maskSource: "copied-from-white" },
      { id: "photo", name: "Red", hex: "C00", kind: "produced", maskSource: "scene-reference" },
    ], "Red").rowId).toBe("photo");
  });

  it("matches a colour name to its slug and says why it cannot be turned off", () => {
    expect(colourMatchKeys("Light Blue")).toEqual(["light blue", "light_blue", "light-blue"]);
    const hidden = new Set(colourMatchKeys("Pepper"));
    expect(frameColourHidden("Pepper", "pepper", hidden)).toBe(true);
    expect(frameColourHidden("White", "white", hidden)).toBe(false);
    expect(describeColourUse("Navy", ["Bed Etiquette"], [{ id: 1042, status: "pending" }])).toBe(
      'Navy is on the published product "Bed Etiquette" and open order #1042 (pending).',
    );
    expect(describeColourUse("White", [], [])).toBeNull();
  });
});

describe("publish scene for a colour", () => {
  const photographs = [
    { panelId: "scene-1", label: "Mockup_01" },
    { panelId: "scene-3", label: "Mockup_03" },
  ];

  it("uses the chosen scene when that colour has its photograph", () => {
    expect(resolvePublishPanelId("scene-1", [
      { panelId: "scene-3", isDefault: true },
      { panelId: "scene-1", isDefault: false },
    ])).toBe("scene-1");
    expect(publishColourScene("scene-1", "scene-1", photographs)).toEqual({
      panelId: "scene-1",
      label: "Mockup_01",
      fallback: false,
    });
  });

  it("names the other scene when the chosen one has no photograph for that colour", () => {
    const onlyLater = [{ panelId: "scene-3", label: "Mockup_03" }];
    expect(publishColourScene("scene-1", "scene-1", onlyLater)).toEqual({
      panelId: "scene-3",
      label: "Mockup_03",
      fallback: true,
    });
  });

  it("follows the garment default when the chosen scene is not on that garment", () => {
    const rows = [
      { panelId: "scene-9", isDefault: false },
      { panelId: "scene-3", isDefault: true },
    ];
    expect(resolvePublishPanelId("scene-1", rows)).toBe("scene-3");
    expect(publishColourScene("scene-1", "scene-3", photographs)?.label).toBe("Mockup_03");
    expect(publishColourScene("scene-1", "scene-3", photographs)?.fallback).toBe(true);
  });
});
