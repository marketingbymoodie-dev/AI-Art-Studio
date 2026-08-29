/**
 * Locked generation bases + layered compose (WP2).
 * Merchants author the style layer only. Base is chosen by category + model.
 *
 * Apparel and Graphics share the same by-model bases:
 *   gpt-image-2 → transparent
 *   nano-banana (null) → chroma plate (THE only chroma source)
 * Decor → full-bleed (any model).
 */

import { APPAREL_CHROMA_STYLE_BY_NAME, APPAREL_DARK_TIER_PROMPTS } from "./apparel-chroma-prompts";
import { GRAPHICS_CHROMA_STYLE_BY_ID, GRAPHICS_CHROMA_STYLE_BY_NAME } from "./graphics-chroma-prompts";
import { isGptImage2Model } from "./styleGeneration";

export const APPAREL_BASE_CHROMA =
  "Isolated centered graphic on a SOLID HOT PINK (#FF00FF) background. " +
  "Every pixel not part of the design must be exactly #FF00FF. " +
  "NO white mat, NO white rectangle, NO card behind subject — background must be pure #FF00FF to all four edges. " +
  "Do NOT use hot pink or magenta anywhere in the design itself. " +
  "Clean hard edges, no gradients into background, no outer glow or halos, no rectangular frames. " +
  "Do NOT add any text, words, slogans, or labels unless the user explicitly requested them.";

export const APPAREL_BASE_TRANSPARENT =
  "Isolated centered graphic on a TRANSPARENT background, for screen printing. " +
  "Isolated motif, screen-print ready, clean crisp edges, no background scene, no ground shadow, no plate. " +
  "No border or outline around text. Clean legible lettering. " +
  "No scenic plate, no white mat, no rectangular card.";

export const DECOR_BASE_FULL_BLEED =
  "Full-bleed, edge-to-edge composition, fills the entire canvas. " +
  "No borders, no blank margins, no letterboxing — paint to all four edges.";

export const AOP_PATTERN_EXTRA =
  "Seamless tileable repeating pattern unit. Must repeat seamlessly when tiled — NOT a single isolated centered icon.";

export const AOP_MOTIF_EXTRA =
  "This motif will be tiled into a repeating pattern. Keep a single centered isolated graphic.";

const SLUG_TO_APPAREL_CHROMA_KEY: Record<string, string> = {
  opinionated: "opinionated",
  quotes: "quotes",
  "pet-portraits": "pet portraits",
  "centered-graphic": "centered graphic",
  "illustrated-motif": "illustrated motif",
  "pattern-maker": "pattern maker",
  "free-4-all": "free 4 all",
};

/** Apparel chroma STYLE layer for a catalog slug. Undefined for decor / unknown slugs. */
export function apparelChromaStyleLayerForCatalogSlug(
  catalogSlug: string | null | undefined,
): string | undefined {
  const key = SLUG_TO_APPAREL_CHROMA_KEY[String(catalogSlug || "").trim().toLowerCase()];
  if (key === undefined) return undefined;
  return APPAREL_CHROMA_STYLE_BY_NAME[key];
}

export const LITERAL_TEXT_INSTRUCTION =
  "Render the following text EXACTLY as written, verbatim — do not change, add, remove, rephrase, or invent text";

/** Compose-owned. Fires only when a literal slot is present. No letterform treatment. */
export const LITERAL_TEXT_INTENT_FRAGMENT =
  "Render the user's provided words as the primary element of the design — the text is the design, displayed prominently and legibly.";

export type PromptLayerCategory = "apparel" | "graphics" | "decor";

export type UserSlotKind = "literal" | "thematic";

export type UserSlot = {
  id: string;
  kind: UserSlotKind;
  label?: string;
  maxWords?: number;
  maxChars?: number;
  placeholder?: string;
};

export type UserSlotSchema = { slots: UserSlot[] };

