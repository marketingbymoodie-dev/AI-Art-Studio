import { describe, expect, it } from "vitest";
import {
  APPAREL_BASE_TRANSPARENT,
  composeLayeredPrompt,
  LITERAL_TEXT_INSTRUCTION,
  LITERAL_TEXT_INTENT_FRAGMENT,
  literalUserSlotSchema,
} from "./promptLayers";
import {
  detectQuotesVerbatimInput,
  fontSuggestionIsLetterformOnly,
  migrateQuotesInventFragment,
  QUOTES_OLD_INVENT_FRAGMENTS,
  QUOTES_THIN_STYLE_LIGHT,
  QUOTES_TREATMENTS,
  quotesImageComposeOverrides,
} from "./quotesStyle";

describe("detectQuotesVerbatimInput", () => {
  it("treats wrapping quotes as verbatim", () => {
    expect(detectQuotesVerbatimInput('"Stay wild"')).toEqual({
      mode: "verbatim",
      text: "Stay wild",
    });
    expect(detectQuotesVerbatimInput("“Stay wild”")).toEqual({
      mode: "verbatim",
      text: "Stay wild",
    });
  });

  it("treats leading use exactly: as verbatim", () => {
    expect(detectQuotesVerbatimInput("use exactly: Stay wild")).toEqual({
      mode: "verbatim",
      text: "Stay wild",
    });
    expect(detectQuotesVerbatimInput("Use Exactly: Stay wild")).toEqual({
      mode: "verbatim",
      text: "Stay wild",
    });
  });

  it("does not treat mid-sentence quotes as verbatim", () => {
    expect(detectQuotesVerbatimInput('monday "mornings" vibes')).toEqual({
      mode: "theme",
      text: 'monday "mornings" vibes',
    });
  });

  it("treats a bare theme as theme", () => {
    expect(detectQuotesVerbatimInput("monday mornings")).toEqual({
      mode: "theme",
      text: "monday mornings",
    });
  });
});

describe("quotesImageComposeOverrides", () => {
  it("does not quote a bypassed theme", () => {
    const out = quotesImageComposeOverrides({
      catalogSlug: "quotes",
      userInput: "monday mornings",
    });
    expect(out.committed).toBe(false);
    expect(out.userSlotSchema).toBeNull();
    expect(out.fontLayer).toBe("");
    expect(out.artLayer).toBe("");
    expect(out.userInput).toBe("monday mornings");
  });

  it("omits FONT/ART on wrap-in-quotes even if the client sends them", () => {
    const out = quotesImageComposeOverrides({
      catalogSlug: "quotes",
      userInput: '"Stay wild"',
      quotesVoice: "funny",
      quoteArtBrief: "a wolf howling",
      quoteFontSuggestion: "heavy comic display sans",
    });
    expect(out.verbatimFromBox).toBe(true);
    expect(out.committed).toBe(true);
    expect(out.userInput).toBe("Stay wild");
    expect(out.userSlotSchema).toEqual(literalUserSlotSchema(16));
    expect(out.fontLayer).toBe("");
    expect(out.artLayer).toBe("");
  });

  it("applies literal + FONT/ART for a chosen pick", () => {
    const out = quotesImageComposeOverrides({
      catalogSlug: "quotes",
      userInput: "Monday called. I hung up.",
      quotesVoice: "funny",
      quoteArtBrief: "a rotary phone flying",
      quoteFontSuggestion: "heavy comic display sans, slight bounce",
    });
    expect(out.committed).toBe(true);
    expect(out.verbatimFromBox).toBe(false);
    expect(out.userSlotSchema).toEqual(literalUserSlotSchema(16));
    expect(out.fontLayer).toBe("heavy comic display sans, slight bounce");
    expect(out.artLayer).toBe("a rotary phone flying");
  });

  it("leaves non-Quotes styles alone", () => {
    const stored = literalUserSlotSchema(6);
    const out = quotesImageComposeOverrides({
      catalogSlug: "opinionated",
      userInput: "I choose dogs",
      storedUserSlotSchema: stored,
    });
    expect(out.userSlotSchema).toBe(stored);
    expect(out.userInput).toBe("I choose dogs");
  });
});

