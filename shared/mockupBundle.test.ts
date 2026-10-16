import { describe, expect, it } from "vitest";
import { parseMockupImport } from "./mockupBundle";

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

  it("refuses a second file with the same hex in one scene", () => {
    const plan = parseMockupImport([
      "Mockup_03/Mockup_03_AC2B37.png",
      "Mockup_03/extra/Mockup_03_AC2B37.png",
    ]);
    expect(plan.rows).toHaveLength(1);
    expect(plan.problems[0].message).toContain("already");
  });
});
