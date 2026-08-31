import { describe, expect, it } from "vitest";
import { collapseStyleNameTwins } from "./customizerPageStyles";
import {
  coerceStyleHint,
  findStylePresetForFill,
  resolveSelectableStylePreset,
} from "./resolveStylePresetForUi";

const apparelTwin = {
  id: 42,
  name: "Centered Graphic",
  category: "apparel" as const,
  catalogSlug: "centered-graphic",
};
const graphicsTwin = {
  id: "99",
  name: "Centered Graphic (Graphics)",
  category: "graphics" as const,
  catalogSlug: "graphics-centered-graphic",
};
const watercolor = {
  id: "7",
  name: "Watercolor",
  category: "decor" as const,
  catalogSlug: "watercolor",
};

describe("coerceStyleHint", () => {
  it("stringifies numeric JSON ids", () => {
    expect(coerceStyleHint(42)).toBe("42");
    expect(coerceStyleHint("  99  ")).toBe("99");
    expect(coerceStyleHint(null)).toBe("");
  });
});

describe("findStylePresetForFill", () => {
  const options = [
    { ...graphicsTwin },
    { ...watercolor, id: "7" },
  ];

  it("matches a numeric JSON id to a string option id", () => {
    expect(findStylePresetForFill(options, 99)?.id).toBe("99");
    expect(findStylePresetForFill(options, "99")?.id).toBe("99");
  });

  it("matches a catalog slug to the merchant option", () => {
    expect(findStylePresetForFill(options, "centered-graphic")?.id).toBe("99");
    expect(findStylePresetForFill(options, "graphics-centered-graphic")?.id).toBe("99");
  });

  it("matches a display name including the Graphics suffix", () => {
    expect(findStylePresetForFill(options, "Centered Graphic")?.id).toBe("99");
  });

  it("matches a renamed option with no catalogSlug via saved slug → catalog name", () => {
    const renamed = {
      id: "55",
      name: "Centered Graphic",
      category: "all" as const,
      catalogSlug: null,
    };
    expect(findStylePresetForFill([renamed], "centered-graphic")?.id).toBe("55");
  });
});

describe("resolveSelectableStylePreset", () => {
  const pool = [apparelTwin, graphicsTwin, watercolor];
  const selectable = collapseStyleNameTwins(
    pool.map((p) => ({ ...p, id: String(p.id) })),
    "generic",
  );

  it("returns the surviving graphics twin when the saved id is the dropped apparel twin", () => {
    const hit = resolveSelectableStylePreset(
      selectable,
      { stylePreset: 42 },
      { pool },
    );
    expect(hit?.id).toBe("99");
  });

  it("returns a real selectable id for a saved catalog slug", () => {
    const hit = resolveSelectableStylePreset(selectable, {
      stylePreset: "centered-graphic",
      catalogSlug: "centered-graphic",
      styleName: "Centered Graphic",
    });
    expect(hit?.id).toBe("99");
  });

  it("resolves a renamed style using job catalogSlug + styleName", () => {
    const renamed = {
      id: "88",
      name: "Bold Centered",
      category: "all" as const,
      catalogSlug: null,
    };
    const hit = resolveSelectableStylePreset(
      [renamed],
      {
        stylePreset: "centered-graphic",
        catalogSlug: "centered-graphic",
        styleName: "Bold Centered",
      },
    );
    expect(hit?.id).toBe("88");
  });

  it("returns undefined when nothing maps (caller should log)", () => {
    expect(
      resolveSelectableStylePreset(selectable, { stylePreset: "not-a-style" }),
    ).toBeUndefined();
  });
});
