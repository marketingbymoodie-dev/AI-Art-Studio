import { describe, expect, it } from "vitest";
import { STYLE_PRESETS } from "./schema";
import { PACK_STYLE_CATALOG, findPackStyleDefinition } from "./packStyleCatalog";
import { findCatalogPreset, resolveCatalogSlug } from "./styleCatalog";
import { resolveStyleGenerationForProduct } from "./decorBackgroundFill";
import { getStylePackProfile } from "./stylePackProfiles";
import { parseStyleInputCapabilities } from "./stylePacks";
import { PETPOSTEROUS_EXPERIENCE_CONFIG, PETPOSTEROUS_PACK_SLUG } from "./packs/petposterous";
import { parseExperienceProfileConfig } from "./experienceProfile";

const defs = PACK_STYLE_CATALOG[PETPOSTEROUS_PACK_SLUG];

describe("Petposterous pack catalog", () => {
  it("16 styles, 10 active at launch, the 6 held back inactive", () => {
    expect(defs).toHaveLength(16);
    const inactive = defs.filter((d) => !d.launchActive).map((d) => d.id).sort();
    expect(inactive).toEqual(
      ["pp-domestic-epic", "pp-forensic", "pp-hostile-negotiations", "pp-illustrated-character", "pp-pet-propaganda", "pp-retro-ad"],
    );
  });

  it("never enters the classic boot-seeded catalog", () => {
    expect(STYLE_PRESETS.some((p) => String(p.id).startsWith("pp-"))).toBe(false);
  });

  it("every style is a scenario only: shared layers live in the profile", () => {
    for (const d of defs) {
      expect(d.promptPrefix.startsWith("STYLE —")).toBe(true);
      expect(d.promptPrefix).not.toMatch(/PETPOSTEROUS CREATIVE DIRECTION|TEXT RULE|REFERENCE IDENTITY|HUMOUR:|RELATIONSHIP:/);
      expect(d.promptPrefix.length).toBeLessThan(800);
    }
  });

  it("owner photos optional except genuinely pet-only styles", () => {
    const petOnly = defs.filter((d) => parseStyleInputCapabilities(d.inputCapabilities)?.ownerPhoto === "unsupported");
    expect(petOnly.map((d) => d.id).sort()).toEqual(["pp-illustrated-character", "pp-minimal-deadpan", "pp-portrait-character"]);
    for (const d of defs) {
      const caps = parseStyleInputCapabilities(d.inputCapabilities)!;
      expect(caps.petPhoto).toBe("optional");
      expect(caps.humor).toEqual({ supported: true, default: "witty" });
      expect(caps.relationship).toEqual({ supported: true, default: "its-complicated" });
    }
  });

  it("pack slugs resolve through the catalog lookups, with their sub-options", () => {
    expect(resolveCatalogSlug({ catalogSlug: "pp-petty-crimes" })).toBe("pp-petty-crimes");
    const hit = findCatalogPreset({ catalogSlug: "pp-petty-crimes" }) as any;
    expect(hit?.options?.label).toBe("Case Type");
    expect(hit.options.choices.map((c: any) => c.id)).toEqual(["mugshot", "caught", "evidence", "courtroom", "repeat-offender"]);
    expect(findPackStyleDefinition("pp-sleep-warfare")?.options?.choices).toHaveLength(4);
    // Classic slugs unaffected.
    expect((findCatalogPreset({ catalogSlug: "quotes" }) as any)?.id).toBe("quotes");
  });
});

describe("apparel on GPT Image 2, decor on nano-banana", () => {
  const pp = { generationModel: "gpt-image-2", generationModelDecor: "nano-banana", outputMode: null, catalogSlug: "pp-old-master" };
  it("picks the model by product", () => {
    expect(resolveStyleGenerationForProduct(pp, "apparel").nativeTransparent).toBe(true);
    expect(resolveStyleGenerationForProduct(pp, "all-over-print").model).toBe("gpt-image-2");
    expect(resolveStyleGenerationForProduct(pp, "framed-print").model).toBeNull();
    expect(resolveStyleGenerationForProduct(pp, "pillow").nativeTransparent).toBe(false);
  });
  it("null decor model = unchanged legacy choice", () => {
    const legacy = { generationModel: "gpt-image-2", outputMode: null, catalogSlug: null };
    expect(resolveStyleGenerationForProduct(legacy, "pillow").model).toBe("gpt-image-2");
    expect(resolveStyleGenerationForProduct({ generationModel: null }, "apparel").model).toBeNull();
  });
});

describe("Petposterous profile content", () => {
  it("prompt profile is registered with 6 humour / 8 relationship options and a concept writer", () => {
    const p = getStylePackProfile("petposterous")!;
    expect(p.humorOptions.map((o) => o.id)).toEqual(["warm", "dry", "witty", "sarcastic", "unhinged", "risque"]);
    expect(p.relationshipOptions).toHaveLength(8);
    expect(p.concept?.punchlineMaxWords).toBe(6);
  });

  it("experience config survives parsing intact", () => {
    const cfg = parseExperienceProfileConfig(PETPOSTEROUS_EXPERIENCE_CONFIG);
    expect(cfg.brand.name).toBe("Petposterous");
    expect(cfg.copy.savedDesignsLabel).toBe("My Creations");
    expect(cfg.copy.generateButtonLabel).toBe("Create Artwork");
    expect(cfg.controls.personality?.max).toBe(3);
    expect(cfg.controls.personality?.options).toHaveLength(14);
    expect(cfg.controls.species?.options.map((o) => o.label)).toEqual(["Dog", "Cat", "Bird", "Small Pet", "Reptile", "Other"]);
    expect(Object.keys(cfg.copy).sort()).toEqual(Object.keys(PETPOSTEROUS_EXPERIENCE_CONFIG.copy).sort());
  });
});
