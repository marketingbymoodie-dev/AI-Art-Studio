import { describe, expect, it } from "vitest";
import { APPAREL_CHROMA_STYLE_BY_NAME, APPAREL_DARK_TIER_PROMPTS } from "./apparel-chroma-prompts";
import { GRAPHICS_CHROMA_STYLE_BY_ID } from "./graphics-chroma-prompts";
import {
  APPAREL_BASE_CHROMA,
  APPAREL_BASE_TRANSPARENT,
  DECOR_BASE_FULL_BLEED,
  LITERAL_TEXT_INSTRUCTION,
  STYLE_LAYER_MIGRATIONS,
  applyForcedStyleLayerByName,
  composeLayeredPrompt,
  countChromaHexMentions,
  resolveSubStyleFragment,
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

  it("strip matches AFTER for chroma catalog befores (no semantic wipe)", () => {
    for (const row of STYLE_LAYER_MIGRATIONS) {
      if (row.key.startsWith("opinionated")) continue;
      if (!/#ff00ff/i.test(row.before) && !/solid hot pink/i.test(row.before)) continue;
      expect(stripChromaFromStyleLayer(row.before)).toBe(row.after);
    }
  });

  it("force-replaces Opinionated stored prefixes by name", () => {
    const dirty =
      "T-shirt graphic, bold stacked text typography, isolated on a solid hot pink (#FF00FF) background. Create a bold text stack design of";
    expect(applyForcedStyleLayerByName("Opinionated", dirty, "light")).toBe(
      APPAREL_CHROMA_STYLE_BY_NAME.opinionated,
    );
    expect(applyForcedStyleLayerByName("Opinionated", dirty, "dark")).toBe(
      APPAREL_DARK_TIER_PROMPTS.opinionated,
    );
  });

  it("keeps Opinionated style-level character without pinning lettering", () => {
    const after = APPAREL_CHROMA_STYLE_BY_NAME.opinionated;
    expect(after).toContain("Statement-tee graphic");
    expect(after).toContain("strong opinion statement");
    expect(after).toContain("up to 6 words");
    expect(after.toLowerCase()).not.toContain("bold stacked");
    expect(after.toLowerCase()).not.toContain("typography");
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
    expect(layered.prompt).toContain("Statement-tee graphic");
    expect(layered.prompt).not.toMatch(/bold stacked/i);
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

  it("puts the sub-style fragment in its own layer for Opinionated / Quotes / Pet Portraits", () => {
    const opinionated = composeLayeredPrompt({
      category: "apparel",
      isApparelGeneration: true,
      generationModel: "gpt-image-2",
      styleLayer: APPAREL_CHROMA_STYLE_BY_NAME.opinionated,
      subStyleLayer: "casual hand-lettered script, organic brush strokes, personal handwriting feel",
      userInput: "I choose dogs",
      userSlotSchema: literalUserSlotSchema(6),
    });
    expect(opinionated.subStyleLayer).toContain("hand-lettered script");
    expect(opinionated.prompt).toContain("casual hand-lettered script");
    expect(opinionated.prompt).toContain('"I choose dogs"');
    expect(opinionated.prompt).not.toMatch(/bold stacked/i);
    expect(opinionated.prompt.indexOf("hand-lettered")).toBeLessThan(
      opinionated.prompt.indexOf("I choose dogs"),
    );

    const quotes = composeLayeredPrompt({
      category: "apparel",
      isApparelGeneration: true,
      generationModel: null,
      styleLayer: APPAREL_CHROMA_STYLE_BY_NAME.quotes,
      subStyleLayer: "a funny, humorous, comedic quote on",
      userInput: "monday mornings",
    });
    expect(quotes.prompt).toContain("a funny, humorous, comedic quote on");
    expect(quotes.prompt).toContain("monday mornings");

    const pets = composeLayeredPrompt({
      category: "apparel",
      isApparelGeneration: true,
      generationModel: null,
      styleLayer: APPAREL_CHROMA_STYLE_BY_NAME["pet portraits"],
      subStyleLayer: "dressed as a majestic king with crown and royal robes",
      userInput: "Rex",
    });
    expect(pets.prompt).toContain("dressed as a majestic king with crown and royal robes");
    expect(pets.prompt).toContain("Rex");
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

describe("resolveSubStyleFragment", () => {
  const quotesOptions = {
    choices: [
      { id: "funny", name: "Funny", promptFragment: "a funny, humorous, comedic quote on" },
      { id: "king", name: "King", promptFragment: "dressed as a majestic king with crown and royal robes" },
    ],
  };

  it("resolves by styleOptionId", () => {
    expect(
      resolveSubStyleFragment({
        styleOptionId: "funny",
        styleOptions: quotesOptions,
      }),
    ).toBe("a funny, humorous, comedic quote on");
  });

  it("recovers a fragment prefixed onto the client prompt", () => {
    expect(
      resolveSubStyleFragment({
        styleOptions: quotesOptions,
        clientPrompt: "dressed as a majestic king with crown and royal robes. Rex",
        userInput: "Rex",
      }),
    ).toBe("dressed as a majestic king with crown and royal robes");
  });
});

describe("literal slot UI helpers", () => {
  it("builds the customizer placeholder", () => {
    expect(literalPlaceholder(literalUserSlotSchema(6).slots[0])).toBe(
      "Write your text here (up to 6 words)",
    );
  });
});
