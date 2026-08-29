import { describe, expect, it } from "vitest";
import { APPAREL_CHROMA_STYLE_BY_NAME, APPAREL_DARK_TIER_PROMPTS } from "./apparel-chroma-prompts";
import { mergeCatalogStyleOptions, OPINIONATED_TYPEWRITER_FRAGMENT, STYLE_PRESETS } from "./schema";
import { GRAPHICS_CHROMA_STYLE_BY_ID } from "./graphics-chroma-prompts";
import {
  APPAREL_BASE_CHROMA,
  APPAREL_BASE_TRANSPARENT,
  DECOR_BASE_FULL_BLEED,
  LITERAL_TEXT_INSTRUCTION,
  STYLE_LAYER_MIGRATIONS,
  applyForcedStyleLayerBySlug,
  composeLayeredPrompt,
  composeUserInputLayer,
  countChromaHexMentions,
  dedupeConsecutiveParagraphs,
  effectiveStoredUserSlotSchema,
  findLiteralSlot,
  resolveSubStyleFragment,
  literalPlaceholder,
  literalUserSlotSchema,
  parseUserSlotSchema,
  migrateStoredStyleLayer,
  resolveLockedBase,
  resolvePromptLayerCategory,
  stripChromaFromStyleLayer,
  LITERAL_TEXT_INTENT_FRAGMENT,
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
      if (row.key.startsWith("opinionated") || row.key.startsWith("quotes")) continue;
      if (!/#ff00ff/i.test(row.before) && !/solid hot pink/i.test(row.before)) continue;
      expect(stripChromaFromStyleLayer(row.before)).toBe(row.after);
    }
  });

  it("force-replaces Opinionated stored prefixes by name", () => {
    const dirty =
      "T-shirt graphic, bold stacked text typography, isolated on a solid hot pink (#FF00FF) background. Create a bold text stack design of";
    expect(applyForcedStyleLayerBySlug("opinionated", dirty, "light")).toBe(
      APPAREL_CHROMA_STYLE_BY_NAME.opinionated,
    );
    expect(applyForcedStyleLayerBySlug("opinionated", dirty, "dark")).toBe(
      APPAREL_DARK_TIER_PROMPTS.opinionated,
    );
  });

  it("does not clobber a chroma-free Opinionated merchant prefix", () => {
    const custom = "Statement-tee graphic, flat vibrant colors, high contrast, centered.";
    expect(applyForcedStyleLayerBySlug("opinionated", custom, "light")).toBe(custom);
    expect(applyForcedStyleLayerBySlug("opinionated", custom, "dark")).toBe(custom);
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
      subStyleLayer:
        "Bold classic t-shirt graphic, punchy high-contrast colors, exaggerated cartoon illustration, centered composition, clear readable hero lettering, mass-appeal print style.",
      userInput: "monday mornings",
    });
    expect(quotes.prompt).toContain("mass-appeal print style");
    expect(quotes.prompt).toContain("monday mornings");
    expect(quotes.prompt).not.toContain("Create a quote design of");
    expect(quotes.prompt).not.toContain("a funny, humorous, comedic quote on");

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

  it("Opinionated handwritten literal is BASE + STYLE + INTENT + SUB + USER", () => {
    const layered = composeLayeredPrompt({
      category: "apparel",
      isApparelGeneration: true,
      generationModel: "gpt-image-2",
      styleLayer: APPAREL_CHROMA_STYLE_BY_NAME.opinionated,
      subStyleLayer: "casual hand-lettered script, organic brush strokes, personal handwriting feel",
      userInput: "Murder is subjective",
      userSlotSchema: literalUserSlotSchema(6),
    });
    const expected = [
      APPAREL_BASE_TRANSPARENT,
      APPAREL_CHROMA_STYLE_BY_NAME.opinionated,
      LITERAL_TEXT_INTENT_FRAGMENT,
      "casual hand-lettered script, organic brush strokes, personal handwriting feel",
      `${LITERAL_TEXT_INSTRUCTION}: "Murder is subjective"`,
    ].join("\n\n");
    expect(layered.prompt).toBe(expected);
    expect(layered.intentLayer).toBe(LITERAL_TEXT_INTENT_FRAGMENT);
    expect((layered.prompt.match(/TRANSPARENT background/gi) || []).length).toBe(1);
    expect(layered.prompt).not.toMatch(/15% of the canvas/i);
    expect(layered.prompt).not.toMatch(/Do not add text unless/i);
    expect(layered.prompt).not.toMatch(/Do NOT add any text/i);
  });

  it("drops a style layer that echoes the locked transparent base", () => {
    const layered = composeLayeredPrompt({
      category: "apparel",
      isApparelGeneration: true,
      generationModel: "gpt-image-2",
      styleLayer: `${APPAREL_BASE_TRANSPARENT}\n\n${APPAREL_CHROMA_STYLE_BY_NAME.opinionated}`,
      userInput: "Murder is subjective",
      userSlotSchema: literalUserSlotSchema(6),
    });
    expect((layered.prompt.match(/TRANSPARENT background/gi) || []).length).toBe(1);
    expect(layered.styleLayer).toBe(APPAREL_CHROMA_STYLE_BY_NAME.opinionated);
    expect(dedupeConsecutiveParagraphs(`${APPAREL_BASE_TRANSPARENT}\n\n${APPAREL_BASE_TRANSPARENT}`)).toBe(
      APPAREL_BASE_TRANSPARENT,
    );
  });

  it("Typewriter sits in Choose Layout and composes after STYLE before USER", () => {
    const catalog = STYLE_PRESETS.find((s) => s.id === "opinionated") as any;
    expect(catalog.options.label).toBe("Choose Layout");
    const tw = catalog.options.choices.find((c: any) => c.id === "typewriter");
    expect(tw?.name).toBe("Typewriter");
    expect(tw?.promptFragment).toBe(OPINIONATED_TYPEWRITER_FRAGMENT);
    expect(tw?.promptFragment).toMatch(/^Typewriter lettering —/);
    expect(tw?.promptFragment.toLowerCase()).not.toContain("render the");
    expect(tw?.promptFragment.toLowerCase()).not.toContain("verbatim");

    const merged = mergeCatalogStyleOptions(
      { label: "Choose Layout", required: true, choices: catalog.options.choices.slice(0, 5) },
      catalog.options,
    );
    expect(merged?.choices?.some((c) => c.id === "typewriter")).toBe(true);

    const layered = composeLayeredPrompt({
      category: "apparel",
      isApparelGeneration: true,
      generationModel: "gpt-image-2",
      styleLayer: APPAREL_CHROMA_STYLE_BY_NAME.opinionated,
      subStyleLayer: OPINIONATED_TYPEWRITER_FRAGMENT,
      userInput: "Murder is subjective",
      userSlotSchema: literalUserSlotSchema(6),
    });
    const styleAt = layered.prompt.indexOf(APPAREL_CHROMA_STYLE_BY_NAME.opinionated);
    const intentAt = layered.prompt.indexOf(LITERAL_TEXT_INTENT_FRAGMENT);
    const twAt = layered.prompt.indexOf(OPINIONATED_TYPEWRITER_FRAGMENT);
    const userAt = layered.prompt.indexOf("Murder is subjective");
    expect(styleAt).toBeGreaterThan(-1);
    expect(intentAt).toBeGreaterThan(styleAt);
    expect(twAt).toBeGreaterThan(intentAt);
    expect(userAt).toBeGreaterThan(twAt);
    expect(LITERAL_TEXT_INTENT_FRAGMENT).not.toMatch(/bold|stacked|typewriter|monospace/i);
    expect(resolveSubStyleFragment({
      styleOptionId: "typewriter",
      styleOptions: catalog.options,
    })).toBe(OPINIONATED_TYPEWRITER_FRAGMENT);
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
    expect(layered.prompt).not.toContain(LITERAL_TEXT_INTENT_FRAGMENT);
    expect(layered.intentLayer).toBe("");
  });

  it("literal ON injects intent + quote; OFF injects neither", () => {
    const on = composeLayeredPrompt({
      category: "apparel",
      isApparelGeneration: true,
      generationModel: "gpt-image-2",
      styleLayer: APPAREL_CHROMA_STYLE_BY_NAME.opinionated,
      subStyleLayer: OPINIONATED_TYPEWRITER_FRAGMENT,
      userInput: "I choose dogs",
      userSlotSchema: literalUserSlotSchema(6),
    });
    expect(on.intentLayer).toBe(LITERAL_TEXT_INTENT_FRAGMENT);
    expect(on.prompt).toContain(LITERAL_TEXT_INTENT_FRAGMENT);
    expect(on.prompt).toContain(LITERAL_TEXT_INSTRUCTION);
    expect(on.prompt.indexOf(LITERAL_TEXT_INTENT_FRAGMENT)).toBeLessThan(
      on.prompt.indexOf(OPINIONATED_TYPEWRITER_FRAGMENT),
    );
    expect(on.prompt.indexOf(OPINIONATED_TYPEWRITER_FRAGMENT)).toBeLessThan(
      on.prompt.indexOf(LITERAL_TEXT_INSTRUCTION),
    );

    const off = composeLayeredPrompt({
      category: "apparel",
      isApparelGeneration: true,
      generationModel: "gpt-image-2",
      styleLayer: APPAREL_CHROMA_STYLE_BY_NAME.opinionated,
      subStyleLayer: OPINIONATED_TYPEWRITER_FRAGMENT,
      userInput: "I choose dogs",
      userSlotSchema: null,
    });
    expect(off.intentLayer).toBe("");
    expect(off.prompt).not.toContain(LITERAL_TEXT_INTENT_FRAGMENT);
    expect(off.prompt).not.toContain(LITERAL_TEXT_INSTRUCTION);
    expect(off.userLayer).toBe("I choose dogs");
  });
});

