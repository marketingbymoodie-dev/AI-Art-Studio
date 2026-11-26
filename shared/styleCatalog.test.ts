import { describe, expect, it } from "vitest";
import { APPAREL_CHROMA_STYLE_BY_NAME } from "./apparel-chroma-prompts";
import { apparelChromaStyleLayerForCatalogSlug } from "./promptLayers";
import {
  inferCatalogSlug,
  resolveCatalogSlug,
  findCatalogPreset,
  isFloatingCatalogStyle,
  RETIRED_GRAPHICS_SLUG_TO_KEEPER,
} from "./styleCatalog";

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

  it("does not map minimal-line so reseed cannot smash the decor prefix", () => {
    expect(apparelChromaStyleLayerForCatalogSlug("minimal-line")).toBeUndefined();
  });
});

describe("retired Graphics twin slugs", () => {
  it("resolve to the All-types keeper", () => {
    expect(resolveCatalogSlug({ catalogSlug: "graphics-centered-graphic" })).toBe(
      "centered-graphic",
    );
    expect(inferCatalogSlug("Centered Graphic (Graphics)")).toBe("centered-graphic");
    expect(findCatalogPreset({ catalogSlug: "graphics-illustrated-motif" })?.id).toBe(
      "illustrated-motif",
    );
    expect(Object.keys(RETIRED_GRAPHICS_SLUG_TO_KEEPER)).toHaveLength(3);
    expect(isFloatingCatalogStyle({ catalogSlug: "centered-graphic" })).toBe(true);
    expect(isFloatingCatalogStyle({ outputMode: "floating" })).toBe(true);
    expect(isFloatingCatalogStyle({ catalogSlug: "minimal-line" })).toBe(false);
    expect(isFloatingCatalogStyle({ catalogSlug: "playful-cartoon" })).toBe(true);
    expect(isFloatingCatalogStyle({ catalogSlug: "vintage-print" })).toBe(true);
    expect(isFloatingCatalogStyle({ catalogSlug: "one-color-print" })).toBe(true);
    expect(isFloatingCatalogStyle({ catalogSlug: "retro-sunset-stack" })).toBe(true);
  });
});

describe("Minimalist rename keeps slug minimal-line", () => {
  it("infers Minimalist and Minimal Line Art as minimal-line", () => {
    expect(inferCatalogSlug("Minimalist")).toBe("minimal-line");
    expect(inferCatalogSlug("Minimal Line Art")).toBe("minimal-line");
    expect(resolveCatalogSlug({ catalogSlug: "minimal-line", name: "Minimalist" })).toBe(
      "minimal-line",
    );
  });
});
