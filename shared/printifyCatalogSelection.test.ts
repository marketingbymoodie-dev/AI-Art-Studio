import { describe, expect, it } from "vitest";
import {
  colorIdsWithInStockVariants,
  mergeNewlyAppearedSelectionIds,
} from "./printifyCatalogSelection";

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

  it("does not auto-select newly appeared ids omitted from autoSelectNewlyAppearedIds", () => {
    expect(
      mergeNewlyAppearedSelectionIds({
        existingSelectedIds: ["white_red", "black_red"],
        previousOptionIds: ["white_red", "black_red"],
        refreshedOptionIds: ["white_red", "black_red", "white_black", "deep_heather_black"],
        autoSelectNewlyAppearedIds: [], // both new colors fully OOS
      }),
    ).toEqual(["white_red", "black_red"]);
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

describe("colorIdsWithInStockVariants", () => {
  it("returns only colors with an in-stock printify variant", () => {
    expect(
      colorIdsWithInStockVariants({
        variantMap: {
          "s:white_red": { printifyVariantId: 1 },
          "m:white_red": { printifyVariantId: 2 },
          "s:deep_heather_black": { printifyVariantId: 3 },
          "s:white_black": { printifyVariantId: 4 },
        },
        inStockVariantIds: [1, 2],
      }),
    ).toEqual(["white_red"]);
  });
});