export function parseUserSlotSchema(raw: unknown): UserSlotSchema | null {
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object") return null;
  const slotsRaw = (raw as { slots?: unknown }).slots;
  if (!Array.isArray(slotsRaw) || slotsRaw.length === 0) return null;
  const slots: UserSlot[] = [];
  for (const item of slotsRaw) {
    if (!item || typeof item !== "object") continue;
    const kind = (item as { kind?: unknown }).kind;
    if (kind !== "literal" && kind !== "thematic") continue;
    const id = String((item as { id?: unknown }).id || kind);
    const maxWords = Number((item as { maxWords?: unknown }).maxWords);
    const maxChars = Number((item as { maxChars?: unknown }).maxChars);
    slots.push({
      id,
      kind,
      label: typeof (item as { label?: unknown }).label === "string" ? (item as { label: string }).label : undefined,
      maxWords: Number.isFinite(maxWords) && maxWords > 0 ? Math.floor(maxWords) : undefined,
      maxChars: Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : undefined,
      placeholder:
        typeof (item as { placeholder?: unknown }).placeholder === "string"
          ? (item as { placeholder: string }).placeholder
          : undefined,
    });
  }
  return slots.length > 0 ? { slots } : null;
}

/** `undefined` = field omitted. */
export function persistUserSlotSchema(raw: unknown): UserSlotSchema | null | undefined {
  if (raw === undefined) return undefined;
  if (raw == null) return null;
  return parseUserSlotSchema(raw);
}

/**
 * Merchant-stored user_slot_schema is authoritative.
 * Explicit NULL = Literal Text OFF — never overlay a catalog default.
 * Hardcoded fallback only when the column was never written (undefined).
 */
export function effectiveStoredUserSlotSchema(
  stored: unknown,
  hardcodedFallback?: unknown,
): UserSlotSchema | null {
  if (stored === null) return null;
  const parsed = parseUserSlotSchema(stored);
  if (parsed) return parsed;
  if (stored === undefined) {
    return parseUserSlotSchema(hardcodedFallback);
  }
  return null;
}

export function literalUserSlotSchema(maxWords = 6): UserSlotSchema {
  return { slots: [{ id: "text", kind: "literal", maxWords }] };
}

export function findLiteralSlot(schema: UserSlotSchema | null | undefined): UserSlot | null {
  if (!schema) return null;
  return schema.slots.find((s) => s.kind === "literal") ?? null;
}