describe("resolveSubStyleFragment", () => {
  const quotesOptions = {
    choices: [
      { id: "funny", name: "Funny", promptFragment: "Bold classic t-shirt graphic, punchy high-contrast colors, exaggerated cartoon illustration, centered composition, clear readable hero lettering, mass-appeal print style." },
      { id: "king", name: "King", promptFragment: "dressed as a majestic king with crown and royal robes" },
    ],
  };

  it("resolves by styleOptionId", () => {
    expect(
      resolveSubStyleFragment({
        styleOptionId: "funny",
        styleOptions: quotesOptions,
      }),
    ).toBe("Bold classic t-shirt graphic, punchy high-contrast colors, exaggerated cartoon illustration, centered composition, clear readable hero lettering, mass-appeal print style.");
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

  it("parses user_slot_schema from a JSON string or object", () => {
    const asObject = literalUserSlotSchema(6);
    const asString = JSON.stringify(asObject);
    expect(parseUserSlotSchema(asObject)).toEqual(asObject);
    expect(parseUserSlotSchema(asString)).toEqual(asObject);
    expect(findLiteralSlot(parseUserSlotSchema(asString))?.kind).toBe("literal");
    expect(parseUserSlotSchema(null)).toBeNull();
  });

  it("composeUserInputLayer quotes only when a literal slot is stored", () => {
    expect(composeUserInputLayer("I choose dogs", null)).toBe("I choose dogs");
    expect(composeUserInputLayer("I choose dogs", null)).not.toContain(LITERAL_TEXT_INSTRUCTION);
    expect(composeUserInputLayer("I choose dogs", literalUserSlotSchema(6))).toBe(
      `${LITERAL_TEXT_INSTRUCTION}: "I choose dogs"`,
    );
  });

  it("effectiveStoredUserSlotSchema treats explicit null as OFF", () => {
    const hardcoded = literalUserSlotSchema(6);
    expect(effectiveStoredUserSlotSchema(null, hardcoded)).toBeNull();
    expect(effectiveStoredUserSlotSchema(hardcoded, null)).toEqual(hardcoded);
    expect(effectiveStoredUserSlotSchema(undefined, hardcoded)).toEqual(hardcoded);
  });
});
