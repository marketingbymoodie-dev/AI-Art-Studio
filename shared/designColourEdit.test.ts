import { describe, expect, it } from "vitest";
import { diffColourNames, scenesMissingApprovedBlank, type SceneBlank } from "./designColourEdit";

const scenes: SceneBlank[] = [
  { panelId: "Mockup_01", label: "Mockup_01", colours: [{ name: "Red", kind: "produced" }, { name: "White", kind: "white-master" }] },
  { panelId: "Mockup_02", label: "Mockup_02", colours: [{ name: "White", kind: "white-master" }] },
];

describe("design colour edit", () => {
  it("ticks the live colours and names the ones to add or remove", () => {
    expect(diffColourNames(["White", "Black"], ["White", "Red"])).toEqual({
      add: ["Red"],
      remove: ["Black"],
    });
  });

  it("names every scene that has no approved blank for the colour", () => {
    expect(scenesMissingApprovedBlank(scenes, "Red").map((scene) => scene.label)).toEqual(["Mockup_02"]);
    expect(scenesMissingApprovedBlank(scenes, "White")).toEqual([]);
  });
});
