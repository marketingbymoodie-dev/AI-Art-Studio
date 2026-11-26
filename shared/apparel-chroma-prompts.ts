/**
 * Apparel style-layer fragments (creative treatment only).
 * Print base (chroma vs transparent) is applied at compose time from category + model.
 * DB `style_presets.prompt_prefix` / `prompt_prefix_dark` are the live source
 * of truth after deploy; these are fallbacks for empty or legacy rows.
 */

export const NO_HOT_PINK_IN_DESIGN =
  "DO NOT use solid hot pink (#FF00FF) or magenta anywhere in the main design — #FF00FF is reserved exclusively for the background mat";

export const NO_HOT_PINK_IN_DESIGN_SHORT =
  "DO NOT use solid hot pink (#FF00FF) or magenta in the design";

/** Light-garment style layers keyed by lowercased style name. */
export const APPAREL_CHROMA_STYLE_BY_NAME: Record<string, string> = {
  "free 4 all": "",
  "pattern maker":
    "Seamless repeating pattern design, tileable motif, clean vector shapes, flat colors (avoid white, light colors), high contrast, no white mat, no rectangular frame. Create a repeating pattern of",
  opinionated:
    "Statement-tee graphic, strong opinion statement, up to 6 words maximum, flat vibrant colors (avoid white, light colors), high contrast, centered, no shadow, no texture, no white mat.",
  quotes:
    "Isolated t-shirt graphic, high contrast, centered, garment-safe colors (avoid white, light colors), no white mat.",
  "pet portraits":
    "T-shirt graphic, illustrated pet portrait, detailed character illustration, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat, high contrast, centered, no shadow, no texture, no white mat, clean illustrated style. Create a pet portrait of",
  "centered graphic":
    "T-shirt graphic, centered flat vector illustration, bold clean shapes, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat, high contrast, centered composition, no shadow, no texture, no white mat, no rectangular frame. Create a centered graphic of",
  "illustrated motif":
    "T-shirt graphic, illustrated character motif, detailed illustration, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat, high contrast, centered, no shadow, no texture, no white mat, no rectangular frame, clean illustrated style. Create an illustrated motif of",
  "vintage print":
    "Vintage screen-print graphic, distressed worn texture with faded ink and subtle cracks as if aged, muted retro color palette, halftone shading, slightly off-register print feel, warm nostalgic tones, balanced classic composition, high-quality aged apparel print look.",
  "one color print":
    "Single-color print, one ink only, clean high-contrast silhouette and linework, no gradients, no halftones, generous negative space, bold simple shapes, refined minimal composition, screen-print-ready flat design, striking against the garment.",
  "retro sunset stack":
    "Retro graphic with a bold horizontal sunset backdrop of stacked warm stripes (70s-inspired sun and banded gradient), strong hero composition, high-contrast layered elements, vintage warm palette (oranges, golds, rusts, teal accents), centered and symmetrical, punchy nostalgic print.",
  "playful cartoon":
    "Playful cartoon graphic, friendly mascot-style character, bold clean outlines, flat vibrant cheerful fills, sticker-art composition, expressive and characterful, lively rounded shapes, mass-appeal fun print.",
  minimalist:
    "Minimalist print, sparse and elegant, thin clean lines, a single small focal motif, extensive negative space, restrained one- or two-color palette, refined and understated composition, plenty of breathing room, modern simplicity.",
};

/** Dark-garment style layers keyed by style preset id (e.g. illustrated-motif). */
export const APPAREL_DARK_TIER_PROMPTS: Record<string, string> = {
  "free-4-all": "",
  "pattern-maker":
    "Seamless repeating pattern design, tileable motif, clean vector shapes, bright vibrant colors including white and light tones (avoid dark, black), high contrast. Create a repeating pattern of",
  opinionated:
    "Statement-tee graphic, strong opinion statement, up to 6 words maximum, bright vibrant colors including white and light tones (avoid dark, black), high contrast, centered, no shadow, no texture.",
  quotes:
    "Isolated t-shirt graphic, high contrast, centered, bright vibrant colors including white and light tones (avoid dark, black), no white mat.",
  "pet-portraits":
    "T-shirt graphic, illustrated pet portrait, detailed character illustration, bright vibrant colors including white and light tones (avoid dark, black), high contrast, centered, no shadow, no texture, clean illustrated style. Create a pet portrait of",
  "centered-graphic":
    "T-shirt graphic, centered flat vector illustration, bold clean shapes, bright vibrant colors including white and light tones (avoid dark, black), high contrast, centered composition, no shadow, no texture, no white mat, no rectangular frame. Create a centered graphic of",
  "illustrated-motif":
    "T-shirt graphic, illustrated character motif, detailed illustration, bright vibrant colors including white and light tones (avoid dark, black), high contrast, centered, no shadow, no texture, no white mat, no rectangular frame, clean illustrated style. Create an illustrated motif of",
  "vintage-print":
    "Vintage screen-print graphic, distressed worn texture with faded ink and subtle cracks as if aged, muted retro color palette, halftone shading, slightly off-register print feel, warm nostalgic tones, balanced classic composition, high-quality aged apparel print look.",
  "one-color-print":
    "Single-color print, one ink only, clean high-contrast silhouette and linework, no gradients, no halftones, generous negative space, bold simple shapes, refined minimal composition, screen-print-ready flat design, striking against the garment.",
  "retro-sunset-stack":
    "Retro graphic with a bold horizontal sunset backdrop of stacked warm stripes (70s-inspired sun and banded gradient), strong hero composition, high-contrast layered elements, vintage warm palette (oranges, golds, rusts, teal accents), centered and symmetrical, punchy nostalgic print.",
  "playful-cartoon":
    "Playful cartoon graphic, friendly mascot-style character, bold clean outlines, flat vibrant cheerful fills, sticker-art composition, expressive and characterful, lively rounded shapes, mass-appeal fun print.",
  "minimal-line":
    "Minimalist print, sparse and elegant, thin clean lines, a single small focal motif, extensive negative space, restrained one- or two-color palette, refined and understated composition, plenty of breathing room, modern simplicity.",
  none: "",
};

export function isChromaSafeApparelPrefix(prefix: string): boolean {
  const lower = prefix.trim().toLowerCase();
  return lower.includes("#ff00ff") || lower.includes("hot pink");
}
