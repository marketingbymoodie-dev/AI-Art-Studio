import { describe, expect, it } from "vitest";
import { APPAREL_CHROMA_STYLE_BY_NAME } from "./apparel-chroma-prompts";
import { GRAPHICS_CHROMA_STYLE_BY_ID } from "./graphics-chroma-prompts";
import {
  APPAREL_BASE_CHROMA,
  APPAREL_BASE_TRANSPARENT,
  DECOR_BASE_FULL_BLEED,
  LITERAL_TEXT_INSTRUCTION,
  STYLE_LAYER_MIGRATIONS,
  composeLayeredPrompt,
  countChromaHexMentions,
  literalPlaceholder,
  literalUserSlotSchema,
  migrateStoredStyleLayer,
  resolveLockedBase,
  resolvePromptLayerCategory,
  stripChromaFromStyleLayer,
} from "./promptLayers";

describe("prefix migration is chroma-only", () => {
  it("maps every BEFORE snapshot to the reviewed AFTER", () => {
    for (const row of STYLE_LAYER_MIGRATIONS) {
      expect(migrateStoredStyleLayer(row.before)).toBe(row.after);
      expect(row.after.toLowerCase()).not.toContain("#ff00ff");
      expect(row.after.toLowerCase()).not.toContain("solid hot pink");
      expect(row.after.toLowerCase()).not.toContain("hot pink background");
    }
  });

  it("strip matches AFTER for catalog befores (no semantic wipe)", () => {
    for (const row of STYLE_LAYER_MIGRATIONS) {
      expect(stripChromaFromStyleLayer(row.before)).toBe(row.after);
    }
  });

  it("keeps Opinionated creative treatment", () => {
    const after = APPAREL_CHROMA_STYLE_BY_NAME.opinionated;
    expect(after).toContain("bold stacked text typography");
    expect(after).toContain("up to 6 words");
    expect(after).toContain("Create a bold text stack design of");
    expect(after.toLowerCase()).not.toContain("#ff00ff");
  });
});

describe("locked bases by category + model", () => {
  it("graphics uses the same by-model bases as apparel", () => {
    expect(resolvePromptLayerCategory("graphics", false)).toBe("graphics");
    expect(resolveLockedBase("graphics", null)).toBe(APPAREL_BASE_CHROMA);
    expect(resolveLockedBase("apparel", null)).toBe(APPAREL_BASE_CHROMA);
    expect(resolveLockedBase("graphics", "gpt-image-2")).toBe(APPAREL_BASE_TRANSPARENT);
    expect(resolveLockedBase("apparel", "gpt-image-2")).toBe(APPAREL_BASE_TRANSPARENT);
    expect(resolveLockedBase("decor", "gpt-image-2")).toBe(DECOR_BASE_FULL_BLEED);
    expect(resolveLockedBase("decor", null)).toBe(DECOR_BASE_FULL_BLEED);
  });

  it("treats apparel generation with category=all as apparel", () => {
    expect(resolvePromptLayerCategory("all", true)).toBe("apparel");
    expect(resolvePromptLayerCategory("all", false)).toBe("decor");
  });
});

describe("composeLayeredPrompt", () => {
  it("nano-banana apparel: exactly one chroma source (the base)", () => {
    const layered = composeLayeredPrompt({
      category: "apparel",
      isApparelGeneration: true,
      generationModel: null,
      styleLayer: APPAREL_CHROMA_STYLE_BY_NAME["centered graphic"] + " isolated on a solid hot pink (#FF00FF) background",
      userInput: "a wolf",
    });
    expect(layered.prompt.startsWith(APPAREL_BASE_CHROMA)).toBe(true);
    expect(layered.prompt).toContain("centered flat vector");
    expect(layered.prompt).toContain("a wolf");
    expect(layered.styleLayer.toLowerCase()).not.toContain("#ff00ff");
    expect(countChromaHexMentions(layered.styleLayer)).toBe(0);
    expect(countChromaHexMentions(layered.prompt)).toBe(countChromaHexMentions(APPAREL_BASE_CHROMA));
    expect(countChromaHexMentions(layered.prompt)).toBeGreaterThan(0);
  });

  it("gpt-image-2 apparel: zero chroma, transparent base, literal quote", () => {
    const layered = composeLayeredPrompt({
      category: "apparel",
      isApparelGeneration: true,
      generationModel: "gpt-image-2",
      styleLayer: APPAREL_CHROMA_STYLE_BY_NAME.opinionated,
      userInput: "I choose dogs",
      userSlotSchema: literalUserSlotSchema(6),
    });
    expect(layered.prompt.startsWith(APPAREL_BASE_TRANSPARENT)).toBe(true);
    expect(layered.prompt).toContain("bold stacked text typography");
    expect(layered.prompt).toContain(LITERAL_TEXT_INSTRUCTION);
    expect(layered.prompt).toContain('"I choose dogs"');
    expect(layered.prompt.toLowerCase()).not.toContain("#ff00ff");
    expect(layered.prompt.toLowerCase()).not.toContain("hot pink");
    expect(layered.prompt.toLowerCase()).toContain("no border");
    expect(layered.chromaHexMentions).toBe(0);
  });

  it("graphics gpt-image-2 uses transparent apparel base", () => {
    const layered = composeLayeredPrompt({
      category: "graphics",
      isApparelGeneration: false,
      generationModel: "gpt-image-2",
      styleLayer: GRAPHICS_CHROMA_STYLE_BY_ID["graphics-centered-graphic"],
      userInput: "geometric wolf",
    });
    expect(layered.category).toBe("graphics");
    expect(layered.base).toBe(APPAREL_BASE_TRANSPARENT);
    expect(layered.prompt).toContain("large-format print");
    expect(layered.chromaHexMentions).toBe(0);
  });

  it("graphics nano-banana uses chroma apparel base", () => {
    const layered = composeLayeredPrompt({
      category: "graphics",
      isApparelGeneration: false,
      generationModel: null,
      styleLayer: GRAPHICS_CHROMA_STYLE_BY_ID["graphics-centered-graphic"],
      userInput: "geometric wolf",
    });
    expect(layered.base).toBe(APPAREL_BASE_CHROMA);
    expect(layered.chromaHexMentions).toBe(countChromaHexMentions(APPAREL_BASE_CHROMA));
  });

  it("decor uses full-bleed base and is unaffected by apparel transparent", () => {
    const layered = composeLayeredPrompt({
      category: "decor",
      isApparelGeneration: false,
      generationModel: "gpt-image-2",
      styleLayer: "A beautiful watercolor painting of",
      userInput: "sunset mountains",
    });
    expect(layered.base).toBe(DECOR_BASE_FULL_BLEED);
    expect(layered.prompt).not.toContain("TRANSPARENT background");
    expect(layered.prompt).toContain("watercolor");
    expect(layered.prompt).toContain("sunset mountains");
  });

  it("thematic styles pass user text through without quoting", () => {
    const layered = composeLayeredPrompt({
      category: "apparel",
      isApparelGeneration: true,
      generationModel: "gpt-image-2",
      styleLayer: APPAREL_CHROMA_STYLE_BY_NAME["illustrated motif"],
      userInput: "scary grizzly bear",
    });
    expect(layered.prompt).toContain("scary grizzly bear");
    expect(layered.prompt).not.toContain(LITERAL_TEXT_INSTRUCTION);
  });
});

describe("literal slot UI helpers", () => {
  it("builds the customizer placeholder", () => {
    expect(literalPlaceholder(literalUserSlotSchema(6).slots[0])).toBe(
      "Write your text here (up to 6 words)",
    );
  });
});
