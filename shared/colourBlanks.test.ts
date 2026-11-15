import { describe, expect, it } from "vitest";
import {
  SOFTSTYLE_COLOUR_SEED,
  blankNameMatch,
  colourMatchKeys,
  composeBlankChoice,
  describeColourUse,
  frameColourHidden,
  normaliseBlankHex,
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
