import { describe, expect, it } from "vitest";
import { buildActivePrintifyVariantLabels, extractSelectedPrintifyVariantIds } from "./printifyVariantLabels";

describe("buildActivePrintifyVariantLabels", () => {
  it("builds Size / Color labels from a stringified variantMap", () => {
    const labels = buildActivePrintifyVariantLabels({
      variantMap: JSON.stringify({
        "s:heather-grey": { printifyVariantId: 111 },
        "m:heather-grey": { printifyVariantId: 112 },
      }),
      sizes: JSON.stringify([{ id: "s", name: "S" }, { id: "m", name: "M" }]),
      frameColors: JSON.stringify([{ id: "heather-grey", name: "Heather Grey" }]),
    });
    expect(labels).toEqual({
      "111": "S / Heather Grey",
      "112": "M / Heather Grey",
    });
  });

  it("uses just the size name when there is no color axis", () => {
    const labels = buildActivePrintifyVariantLabels({
      variantMap: { "s:default": { printifyVariantId: 5 } },
      sizes: [{ id: "s", name: "S" }],
      frameColors: [],
    });
    expect(labels).toEqual({ "5": "S" });
  });

  it("filters to selectedSizeIds/selectedColorIds when set", () => {
    const labels = buildActivePrintifyVariantLabels({
      variantMap: {
        "s:black": { printifyVariantId: 1 },
        "s:white": { printifyVariantId: 2 },
        "m:black": { printifyVariantId: 3 },
      },
      sizes: [{ id: "s", name: "S" }, { id: "m", name: "M" }],
      frameColors: [{ id: "black", name: "Black" }, { id: "white", name: "White" }],
      selectedSizeIds: ["s"],
      selectedColorIds: ["black"],
    });
    expect(labels).toEqual({ "1": "S / Black" });
  });

  it("skips entries without a printifyVariantId", () => {
    const labels = buildActivePrintifyVariantLabels({
      variantMap: { "s:black": {} },
      sizes: [{ id: "s", name: "S" }],
      frameColors: [{ id: "black", name: "Black" }],
    });
    expect(labels).toEqual({});
  });
});

describe("extractSelectedPrintifyVariantIds", () => {
  it("returns numeric printify variant ids", () => {
    const ids = extractSelectedPrintifyVariantIds({
      variantMap: {
        "s:black": { printifyVariantId: 1 },
        "m:black": { printifyVariantId: 2 },
      },
      sizes: [{ id: "s", name: "S" }, { id: "m", name: "M" }],
      frameColors: [{ id: "black", name: "Black" }],
    });
    expect(ids.sort()).toEqual([1, 2]);
  });
});
