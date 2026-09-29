import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CLASSIC_COPY,
  EXPERIENCE_COPY_KEYS,
  experienceCopy,
  parseExperienceProfileConfig,
  parsePublicExperienceProfile,
  publicExperienceProfile,
} from "./experienceProfile";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const embedSource = readFileSync(join(root, "client/src/pages/embed-design.tsx"), "utf8");

describe("classic copy is the fallback", () => {
  it("no profile returns the caller's literal for every key", () => {
    for (const key of EXPERIENCE_COPY_KEYS) {
      expect(experienceCopy(null, key, CLASSIC_COPY[key])).toBe(CLASSIC_COPY[key]);
      expect(experienceCopy({ copy: {} }, key, "x")).toBe("x");
    }
  });

  it("every customizer call site falls back to today's exact string", () => {
    // xc("key", "literal") — the literal must be the classic copy (or its known
    // mobile casing variant), so a store without a profile renders unchanged.
    const variants: Record<string, string[]> = { uploadCaption: ["Reference images (optional, up to 5)"] };
    const calls = [...embedSource.matchAll(/xc\("(\w+)", "((?:[^"\\]|\\.)*)"\)/g)];
    expect(calls.length).toBeGreaterThanOrEqual(15);
    for (const [, key, literal] of calls) {
      const allowed = [CLASSIC_COPY[key as keyof typeof CLASSIC_COPY], ...(variants[key] ?? [])];
      expect(allowed, `${key}`).toContain(literal);
    }
  });

  it("an override wins only when set", () => {
    const p = { copy: { savedDesignsLabel: "My Creations" } };
    expect(experienceCopy(p, "savedDesignsLabel", "Saved Designs")).toBe("My Creations");
    expect(experienceCopy(p, "uploadLabel", "Upload")).toBe("Upload");
  });
});

describe("profile config parsing", () => {
  it("whitelists keys and validates colours, URLs and ids", () => {
    const cfg = parseExperienceProfileConfig({
      brand: { name: "  Petposterous ", logoUrl: "http://insecure/logo.png", accentColor: "#FF6600", textColor: "red" },
      copy: { savedDesignsLabel: "My Creations", notAKey: "x", uploadLabel: "   " },
      controls: {
        personality: {
          label: "THEY'RE A BIT…",
          max: 9,
          options: [{ id: "bossy", label: "Bossy" }, { id: "Bad Id", label: "x" }, { id: "bossy", label: "dupe" }],
        },
        species: { label: "Pet", options: [] },
      },
      extra: { anything: true },
    });
    expect(cfg.brand).toEqual({ name: "Petposterous", accentColor: "#FF6600" });
    expect(cfg.copy).toEqual({ savedDesignsLabel: "My Creations" });
    expect(cfg.controls.personality).toEqual({ label: "THEY'RE A BIT…", max: 5, options: [{ id: "bossy", label: "Bossy" }] });
    expect(cfg.controls.species).toBeUndefined();
  });

  it("garbage config yields an empty, safe profile", () => {
    expect(parseExperienceProfileConfig("not json")).toEqual({ brand: {}, copy: {}, controls: {} });
    expect(parseExperienceProfileConfig(null)).toEqual({ brand: {}, copy: {}, controls: {} });
  });

  it("the public payload carries option ids/labels only, never prompt text", () => {
    const pub = publicExperienceProfile(
      { slug: "p", stylePackId: "pack-1", config: { brand: { name: "P" } } },
      { humorOptions: [{ id: "witty", label: "Witty" }], relationshipOptions: [] },
    );
    expect(pub.controls.humorOptions).toEqual([{ id: "witty", label: "Witty" }]);
    expect(pub.controls).not.toHaveProperty("relationshipOptions");
    expect(JSON.stringify(pub)).not.toContain("fragment");
    expect(parsePublicExperienceProfile(pub)?.slug).toBe("p");
    expect(parsePublicExperienceProfile(null)).toBeNull();
    expect(parsePublicExperienceProfile({ brand: {} })).toBeNull();
  });
});
