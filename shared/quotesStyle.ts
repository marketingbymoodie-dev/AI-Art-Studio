/**
 * Quotes interpretive style: theme → 3 options → one known line rendered
 * through the existing literal mechanism. Request-scoped literal only —
 * the Quotes row must not store a permanent user_slot_schema.
 */

import { literalUserSlotSchema, type UserSlotSchema } from "./promptLayers";

export const QUOTES_CATALOG_SLUG = "quotes";
export const QUOTES_LITERAL_MAX_WORDS = 16;

export const QUOTES_PLACEHOLDER =
  'Describe a theme and we\'ll write the quote — or put your own words in "quotes" to use them exactly.';

/** Thin style layer — isolated graphic + garment colors. No letterform, no "create a quote of". */
export const QUOTES_THIN_STYLE_LIGHT =
  "Isolated t-shirt graphic, high contrast, centered, garment-safe colors (avoid white, light colors), no white mat.";

export const QUOTES_THIN_STYLE_DARK =
  "Isolated t-shirt graphic, high contrast, centered, bright vibrant colors including white and light tones (avoid dark, black), no white mat.";

/** Print method + composition only. Must not pin a letterform. */
export const QUOTES_TREATMENTS = {
  profound:
    "Single-color print, clean silhouette illustration, generous negative space, refined minimal composition, one supporting graphic element, no gradients, no texture, high-contrast against garment.",
  quirky:
    "Retro cartoon illustration style, bold outlines, flat vibrant fills, playful sticker-art composition, slight vintage print texture, lively and characterful.",
  weird:
    "Surreal illustration, unexpected juxtaposition, saturated offbeat color palette, retro-psychedelic composition, dense and strange, trippy print feel.",
  funny:
    "Bold classic t-shirt graphic, punchy high-contrast colors, exaggerated cartoon illustration, centered composition, clear readable hero lettering, mass-appeal print style.",
} as const;

export type QuotesVoiceId = keyof typeof QUOTES_TREATMENTS;

export const QUOTES_VOICE_IDS = Object.keys(QUOTES_TREATMENTS) as QuotesVoiceId[];

export const QUOTES_VOICE_BRIEFS: Record<QuotesVoiceId, string> = {
  profound: "sincere, compact, wise — one original line that feels earned, not preachy",
  quirky: "sideways, unexpected, charming — a sideways take, not a groaner pun",
  weird: "surreal, slightly wrong — dense and strange, not merely random",
  funny: "punchy, mass-appeal joke — a tee someone would actually wear",
};

/** Legacy invent-a-quote fragments — must never reach the image model. */
export const QUOTES_OLD_INVENT_FRAGMENTS = {
  profound: "a profound, thoughtful, deep quote on",
  quirky: "a quirky, offbeat, unexpected quote on",
  weird: "a weird, absurd, surreal quote on",
  funny: "a funny, humorous, comedic quote on",
} as const;

const OLD_QUOTES_PREFIXES_LIGHT = [
  "T-shirt graphic, stylish quote typography, expressive lettering, flat vibrant colors (avoid white, light colors; DO NOT use solid hot pink (#FF00FF) or magenta in the design), high contrast, centered, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, creative typographic layout. Create a quote design of",
  "T-shirt graphic, stylish quote typography, expressive lettering, flat vibrant colors (avoid white, light colors), high contrast, centered, no shadow, no texture, no white mat, creative typographic layout. Create a quote design of",
];

const OLD_QUOTES_PREFIXES_DARK = [
  "T-shirt graphic, stylish quote typography, expressive lettering, bright vibrant colors including white and light tones (avoid dark, black; DO NOT use solid hot pink (#FF00FF) or magenta in the design), high contrast, centered, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, creative typographic layout. Create a quote design of",
  "T-shirt graphic, stylish quote typography, expressive lettering, bright vibrant colors including white and light tones (avoid dark, black), high contrast, centered, no shadow, no texture, creative typographic layout. Create a quote design of",
];

export function isOldQuotesStylePrefix(text: string, field: "light" | "dark" = "light"): boolean {
  const t = (text || "").trim();
  const list = field === "dark" ? OLD_QUOTES_PREFIXES_DARK : OLD_QUOTES_PREFIXES_LIGHT;
  if (list.includes(t)) return true;
  const lower = t.toLowerCase();
  return (
    lower.includes("create a quote design of") ||
    (lower.includes("stylish quote typography") && lower.includes("expressive lettering"))
  );
}

export function isQuotesCatalogSlug(slug: string | null | undefined): boolean {
  return String(slug || "").trim().toLowerCase() === QUOTES_CATALOG_SLUG;
}

