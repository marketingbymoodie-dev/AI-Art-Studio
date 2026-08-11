import { describe, expect, it } from "vitest";
import { buildCatalogVariantAxes } from "./platform-catalogue-pi";

describe("buildCatalogVariantAxes", () => {
  it("builds size/color map from catalog options", () => {
    const axes = buildCatalogVariantAxes([
      { id: 11, options: { size: "S", color: "Black" }, title: "S / Black" },
      { id: 12, options: { size: "M", color: "Black" }, title: "M / Black" },
      { id: 13, options: { size: "S", color: "White" }, title: "S / White" },
    ]);
    expect(axes.sizes.map((s) => s.name).sort()).toEqual(["M", "S"]);
    expect(axes.colors.map((c) => c.name).sort()).toEqual(["Black", "White"]);
    expect(Object.keys(axes.variantMap).length).toBe(3);
    expect(axes.variantMap["s:black"]?.printifyVariantId).toBe(11);
  });

  it("parses title when options missing", () => {
    const axes = buildCatalogVariantAxes([{ id: 99, title: "L / Storm Grey", options: {} }]);
    expect(axes.sizes[0]?.name).toBe("L");
    expect(axes.colors[0]?.name).toBe("Storm Grey");
    expect(axes.variantMap["l:storm-grey"]?.printifyVariantId).toBe(99);
  });
});
