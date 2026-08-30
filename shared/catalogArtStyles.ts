/**
 * Platform catalog art styles added 2026-08 (Vintage Print, One-Color Print,
 * Retro Sunset Stack, Playful Cartoon) + Minimalist override of minimal-line.
 */

export const ART_STYLE_VERBATIM_PLACEHOLDER =
  'Describe what you want — or put your own words in "quotes" to use them exactly.';

export const VINTAGE_PRINT_STYLE =
  "Vintage screen-print graphic, distressed worn texture with faded ink and subtle cracks as if aged, muted retro color palette, halftone shading, slightly off-register print feel, warm nostalgic tones, balanced classic composition, high-quality aged apparel print look.";

export const ONE_COLOR_PRINT_STYLE =
  "Single-color print, one ink only, clean high-contrast silhouette and linework, no gradients, no halftones, generous negative space, bold simple shapes, refined minimal composition, screen-print-ready flat design, striking against the garment.";

export const RETRO_SUNSET_STACK_STYLE =
  "Retro graphic with a bold horizontal sunset backdrop of stacked warm stripes (70s-inspired sun and banded gradient), strong hero composition, high-contrast layered elements, vintage warm palette (oranges, golds, rusts, teal accents), centered and symmetrical, punchy nostalgic print.";

export const PLAYFUL_CARTOON_STYLE =
  "Playful cartoon graphic, friendly mascot-style character, bold clean outlines, flat vibrant cheerful fills, sticker-art composition, expressive and characterful, lively rounded shapes, mass-appeal fun print.";

/** Apparel treatment for Minimalist. Decor keeps the stored full-bleed prefix. */
export const MINIMALIST_APPAREL_STYLE =
  "Minimalist print, sparse and elegant, thin clean lines, a single small focal motif, extensive negative space, restrained one- or two-color palette, refined and understated composition, plenty of breathing room, modern simplicity.";

/** Existing decor style layer — do not replace on apparel-only reseed. */
export const MINIMAL_LINE_DECOR_STYLE =
  "A minimalist full-bleed single-line art drawing with a complete background that extends to all edges of the canvas of";

export const NEW_APPAREL_CATALOG_SLUGS = [
  "vintage-print",
  "one-color-print",
  "retro-sunset-stack",
  "playful-cartoon",
] as const;

export const VERBATIM_SHORTCUT_CATALOG_SLUGS = new Set<string>([
  "quotes",
  "vintage-print",
  "one-color-print",
  "retro-sunset-stack",
  "playful-cartoon",
  "minimal-line",
]);

export function isVerbatimShortcutCatalogSlug(slug: string | null | undefined): boolean {
  return VERBATIM_SHORTCUT_CATALOG_SLUGS.has(String(slug || "").trim().toLowerCase());
}

export function isMinimalLineCatalogSlug(slug: string | null | undefined): boolean {
  return String(slug || "").trim().toLowerCase() === "minimal-line";
}

/** Fields copied into style_presets on seed / reseed / all-merchant insert. */
export function catalogRowFieldsFromPreset(preset: {
  id: string;
  name: string;
  promptPrefix: string;
  category: string;
  promptPlaceholder?: string;
  generationQuality?: string;
  userSlotSchema?: unknown;
  outputMode?: string;
}): {
  name: string;
  catalogSlug: string | null;
  promptPrefix: string;
  category: string;
  promptPlaceholder: string | null;
  generationQuality: string | null;
  userSlotSchema: unknown;
  outputMode: string | null;
} {
  const verbatim = isVerbatimShortcutCatalogSlug(preset.id);
  return {
    name: preset.name,
    catalogSlug: preset.id === "none" ? null : preset.id,
    promptPrefix: preset.promptPrefix,
    category: preset.category,
    promptPlaceholder: preset.promptPlaceholder ?? null,
    generationQuality: preset.generationQuality ?? null,
    userSlotSchema: verbatim ? null : (preset.userSlotSchema ?? null),
    outputMode: preset.outputMode ?? null,
  };
}