export function parseQuotesVoice(raw: string | null | undefined): QuotesVoiceId | null {
  const key = String(raw || "").trim().toLowerCase();
  if (key in QUOTES_TREATMENTS) return key as QuotesVoiceId;
  return null;
}

export type QuotesVerbatimDetection = {
  mode: "verbatim" | "theme";
  text: string;
};

/**
 * Opens AND closes with quotes, or leading `use exactly:` → verbatim.
 * Mid-sentence quotes are NOT verbatim.
 */
export function detectQuotesVerbatimInput(raw: string): QuotesVerbatimDetection {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return { mode: "theme", text: "" };

  const useExactly = trimmed.match(/^use\s+exactly:\s*([\s\S]+)$/i);
  if (useExactly) {
    return { mode: "verbatim", text: useExactly[1].trim() };
  }

  const first = trimmed.charCodeAt(0);
  const last = trimmed.charCodeAt(trimmed.length - 1);
  const opens =
    first === 0x22 || first === 0x201c || first === 0x201d;
  const closes =
    last === 0x22 || last === 0x201c || last === 0x201d;
  if (opens && closes && trimmed.length >= 2) {
    return { mode: "verbatim", text: trimmed.slice(1, -1).trim() };
  }
  return { mode: "theme", text: trimmed };
}

export type QuoteOption = {
  quote: string;
  art_brief: string;
  font_suggestion: string;
};

/** Letterform-only. Fail closed if Sonnet pins print method / composition / color. */
export const FONT_SUGGESTION_FORBIDDEN =
  /\b(screen\s*-?\s*print|print\s+style|print\s+feel|print\s+method|composition|sticker(?:-art)?|chroma|gradient|palette|colou?rs?|vibrant|high-?contrast|centered|texture|cartoon|silhouette|flat\s+fills?)\b/i;

export function fontSuggestionIsLetterformOnly(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  return !FONT_SUGGESTION_FORBIDDEN.test(t);
}

export function migrateQuotesInventFragment(
  fragment: string | null | undefined,
  voiceId?: string | null,
): string {
  const current = (fragment || "").trim();
  const voice = parseQuotesVoice(voiceId);
  const oldValues = Object.values(QUOTES_OLD_INVENT_FRAGMENTS);
  if (oldValues.some((old) => current.toLowerCase() === old.toLowerCase())) {
    return voice ? QUOTES_TREATMENTS[voice] : current;
  }
  if (voice && !current) return QUOTES_TREATMENTS[voice];
  return current;
}

export type QuotesImageComposeInput = {
  catalogSlug?: string | null;
  userInput: string;
  quotesVoice?: string | null;
  quoteArtBrief?: string | null;
  quoteFontSuggestion?: string | null;
  storedUserSlotSchema?: unknown;
};

export type QuotesImageComposeResult = {
  userInput: string;
  userSlotSchema: UserSlotSchema | null | unknown;
  fontLayer: string;
  artLayer: string;
  committed: boolean;
  verbatimFromBox: boolean;
};

/**
 * Request-scoped Quotes compose. Permanent row literal is ignored.
 * Verbatim-from-box (wrap / use exactly:) → literal USER, omit FONT/ART.
 * Chosen/edited pick (quotesVoice or FONT/ART present) → literal USER + FONT/ART.
 * Bypassed theme → not quoted.
 */
export function quotesImageComposeOverrides(
  input: QuotesImageComposeInput,
): QuotesImageComposeResult {
  if (!isQuotesCatalogSlug(input.catalogSlug)) {
    return {
      userInput: input.userInput,
      userSlotSchema: input.storedUserSlotSchema,
      fontLayer: "",
      artLayer: "",
      committed: false,
      verbatimFromBox: false,
    };
  }

  const detected = detectQuotesVerbatimInput(input.userInput);
  const hasStepBMeta = !!(
    parseQuotesVoice(input.quotesVoice) ||
    String(input.quoteArtBrief || "").trim() ||
    String(input.quoteFontSuggestion || "").trim()
  );
  const verbatimFromBox = detected.mode === "verbatim";
  const committed = verbatimFromBox || hasStepBMeta;
  const userInput = verbatimFromBox ? detected.text : String(input.userInput || "").trim();

  return {
    userInput,
    userSlotSchema: committed ? literalUserSlotSchema(QUOTES_LITERAL_MAX_WORDS) : null,
    fontLayer: verbatimFromBox ? "" : String(input.quoteFontSuggestion || "").trim(),
    artLayer: verbatimFromBox ? "" : String(input.quoteArtBrief || "").trim(),
    committed,
    verbatimFromBox,
  };
}
