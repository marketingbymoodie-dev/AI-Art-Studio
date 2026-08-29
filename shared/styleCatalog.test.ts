import { describe, expect, it } from "vitest";
import { APPAREL_CHROMA_STYLE_BY_NAME } from "./apparel-chroma-prompts";
import { apparelChromaStyleLayerForCatalogSlug } from "./promptLayers";
import { inferCatalogSlug, resolveCatalogSlug, findCatalogPreset } from "./styleCatalog";

describe("style catalog identity", () => {
  it("resolves Opinionated after a display rename", () => {
    expect(inferCatalogSlug("Opinionated", "apparel")).toBe("opinionated");
    expect(inferCatalogSlug("Opinionated Text", "apparel")).toBe("opinionated");
    expect(resolveCatalogSlug({ catalogSlug: "opinionated", name: "Steve" })).toBe("opinionated");
    expect(findCatalogPreset({ catalogSlug: "opinionated", name: "Anything" })?.id).toBe(
      "opinionated",
    );
    expect(findCatalogPreset({ name: "Opinionated Text", category: "apparel" })?.id).toBe(
      "opinionated",
    );
  });

  it("does not treat a custom style as Opinionated just because the name matches a word", () => {
    expect(inferCatalogSlug("My Custom Tee", "apparel")).toBeNull();
    expect(resolveCatalogSlug({ name: "My Custom Tee", category: "apparel" })).toBeNull();
  });

  it("disambiguates Pet Portraits by category", () => {
    expect(inferCatalogSlug("Pet Portraits", "apparel")).toBe("pet-portraits");
    expect(inferCatalogSlug("Pet Portraits", "decor")).toBe("pet-portraits-decor");
  });
});

describe("apparel chroma reseed key", () => {
  it("maps apparel Pet Portraits slug and ignores decor slug / bare name", () => {
    expect(apparelChromaStyleLayerForCatalogSlug("pet-portraits")).toBe(
      APPAREL_CHROMA_STYLE_BY_NAME["pet portraits"],
    );
    expect(apparelChromaStyleLayerForCatalogSlug("pet-portraits-decor")).toBeUndefined();
    expect(apparelChromaStyleLayerForCatalogSlug("pet portraits")).toBeUndefined();
  });
});
