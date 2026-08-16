import { describe, expect, it } from "vitest";
import {
  filterStylePresetsForPage,
  parseCustomizerPageStyleConfig,
  styleExampleImageUrl,
  stylesForCustomizerPagePicker,
} from "./customizerPageStyles";
import {
  selectableCategoriesForDesignerType,
  styleMatchesSelectableCategories,
} from "./styleCategories";

describe("selectableCategoriesForDesignerType", () => {
  it("offers decor + graphics for pillow products", () => {
    expect(selectableCategoriesForDesignerType("pillow")).toEqual(["decor", "graphics"]);
  });

  it("offers apparel only for apparel products", () => {
    expect(selectableCategoriesForDesignerType("apparel")).toEqual(["apparel"]);
  });

  it("offers all categories for generic products", () => {
    expect(selectableCategoriesForDesignerType("generic")).toBe("all");
  });
});

describe("styleMatchesSelectableCategories", () => {
  const presets = [
    { id: "1", name: "Watercolor", category: "decor" },
    { id: "2", name: "Centered Graphic (Graphics)", category: "graphics" },
    { id: "3", name: "Quotes", category: "apparel" },
  ];

  it("includes decor and graphics for pillow selectable set", () => {
    const selectable = selectableCategoriesForDesignerType("pillow");
    const matched = presets.filter((p) => styleMatchesSelectableCategories(p, selectable));
    expect(matched.map((p) => p.category)).toEqual(["decor", "graphics"]);
  });
});

describe("filterStylePresetsForPage", () => {
  const presets = [
    { id: "w", name: "Watercolor", category: "decor" },
    { id: "g", name: "Motif", category: "graphics" },
    { id: "a", name: "Quotes", category: "apparel" },
  ];

  it("parses graphics category bundle", () => {
    const cfg = parseCustomizerPageStyleConfig({ mode: "category", category: "graphics" });
    expect(cfg).toEqual({ mode: "category", category: "graphics" });
    expect(filterStylePresetsForPage(presets, cfg)).toEqual([presets[1]]);
  });

  const twins = [
    { id: "cg-apparel", name: "Centered Graphic", category: "apparel" },
    { id: "cg-graphics", name: "Centered Graphic (Graphics)", category: "graphics" },
    { id: "im-apparel", name: "Illustrated Motif", category: "apparel" },
    { id: "im-graphics", name: "Illustrated Motif (Graphics)", category: "graphics" },
    { id: "pm-apparel", name: "Pattern Maker", category: "apparel" },
    { id: "pm-graphics", name: "Pattern Maker (Graphics)", category: "graphics" },
    { id: "quotes", name: "Quotes", category: "apparel" },
  ];

  it("collapses apparel/graphics twins on phone-case (generic) pages and keeps Graphics", () => {
    const cfg = parseCustomizerPageStyleConfig({ mode: "category", category: "all" });
    const shown = filterStylePresetsForPage(twins, cfg, "generic");
    expect(shown.map((s) => s.id)).toEqual([
      "cg-graphics",
      "im-graphics",
      "pm-graphics",
      "quotes",
    ]);
  });

  it("keeps the apparel twin on apparel pages", () => {
    const cfg = parseCustomizerPageStyleConfig({ mode: "category", category: "all" });
    const shown = filterStylePresetsForPage(twins, cfg, "apparel");
    expect(shown.map((s) => s.id)).toEqual([
      "cg-apparel",
      "im-apparel",
      "pm-apparel",
      "quotes",
    ]);
  });

  it("collapses twins even when both IDs were saved on the page", () => {
    const cfg = parseCustomizerPageStyleConfig({
      mode: "selected",
      presetIds: ["cg-apparel", "cg-graphics", "quotes"],
    });
    const shown = filterStylePresetsForPage(twins, cfg, "generic");
    expect(shown.map((s) => s.id)).toEqual(["cg-graphics", "quotes"]);
  });
});

describe("stylesForCustomizerPagePicker", () => {
  const presets = [
    { id: "w", name: "Watercolor", category: "decor" },
    { id: "g", name: "Motif", category: "graphics" },
    { id: "a", name: "Quotes", category: "apparel" },
  ];

  it("lists every category for apparel / AOP custom selections", () => {
    expect(stylesForCustomizerPagePicker(presets, "apparel")).toEqual(presets);
    expect(stylesForCustomizerPagePicker(presets, "all-over-print")).toEqual(presets);
  });
});

describe("styleExampleImageUrl", () => {
  it("prefers the first style reference image", () => {
    expect(
      styleExampleImageUrl({
        baseImageUrl: "https://legacy.example/one.jpg",
        baseImageUrls: ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"],
      }),
    ).toBe("https://cdn.example/a.jpg");
  });

  it("falls back to a sub-style image when the style has none", () => {
    expect(
      styleExampleImageUrl({
        options: {
          choices: [{ baseImageUrl: "https://cdn.example/king.jpg" }],
        },
      }),
    ).toBe("https://cdn.example/king.jpg");
  });

  it("returns null when no pictorial example exists", () => {
    expect(styleExampleImageUrl({})).toBeNull();
  });
});
