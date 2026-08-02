import { describe, expect, it } from "vitest";
import { mergeNewlyAppearedSelectionIds } from "./printifyCatalogSelection";

describe("mergeNewlyAppearedSelectionIds", () => {
  it("adopts all refreshed ids when selection was empty", () => {
    expect(
      mergeNewlyAppearedSelectionIds({
        existingSelectedIds: [],
        previousOptionIds: ["white_red", "black_red"],
        refreshedOptionIds: ["white_red", "black_red", "white_black"],
      }),
    ).toEqual(["white_red", "black_red", "white_black"]);
  });

  it("auto-adds newly appeared colors while preserving deselections", () => {
    expect(
      mergeNewlyAppearedSelectionIds({
        existingSelectedIds: ["white_red", "black_red"],
        previousOptionIds: ["white_red", "black_red", "deep_heather_black"],
        refreshedOptionIds: ["white_red", "black_red", "deep_heather_black", "white_black"],
      }),
    ).toEqual(["white_red", "black_red", "white_black"]);
  });

  it("drops stale selected ids that left the catalog", () => {
    expect(
      mergeNewlyAppearedSelectionIds({
        existingSelectedIds: ["white_red", "gone"],
        previousOptionIds: ["white_red", "gone"],
        refreshedOptionIds: ["white_red", "white_black"],
      }),
    ).toEqual(["white_red", "white_black"]);
  });
});
