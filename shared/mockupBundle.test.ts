import { describe, expect, it } from "vitest";
import { mockupSheetMarks, parseMockupImport, printifyColorIdForMockup, sceneMedian } from "./mockupBundle";

describe("mockup folder import", () => {
  it("reads the scene from the folder and the colour from the hex", () => {
    const plan = parseMockupImport([
      "Petposterous_Mockups/Mockup_01/Mockup_01_FFFFFF_original.jpeg",
      "Petposterous_Mockups/Mockup_01/Mockup_01_FFFFFF.png",
      "Petposterous_Mockups/Mockup_01/Mockup_01_819E87.png",
      "Petposterous_Mockups/Mockup_01/Mockup_01_0077B5.png",
      "Petposterous_Mockups/Mockup_02/Mockup_02_25282A.png",
    ]);
    expect(plan.rows.map((row) => [row.panelId, row.hex, row.garmentColor, row.kind])).toEqual([
      ["Mockup_01", "0077B5", "Blue", "produced"],
      ["Mockup_01", "819E87", "Sage", "produced"],
      ["Mockup_01", "FFFFFF", "White", "white-master"],
      ["Mockup_02", "25282A", "Black", "produced"],
    ]);
    expect(plan.problems.map((problem) => problem.message)).toEqual(["Mockup_02 has no FFFFFF white master."]);
    expect(plan.notes[0]).toContain("left out");
  });

  it("maps each mockup hex to the Printify colour of that Gildan code", () => {
    expect(printifyColorIdForMockup("DD74A1")).toEqual({ title: "Azalea", colorId: "azalea" });
    expect(printifyColorIdForMockup("97999B")).toEqual({ title: "Sport Grey", colorId: "sport_grey" });
    expect(printifyColorIdForMockup("66676C")).toEqual({ title: "Charcoal", colorId: "charcoal" });
    expect(printifyColorIdForMockup("AC2B37")).toEqual({ title: "Cherry Red", colorId: "cherry_red" });
    expect(printifyColorIdForMockup("0077B5")).toEqual({ title: "Sapphire", colorId: "sapphire" });
    expect(printifyColorIdForMockup("FFFFFF")?.colorId).toBe("white");
    expect(printifyColorIdForMockup("25282A")?.colorId).toBe("black");
    expect(printifyColorIdForMockup("819E87")?.colorId).toBe("sage");
    expect(printifyColorIdForMockup("FFB6C1")).toBeNull();
  });

  it("refuses a second file with the same hex in one scene", () => {
    const plan = parseMockupImport([
      "Mockup_03/Mockup_03_AC2B37.png",
      "Mockup_03/extra/Mockup_03_AC2B37.png",
    ]);
    expect(plan.rows).toHaveLength(1);
    expect(plan.problems[0].message).toContain("already");
  });

  it("marks area and a second region, and ignores a full-bleed edge", () => {
    const median = sceneMedian([0.5, 0.58, 0.62]);
    expect(mockupSheetMarks({ error: "", areaFraction: 0.58, disconnected: false }, median)).toEqual([]);
    expect(mockupSheetMarks({ error: "", areaFraction: 0.78, disconnected: false }, median)).toEqual(["area far from this scene"]);
    expect(mockupSheetMarks({ error: "", areaFraction: 0.58, disconnected: true }, median)).toEqual(["disconnected"]);
    expect(mockupSheetMarks({ error: "not stored", areaFraction: 0, disconnected: false }, median)).toEqual(["Failed: not stored"]);
  });
});