describe("Quotes layered compose", () => {
  it("chosen pick is BASE + STYLE + INTENT + TREATMENT + FONT + ART + literal USER", () => {
    const overrides = quotesImageComposeOverrides({
      catalogSlug: "quotes",
      userInput: "Monday called. I hung up.",
      quotesVoice: "funny",
      quoteArtBrief: "a rotary phone flying after being slammed, coffee sloshing from a mug",
      quoteFontSuggestion: "heavy comic display sans, slight bounce, uneven baseline",
    });
    const layered = composeLayeredPrompt({
      category: "apparel",
      isApparelGeneration: true,
      generationModel: "gpt-image-2",
      styleLayer: QUOTES_THIN_STYLE_LIGHT,
      subStyleLayer: QUOTES_TREATMENTS.funny,
      userInput: overrides.userInput,
      userSlotSchema: overrides.userSlotSchema,
      fontLayer: overrides.fontLayer,
      artLayer: overrides.artLayer,
    });
    expect(layered.prompt).toBe(
      [
        APPAREL_BASE_TRANSPARENT,
        QUOTES_THIN_STYLE_LIGHT,
        LITERAL_TEXT_INTENT_FRAGMENT,
        QUOTES_TREATMENTS.funny,
        overrides.fontLayer,
        overrides.artLayer,
        `${LITERAL_TEXT_INSTRUCTION}: "Monday called. I hung up."`,
      ].join("\n\n"),
    );
    expect(layered.subStyleLayer).not.toMatch(/letterform|sans-serif|script|typeface/i);
    expect(layered.fontLayer).not.toMatch(/print|composition|color|cartoon|sticker/i);
    expect(layered.prompt).not.toContain("Create a quote design of");
    expect(layered.prompt).not.toContain(QUOTES_OLD_INVENT_FRAGMENTS.funny);
  });

  it("verbatim-from-box omits FONT and ART", () => {
    const overrides = quotesImageComposeOverrides({
      catalogSlug: "quotes",
      userInput: "use exactly: Stay wild",
      quotesVoice: "funny",
    });
    const layered = composeLayeredPrompt({
      category: "apparel",
      isApparelGeneration: true,
      generationModel: "gpt-image-2",
      styleLayer: QUOTES_THIN_STYLE_LIGHT,
      subStyleLayer: QUOTES_TREATMENTS.funny,
      userInput: overrides.userInput,
      userSlotSchema: overrides.userSlotSchema,
      fontLayer: overrides.fontLayer,
      artLayer: overrides.artLayer,
    });
    expect(layered.fontLayer).toBe("");
    expect(layered.artLayer).toBe("");
    expect(layered.userLayer).toBe(`${LITERAL_TEXT_INSTRUCTION}: "Stay wild"`);
    expect(layered.prompt).not.toContain("rotary");
  });

  it("Opinionated I choose dogs is unchanged", () => {
    const layered = composeLayeredPrompt({
      category: "apparel",
      isApparelGeneration: true,
      generationModel: "gpt-image-2",
      styleLayer: "Statement-tee graphic, strong opinion statement, up to 6 words maximum, flat vibrant colors (avoid white, light colors), high contrast, centered, no shadow, no texture, no white mat.",
      userInput: "I choose dogs",
      userSlotSchema: literalUserSlotSchema(6),
    });
    expect(layered.userLayer).toBe(`${LITERAL_TEXT_INSTRUCTION}: "I choose dogs"`);
    expect(layered.intentLayer).toBe(LITERAL_TEXT_INTENT_FRAGMENT);
  });
});

describe("quotes helpers", () => {
  it("replaces old invent fragments with treatments", () => {
    expect(migrateQuotesInventFragment(QUOTES_OLD_INVENT_FRAGMENTS.funny, "funny")).toBe(
      QUOTES_TREATMENTS.funny,
    );
  });

  it("rejects font suggestions that pin print/composition/color", () => {
    expect(fontSuggestionIsLetterformOnly("heavy comic display sans, slight bounce")).toBe(true);
    expect(fontSuggestionIsLetterformOnly("screen print western slab")).toBe(false);
    expect(fontSuggestionIsLetterformOnly("stacked sticker-art composition")).toBe(false);
    expect(fontSuggestionIsLetterformOnly("vibrant color palette script")).toBe(false);
  });
});