export function literalPlaceholder(slot: UserSlot | null | undefined): string | null {
  if (!slot) return null;
  if (slot.placeholder?.trim()) return slot.placeholder.trim();
  const n = slot.maxWords;
  return n ? `Write your text here (up to ${n} words)` : "Write your text here";
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function resolvePromptLayerCategory(
  styleCategory: string | null | undefined,
  isApparelGeneration: boolean,
): PromptLayerCategory {
  const cat = (styleCategory || "").trim().toLowerCase();
  if (cat === "graphics") return "graphics";
  if (cat === "decor") return "decor";
  if (cat === "apparel" || isApparelGeneration) return "apparel";
  return "decor";
}

export function resolveLockedBase(
  category: PromptLayerCategory,
  generationModel?: string | null,
): string {
  if (category === "decor") return DECOR_BASE_FULL_BLEED;
  return isGptImage2Model(generationModel) ? APPAREL_BASE_TRANSPARENT : APPAREL_BASE_CHROMA;
}

/**
 * Strip plate / #FF00FF language from a style layer only.
 * Keeps garment color guidance ("avoid white, light colors") and creative treatment.
 */
export function stripChromaFromStyleLayer(text: string): string {
  let out = text;
  const patterns: RegExp[] = [
    /DO NOT use solid hot pink\s*(?:\(#FF00FF\))?\s*or magenta anywhere in the main design/gi,
    /DO NOT use solid hot pink\s*(?:\(#FF00FF\))?\s*or magenta in the design/gi,
    /isolated on a solid hot pink\s*(?:\(#FF00FF\))?\s*background/gi,
    /isolated on solid hot pink\s*(?:\(#FF00FF\))?\s*background/gi,
    /on SOLID HOT PINK\s*(?:\(#FF00FF\))?/gi,
    /SOLID HOT PINK\s*(?:\(#FF00FF\))?/gi,
    /Every pixel that is not part of the (?:design|pattern) must be exactly #FF00FF\.?/gi,
    /Every pixel not part of the (?:design|pattern) must be exactly #FF00FF\.?/gi,
    /#FF00FF is reserved exclusively for the background(?: mat)?\.?/gi,
    /AVOID hot pink\/magenta(?: colors)?(?: in the design)?\.?/gi,
    /and hot pink\/magenta colors in the design\.?/gi,
    /the ONLY background color is #FF00FF edge-to-edge\.?/gi,
    /leave #FF00FF around the subject instead\.?/gi,
    /leaving clean #FF00FF space around it\.?/gi,
    /fill entire canvas with #FF00FF outside the subject\.?/gi,
    /background must be pure #FF00FF to all four edges\.?/gi,
    /hot pink\s*\(#FF00FF\)\s*background/gi,
    /solid,?\s*uniform hot pink(?:\s*\(#FF00FF\))?/gi,
    /#FF00FF/gi,
    /\bhot pink background\b/gi,
    /\bhot-pink background\b/gi,
    /\bsolid hot pink\b/gi,
  ];
  for (const pattern of patterns) {
    out = out.replace(pattern, " ");
  }
  out = out.replace(/;\s*[—–\-]\s*\)/g, ")");
  out = out.replace(/;\s*\)/g, ")");
  out = out.replace(/\(\s*;\s*/g, "(");
  out = out.replace(/\(\s*[—–\-]\s*\)/g, "");
  out = out.replace(/\(\s*\)/g, "");
  out = out.replace(/[ \t]{2,}/g, " ");
  out = out.replace(/\s+,/g, ",");
  out = out.replace(/,(?:\s*,)+/g, ",");
  out = out.replace(/,\s*\./g, ".");
  out = out.replace(/\s+\./g, ".");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

export function countChromaHexMentions(prompt: string): number {
  return (prompt.match(/#ff00ff/gi) || []).length;
}

/** Drop a style/sub-style layer that accidentally repeats the locked base. */
export function stripLockedBaseEcho(layer: string, base: string): string {
  const text = (layer || "").trim();
  const locked = (base || "").trim();
  if (!text || !locked) return text;
  if (text === locked) return "";
  if (text.includes(locked)) {
    return text.split(locked).join(" ").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }
  return text;
}

export function dedupeConsecutiveParagraphs(text: string): string {
  const out: string[] = [];
  for (const raw of (text || "").split(/\n\n+/)) {
    const part = raw.trim();
    if (!part) continue;
    const prev = out[out.length - 1];
    if (prev && prev === part) continue;
    if (prev && isTransparentBaseParagraph(prev) && isTransparentBaseParagraph(part)) continue;
    out.push(part);
  }
  return out.join("\n\n");
}

function isTransparentBaseParagraph(text: string): boolean {
  return /^Isolated centered graphic on a TRANSPARENT background/i.test((text || "").trim());
}

export function composeUserInputLayer(userInput: string, schema?: unknown): string {
  const trimmed = (userInput || "").trim();
  if (!trimmed) return "";
  const parsed = parseUserSlotSchema(schema);
  const literal = findLiteralSlot(parsed);
  if (literal) {
    return `${LITERAL_TEXT_INSTRUCTION}: "${trimmed}"`;
  }
  return trimmed;
}

export function composeLiteralIntentLayer(schema?: unknown): string {
  return findLiteralSlot(parseUserSlotSchema(schema)) ? LITERAL_TEXT_INTENT_FRAGMENT : "";
}

export function resolveStyleLayerRaw(opts: {
  lightPrefix: string;
  darkPrefix?: string | null;
  colorTier?: "light" | "dark";
  stylePresetId?: string | null;
  catalogSlug?: string | null;
  styleName?: string | null;
  category?: string | null;
}): string {
  const slug = (opts.catalogSlug || "").trim() || (opts.stylePresetId || "").trim();
  if (opts.colorTier === "dark") {
    const dark = (opts.darkPrefix || "").trim();
    if (dark) return dark;
    if (slug && APPAREL_DARK_TIER_PROMPTS[slug]) {
      return APPAREL_DARK_TIER_PROMPTS[slug];
    }
  }
  const light = (opts.lightPrefix || "").trim();
  if (light) return light;
  const cat = (opts.category || "").toLowerCase();
  if (cat === "graphics") {
    const idKey = slug.toLowerCase();
    return GRAPHICS_CHROMA_STYLE_BY_ID[idKey] || "";
  }
  const chromaKey = SLUG_TO_APPAREL_CHROMA_KEY[slug.toLowerCase()];
  if (chromaKey && APPAREL_CHROMA_STYLE_BY_NAME[chromaKey] !== undefined) {
    return APPAREL_CHROMA_STYLE_BY_NAME[chromaKey];
  }
  return "";
}

export type ComposeLayeredPromptInput = {
  category: string | null | undefined;
  isApparelGeneration: boolean;
  generationModel?: string | null;
  styleLayer: string;
  /** Sub-style / layout fragment (Retro, Funny, King, …). Own layer — not folded into user text. */
  subStyleLayer?: string | null;
  userInput: string;
  userSlotSchema?: unknown;
  isAllOverPrint?: boolean;
  isPatternStyle?: boolean;
};

export type ComposeLayeredPromptResult = {
  prompt: string;
  category: PromptLayerCategory;
  base: string;
  styleLayer: string;
  intentLayer: string;
  subStyleLayer: string;
  userLayer: string;
  nativeTransparent: boolean;
  chromaHexMentions: number;
};

export type StyleOptionChoice = {
  id?: string;
  name?: string;
  promptFragment?: string;
};

export function resolveSubStyleFragment(opts: {
  styleOptionId?: string | null;
  styleOptions?: { choices?: StyleOptionChoice[] } | null;
  fallbackFragment?: string | null;
  clientPrompt?: string | null;
  userInput?: string | null;
}): string {
  const choices = opts.styleOptions?.choices;
  const id = (opts.styleOptionId || "").trim();
  if (id && Array.isArray(choices)) {
    const hit = choices.find(
      (c) =>
        String(c.id || "") === id ||
        String(c.name || "").trim().toLowerCase() === id.toLowerCase(),
    );
    if (hit?.promptFragment?.trim()) return hit.promptFragment.trim();
  }
  const fallback = (opts.fallbackFragment || "").trim();
  if (fallback) return fallback;
  const clientPrompt = (opts.clientPrompt || "").trim();
  if (clientPrompt && Array.isArray(choices)) {
    for (const c of choices) {
      const fragment = (c.promptFragment || "").trim();
      if (fragment && clientPrompt.startsWith(fragment)) return fragment;
    }
  }
  return "";
}

export function composeLayeredPrompt(input: ComposeLayeredPromptInput): ComposeLayeredPromptResult {
  const category = resolvePromptLayerCategory(input.category, input.isApparelGeneration);
  const nativeTransparent = isGptImage2Model(input.generationModel);
  const base = resolveLockedBase(category, input.generationModel);
  const extras: string[] = [];
  if (input.isAllOverPrint && (category === "apparel" || category === "graphics")) {
    extras.push(input.isPatternStyle ? AOP_PATTERN_EXTRA : AOP_MOTIF_EXTRA);
  }
  const styleLayer = stripLockedBaseEcho(
    stripChromaFromStyleLayer(input.styleLayer || ""),
    base,
  );
  const subStyleLayer = stripLockedBaseEcho(
    stripChromaFromStyleLayer(input.subStyleLayer || ""),
    base,
  );
  const intentLayer = composeLiteralIntentLayer(input.userSlotSchema);
  const userLayer = composeUserInputLayer(input.userInput, input.userSlotSchema);
  const prompt = dedupeConsecutiveParagraphs(
    [base, ...extras, styleLayer, intentLayer, subStyleLayer, userLayer].filter(Boolean).join("\n\n"),
  );
  return {
    prompt,
    category,
    base,
    styleLayer,
    intentLayer,
    subStyleLayer,
    userLayer,
    nativeTransparent,
    chromaHexMentions: countChromaHexMentions(prompt),
  };
}

export function wrapLayeredArtworkPrompt(
  layered: ComposeLayeredPromptResult,
  sizingRequirements?: string,
): string {
  const sizing = (sizingRequirements || "").trim();
  const head = sizing ? `${sizing}\n\n` : "";
  return `${head}=== ARTWORK DESCRIPTION ===\n${layered.prompt}`;
}

export function logLayeredComposedPrompt(
  label: string,
  layered: ComposeLayeredPromptResult,
  finalPrompt: string,
): void {
  const hex = countChromaHexMentions(finalPrompt);
  const plate = hex > 0 || /solid hot pink/i.test(finalPrompt);
  console.log(
    `[${label}] layered category=${layered.category} transparent=${layered.nativeTransparent} ` +
      `chromaHexMentions=${hex} plate=${plate ? "yes" : "none"}`,
  );
  console.log(`[${label}] Composed prompt (${finalPrompt.length} chars):\n${finalPrompt}`);
  if (layered.nativeTransparent && plate) {
    console.error(`[${label}] CHROMA PLATE LANGUAGE LEAKED on gpt-image-2`);
  }
  if (!layered.nativeTransparent && (layered.category === "apparel" || layered.category === "graphics") && hex === 0) {
    console.error(`[${label}] nano-banana apparel/graphics missing chroma base`);
  }
}

/** Exact BEFORE → AFTER pairs for catalog prefix migration (see snapshot doc). */
export type StyleLayerMigration = {
  key: string;
  field: "prompt_prefix" | "prompt_prefix_dark";
  before: string;
  after: string;
};

export const STYLE_LAYER_MIGRATIONS: StyleLayerMigration[] = [
  {
    key: "pattern maker",
    field: "prompt_prefix",
    before:
      "Seamless repeating pattern design, tileable motif, clean vector shapes, flat colors (avoid white, light colors; DO NOT use solid hot pink (#FF00FF) or magenta in the design), high contrast, isolated on a solid hot pink (#FF00FF) background, no white mat, no rectangular frame. Create a repeating pattern of",
    after:
      "Seamless repeating pattern design, tileable motif, clean vector shapes, flat colors (avoid white, light colors), high contrast, no white mat, no rectangular frame. Create a repeating pattern of",
  },
  {
    key: "opinionated",
    field: "prompt_prefix",
    before:
      "T-shirt graphic, bold stacked text typography, strong opinion statement, up to 6 words maximum, flat vibrant colors (avoid white, light colors; DO NOT use solid hot pink (#FF00FF) or magenta in the design), high contrast, centered, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, clean typographic layout. Create a bold text stack design of",
    after: APPAREL_CHROMA_STYLE_BY_NAME.opinionated,
  },
  {
    key: "opinionated-stripped",
    field: "prompt_prefix",
    before:
      "T-shirt graphic, bold stacked text typography, strong opinion statement, up to 6 words maximum, flat vibrant colors (avoid white, light colors), high contrast, centered, no shadow, no texture, no white mat, clean typographic layout. Create a bold text stack design of",
    after: APPAREL_CHROMA_STYLE_BY_NAME.opinionated,
  },
  {
    key: "quotes",
    field: "prompt_prefix",
    before:
      "T-shirt graphic, stylish quote typography, expressive lettering, flat vibrant colors (avoid white, light colors; DO NOT use solid hot pink (#FF00FF) or magenta in the design), high contrast, centered, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, creative typographic layout. Create a quote design of",
    after:
      "T-shirt graphic, stylish quote typography, expressive lettering, flat vibrant colors (avoid white, light colors), high contrast, centered, no shadow, no texture, no white mat, creative typographic layout. Create a quote design of",
  },
  {
    key: "pet portraits",
    field: "prompt_prefix",
    before:
      "T-shirt graphic, illustrated pet portrait, detailed character illustration, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat (DO NOT use solid hot pink (#FF00FF) or magenta anywhere in the main design — #FF00FF is reserved exclusively for the background mat), high contrast, centered, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, clean illustrated style. Create a pet portrait of",
    after:
      "T-shirt graphic, illustrated pet portrait, detailed character illustration, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat, high contrast, centered, no shadow, no texture, no white mat, clean illustrated style. Create a pet portrait of",
  },
  {
    key: "centered graphic",
    field: "prompt_prefix",
    before:
      "T-shirt graphic, centered flat vector illustration, bold clean shapes, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat (DO NOT use solid hot pink (#FF00FF) or magenta anywhere in the main design — #FF00FF is reserved exclusively for the background mat), high contrast, centered composition, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, no rectangular frame. Create a centered graphic of",
    after:
      "T-shirt graphic, centered flat vector illustration, bold clean shapes, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat, high contrast, centered composition, no shadow, no texture, no white mat, no rectangular frame. Create a centered graphic of",
  },
  {
    key: "illustrated motif",
    field: "prompt_prefix",
    before:
      "T-shirt graphic, illustrated character motif, detailed illustration, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat (DO NOT use solid hot pink (#FF00FF) or magenta anywhere in the main design — #FF00FF is reserved exclusively for the background mat), high contrast, centered, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, no rectangular frame, clean illustrated style. Create an illustrated motif of",
    after:
      "T-shirt graphic, illustrated character motif, detailed illustration, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat, high contrast, centered, no shadow, no texture, no white mat, no rectangular frame, clean illustrated style. Create an illustrated motif of",
  },
  {
    key: "pattern-maker",
    field: "prompt_prefix_dark",
    before:
      "Seamless repeating pattern design, tileable motif, clean vector shapes, bright vibrant colors including white and light tones (avoid dark, black; DO NOT use solid hot pink (#FF00FF) or magenta in the design), high contrast, isolated on a solid hot pink (#FF00FF) background. Create a repeating pattern of",
    after:
      "Seamless repeating pattern design, tileable motif, clean vector shapes, bright vibrant colors including white and light tones (avoid dark, black), high contrast. Create a repeating pattern of",
  },
  {
    key: "opinionated",
    field: "prompt_prefix_dark",
    before:
      "T-shirt graphic, bold stacked text typography, strong opinion statement, up to 6 words maximum, bright vibrant colors including white and light tones (avoid dark, black; DO NOT use solid hot pink (#FF00FF) or magenta in the design), high contrast, centered, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, clean typographic layout. Create a bold text stack design of",
    after: APPAREL_DARK_TIER_PROMPTS.opinionated,
  },
  {
    key: "opinionated-stripped",
    field: "prompt_prefix_dark",
    before:
      "T-shirt graphic, bold stacked text typography, strong opinion statement, up to 6 words maximum, bright vibrant colors including white and light tones (avoid dark, black), high contrast, centered, no shadow, no texture, clean typographic layout. Create a bold text stack design of",
    after: APPAREL_DARK_TIER_PROMPTS.opinionated,
  },
  {
    key: "quotes",
    field: "prompt_prefix_dark",
    before:
      "T-shirt graphic, stylish quote typography, expressive lettering, bright vibrant colors including white and light tones (avoid dark, black; DO NOT use solid hot pink (#FF00FF) or magenta in the design), high contrast, centered, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, creative typographic layout. Create a quote design of",
    after:
      "T-shirt graphic, stylish quote typography, expressive lettering, bright vibrant colors including white and light tones (avoid dark, black), high contrast, centered, no shadow, no texture, creative typographic layout. Create a quote design of",
  },
  {
    key: "pet-portraits",
    field: "prompt_prefix_dark",
    before:
      "T-shirt graphic, illustrated pet portrait, detailed character illustration, bright vibrant colors including white and light tones (avoid dark, black; DO NOT use solid hot pink (#FF00FF) or magenta anywhere in the main design — #FF00FF is reserved exclusively for the background mat), high contrast, centered, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, clean illustrated style. Create a pet portrait of",
    after:
      "T-shirt graphic, illustrated pet portrait, detailed character illustration, bright vibrant colors including white and light tones (avoid dark, black), high contrast, centered, no shadow, no texture, clean illustrated style. Create a pet portrait of",
  },
  {
    key: "centered-graphic",
    field: "prompt_prefix_dark",
    before:
      "T-shirt graphic, centered flat vector illustration, bold clean shapes, bright vibrant colors including white and light tones (avoid dark, black; DO NOT use solid hot pink (#FF00FF) or magenta anywhere in the main design — #FF00FF is reserved exclusively for the background mat), high contrast, centered composition, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, no rectangular frame. Create a centered graphic of",
    after:
      "T-shirt graphic, centered flat vector illustration, bold clean shapes, bright vibrant colors including white and light tones (avoid dark, black), high contrast, centered composition, no shadow, no texture, no white mat, no rectangular frame. Create a centered graphic of",
  },
  {
    key: "illustrated-motif",
    field: "prompt_prefix_dark",
    before:
      "T-shirt graphic, illustrated character motif, detailed illustration, bright vibrant colors including white and light tones (avoid dark, black; DO NOT use solid hot pink (#FF00FF) or magenta anywhere in the main design — #FF00FF is reserved exclusively for the background mat), high contrast, centered, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, no rectangular frame, clean illustrated style. Create an illustrated motif of",
    after:
      "T-shirt graphic, illustrated character motif, detailed illustration, bright vibrant colors including white and light tones (avoid dark, black), high contrast, centered, no shadow, no texture, no white mat, no rectangular frame, clean illustrated style. Create an illustrated motif of",
  },
  {
    key: "graphics-centered-graphic",
    field: "prompt_prefix",
    before:
      "Centered flat vector illustration for large-format print, bold clean shapes, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat (DO NOT use solid hot pink (#FF00FF) or magenta anywhere in the main design — #FF00FF is reserved exclusively for the background mat), high contrast, centered composition, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, no rectangular frame. Create a centered graphic of",
    after:
      "Centered flat vector illustration for large-format print, bold clean shapes, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat, high contrast, centered composition, no shadow, no texture, no white mat, no rectangular frame. Create a centered graphic of",
  },
  {
    key: "graphics-illustrated-motif",
    field: "prompt_prefix",
    before:
      "Illustrated character motif for large-format print and patterns, detailed illustration, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat (DO NOT use solid hot pink (#FF00FF) or magenta anywhere in the main design — #FF00FF is reserved exclusively for the background mat), high contrast, centered, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, no rectangular frame, clean illustrated style. Create an illustrated motif of",
    after:
      "Illustrated character motif for large-format print and patterns, detailed illustration, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat, high contrast, centered, no shadow, no texture, no white mat, no rectangular frame, clean illustrated style. Create an illustrated motif of",
  },
  {
    key: "graphics-pattern-maker",
    field: "prompt_prefix",
    before:
      "Seamless repeating pattern design for large-format products, tileable motif, clean vector shapes, flat colors (avoid white, light colors; DO NOT use solid hot pink (#FF00FF) or magenta in the design), high contrast, isolated on a solid hot pink (#FF00FF) background, no white mat, no rectangular frame. Create a repeating pattern of",
    after:
      "Seamless repeating pattern design for large-format products, tileable motif, clean vector shapes, flat colors (avoid white, light colors), high contrast, no white mat, no rectangular frame. Create a repeating pattern of",
  },
];

export function migrateStoredStyleLayer(text: string): string {
  const trimmed = (text || "").trim();
  if (!trimmed) return trimmed;
  for (const row of STYLE_LAYER_MIGRATIONS) {
    if (trimmed === row.before) return row.after;
  }
  if (/#ff00ff/i.test(trimmed) || /solid hot pink/i.test(trimmed) || /hot pink background/i.test(trimmed)) {
    return stripChromaFromStyleLayer(trimmed);
  }
  return trimmed;
}

/** Catalog style layers forced by stable catalog slug (boot + dirty-row repair). */
export const FORCE_STYLE_LAYER_BY_SLUG: Record<string, { light: string; dark?: string }> = {
  opinionated: {
    light: APPAREL_CHROMA_STYLE_BY_NAME.opinionated,
    dark: APPAREL_DARK_TIER_PROMPTS.opinionated,
  },
  quotes: {
    light: APPAREL_CHROMA_STYLE_BY_NAME.quotes,
    dark: APPAREL_DARK_TIER_PROMPTS.quotes,
  },
  "pet-portraits": {
    light: APPAREL_CHROMA_STYLE_BY_NAME["pet portraits"],
    dark: APPAREL_DARK_TIER_PROMPTS["pet-portraits"],
  },
  "centered-graphic": {
    light: APPAREL_CHROMA_STYLE_BY_NAME["centered graphic"],
    dark: APPAREL_DARK_TIER_PROMPTS["centered-graphic"],
  },
  "illustrated-motif": {
    light: APPAREL_CHROMA_STYLE_BY_NAME["illustrated motif"],
    dark: APPAREL_DARK_TIER_PROMPTS["illustrated-motif"],
  },
  "pattern-maker": {
    light: APPAREL_CHROMA_STYLE_BY_NAME["pattern maker"],
    dark: APPAREL_DARK_TIER_PROMPTS["pattern-maker"],
  },
  "graphics-centered-graphic": {
    light: GRAPHICS_CHROMA_STYLE_BY_ID["graphics-centered-graphic"],
  },
  "graphics-illustrated-motif": {
    light: GRAPHICS_CHROMA_STYLE_BY_ID["graphics-illustrated-motif"],
  },
  "graphics-pattern-maker": {
    light: GRAPHICS_CHROMA_STYLE_BY_ID["graphics-pattern-maker"],
  },
};

export function applyForcedStyleLayerBySlug(
  catalogSlug: string,
  current: string,
  field: "light" | "dark",
): string {
  const key = catalogSlug.trim().toLowerCase();
  const forced = FORCE_STYLE_LAYER_BY_SLUG[key];
  const target = field === "dark" ? forced?.dark : forced?.light;
  const migrated = migrateStoredStyleLayer(current);
  if (target && (/#ff00ff/i.test(current) || /solid hot pink/i.test(current) || /hot pink background/i.test(current))) {
    return target;
  }
  return migrated;
}
