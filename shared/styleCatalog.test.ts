import { describe, expect, it } from "vitest";
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
