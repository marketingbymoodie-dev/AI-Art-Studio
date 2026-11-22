import { describe, expect, it } from "vitest";
import {
  coloursStillOffered,
  droppedSelectionNames,
  filterPricesToSizes,
  variantKeyIsOffered,
  variantMatchesDroppedSelection,
} from "./variantSelection";

const comfortSizes = [
  { id: "s", name: "S" },
  { id: "m", name: "M" },
  { id: "l", name: "L" },
  { id: "xl", name: "XL" },
  { id: "2xl", name: "2XL" },
  { id: "3xl", name: "3XL" },
  { id: "4xl", name: "4XL" },
];
const offered = ["s", "m", "l", "xl", "2xl", "3xl"];
const colors = [{ id: "bay", name: "Bay" }, { id: "black", name: "Black" }];

describe("variant selection", () => {
  it("drops an unticked size and keeps the rest", () => {
    expect(variantKeyIsOffered("4xl:bay", comfortSizes, colors, offered, ["bay", "black"])).toBe(false);
    expect(variantKeyIsOffered("3xl:black", comfortSizes, colors, offered, ["bay", "black"])).toBe(true);
    expect(droppedSelectionNames(comfortSizes, offered)).toEqual(["4XL"]);
  });

  it("keeps every size when nothing has been unticked", () => {
    expect(variantKeyIsOffered("4xl:bay", comfortSizes, colors, [], [])).toBe(true);
    expect(droppedSelectionNames(comfortSizes, [])).toEqual([]);
  });

  it("does not wipe a catalogue when the saved ids match nothing", () => {
    expect(variantKeyIsOffered("4xl:bay", comfortSizes, colors, ["14x14"], ["nope"])).toBe(true);
    expect(droppedSelectionNames(comfortSizes, ["14x14"])).toEqual([]);
  });

  it("matches a live Shopify variant by the unticked option value", () => {
    expect(variantMatchesDroppedSelection(
      [{ name: "Size", value: "4XL" }, { name: "Color", value: "Bay" }, { name: "Print sides", value: "Front" }],
      ["4XL"],
      [],
    )).toBe(true);
    expect(variantMatchesDroppedSelection(
      [{ name: "Size", value: "3XL" }, { name: "Color", value: "Bay" }],
      ["4XL"],
      [],
    )).toBe(false);
    expect(variantMatchesDroppedSelection(
      [{ name: "Print sides", value: "Front" }],
      ["Front"],
      [],
    )).toBe(false);
  });

  it("keeps a studio colour unless that colour was unticked", () => {
    const colours = [{ name: "Bay" }, { name: "Black" }];
    expect(coloursStillOffered(colours, colors, ["black"])).toEqual([{ name: "Black" }]);
    expect(coloursStillOffered(colours, colors, [])).toEqual(colours);
  });

  it("hides an unticked size from studio prices", () => {
    const filtered = filterPricesToSizes({
      sizes: ["S", "4XL"],
      pricesBySize: { S: "29.95", "4XL": "32.95" },
      compareAtBySize: { "4XL": "40.00" },
    }, ["S", "M", "L", "XL", "2XL", "3XL"]);
    expect(filtered.sizes).toEqual(["S"]);
    expect(filtered.pricesBySize).toEqual({ S: "29.95" });
    expect(filtered.compareAtBySize).toEqual({});
  });
});
