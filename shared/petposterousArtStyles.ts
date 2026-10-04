/**
 * Petposterous apparel ART STYLE layer.
 *
 * Joke frameworks (shared/petposterousCreative.ts) say what kind of joke.
 * These styles say what visual language the joke is drawn in. Tone, narrative
 * treatment, composition and print treatment are separate roles and are not
 * customer controls.
 *
 * The style block owns composition. The concept states the funny truth only —
 * not a camera, a prop state, or a second person. Nothing above the style
 * block may specify pose, framing, placement or layout. The shared print and
 * type rules are not copied into each style.
 *
 * This path does not call the pack composer. That stack, and PRODUCT AUTHORITY
 * on the six-look path, are what collapsed every style into one shot.
 */
/** Shared print rule. The object budget lives here so the concept cannot ask for an interior. */
export const PETPOSTEROUS_APPAREL_PRINT =
  "APPAREL PRINT: Finished print artwork only — no garment, mockup, photograph or product shot. Transparent surround, no rectangular boundary. One subject, at most one supporting object; no vehicle interiors, rooms or architecture. Strong outer silhouette and large forms readable at arm's length. The pet's pose and expression carry the joke. Reproduce supplied wording exactly once and invent no other text.";

/** Bans decoration around the letters. Ornament remains allowed when the style itself asks for it. */
export const PETPOSTEROUS_TYPE_RESTRAINT =
  "TYPE: Set the words plainly within the composition. No dashes, rules, lines, ticks or bars flanking them; no starbursts, sparkles, radiating lines, speed lines or impact marks; no swashes, scrolls, banners, ribbons, laurels, asterisks, dots or diamond separators bracketing a phrase. The words stand on their own. Ornament appears only where the art style calls for it, as part of the illustration — never as default decoration around type.";

/** Roles kept out of the customer UI so they are not folded back into art style. */
export const PETPOSTEROUS_SECONDARY_ROLES = {
  tone: ["Deadpan"],
  narrativeTreatment: ["Field Notes", "Domestic Cinema"],
  composition: ["Portrait", "Badge", "Vignette"],
  subjectTreatment: ["Character"],
  printTreatment: ["Single Ink", "Duotone", "Distressed", "Clean"],
  distributedAcrossArtStyles: ["Vintage Print"],
} as const;

/**
 * Phrases removed from above the style block. They are how the previous
 * apparel compose froze one spaniel in one seat.
 */
export const PETPOSTEROUS_COMPOSITION_LOCKS = [
  "Isolated centered graphic",
  "Isolated motif",
  "no background scene",
  "clean crisp edges",
  "chest-print vignette",
  "compact garment-friendly composition",
  "PRODUCT AUTHORITY",
  "overrides any framework or look instruction about composition",
  "for screen printing",
] as const;

export type PetposterousArtStyle = {
  id: string;
  label: string;
  /** Drawing language. Owns composition. No shared apparel rule inside. */
  prompt: string;
  /** Unassigned on purpose. Renderer choice is a later test, not a theory lock. */
  rendererId: null;
};

export const PETPOSTEROUS_ART_STYLES: PetposterousArtStyle[] = [
  {
    id: "retro-character",
    label: "Retro Character",
    rendererId: null,
    prompt:
      "RETRO CHARACTER: Vintage character-tee illustration. Confident hand-drawn outlines, simplified forms, chunky shadows, 3–5 spot inks, light halftone texture. The pet is an expressive character actor — knowing look, slightly exaggerated pose. Hand-lettered retro type that belongs to the drawing. No photorealism, no glossy vector mascot.",
  },
  {
    id: "woodcut",
    label: "Woodcut",
    rendererId: null,
    prompt:
      "WOODCUT: Hand-carved woodcut or linocut. Build the image from solid ink areas and gouged negative-space marks; irregular carved lines describe fur, form and movement. One dominant ink, optional second accent; garment colour forms large parts of the image. Block-printed lettering. No digital shading, gradients or fine engraving detail.",
  },
  {
    id: "folk-graphic",
    label: "Folk Graphic",
    rendererId: null,
    prompt:
      "FOLK GRAPHIC: Naïve hand-made folk art. Simplified anatomy, chunky shapes, charmingly awkward proportions, uneven hand-drawn contours, flattened forms. 2–5 warm muted inks. Genuinely hand-rendered lettering. Eccentric and intelligent rather than cute. No polished mascot art, no glossy rendering.",
  },
  {
    id: "pen-ink",
    label: "Pen & Ink",
    rendererId: null,
    prompt:
      "PEN & INK: Sparse editorial pen drawing. Confident black contour, selective cross-hatching and stippling, large areas left completely open. One ink, a second only if essential. Detail concentrated at the face and the action; everything else economical. No washes, gradients, frames or extra text.",
  },
  {
    id: "vintage-engraving",
    label: "Vintage Engraving",
    rendererId: null,
    prompt:
      "VINTAGE ENGRAVING: Antique engraved plate — refined linework, cross-hatching, stippling, controlled solid blacks. Treat the ridiculous behaviour with scholarly dignity. Monochrome or 2–3 muted inks. Period serif lettering. No parchment, book page, paper rectangle, museum card or frame. No crowns or aristocratic-pet tropes.",
  },
  {
    id: "conceptual-graphic",
    label: "Conceptual Graphic",
    rendererId: null,
    prompt:
      "CONCEPTUAL GRAPHIC: One visual idea, not an illustrated scene. Use silhouette, negative space, substitution, impossible scale, containment, merged shapes or visual metaphor drawn from the concept itself. Reduce to a few bold shapes in 1–3 inks. Prefer no text when the image carries the joke. No scene illustration, no portrait, no decoration.",
  },
  {
    id: "bold-type",
    label: "Bold Type",
    rendererId: null,
    prompt:
      "BOLD TYPE: Typography leads. The supplied words dominate — large hand-lettered or vintage display type, strong hierarchy, deliberate line breaks. A small pet vignette integrates into, around or between the letterforms as one composition. 2–4 inks. No caption-under-image layout, no text box, no slogan template.",
  },
  {
    id: "ornamental",
    label: "Ornamental",
    rendererId: null,
    prompt:
      "ORNAMENTAL: Storybook and Arts-and-Crafts decoration with restrained Art Nouveau line. Pet central; flowing organic curves and botanical forms interwoven around it, relating to the story. Graceful contour, flattened decorative shapes, 3–5 inks. Ornament supports and never overwhelms. No rectangular poster reproduction.",
  },
  {
    id: "painterly",
    label: "Painterly",
    rendererId: null,
    prompt:
      "PAINTERLY: Gouache and watercolour character — visible brushwork, pigment variation, edges defined where they matter and dissolving where they don't. Richest pigment at the face and the action. 4–7 harmonious colours. Keep a deliberate silhouette. No paper, canvas, easel, frame or white page — the painting is the print.",
  },
  {
    id: "psychedelic",
    label: "Psychedelic",
    rendererId: null,
    prompt:
      "PSYCHEDELIC: Late-60s/70s poster language. Warped flowing forms, chunky hand-drawn shapes, swelling retro display lettering interlocking with the illustration. 4–6 saturated retro inks — burnt orange, mustard, avocado, turquoise, coral, deep brown. Slight surreal exaggeration. No tie-dye background, no hippie symbols, no gradients.",
  },
];

export function petposterousArtStyle(id: unknown): PetposterousArtStyle | undefined {
  return PETPOSTEROUS_ART_STYLES.find((style) => style.id === id);
}

export function artStyleMarker(style: PetposterousArtStyle): string {
  const match = /^[A-Z0-9 &]+:/.exec(style.prompt);
  return match?.[0] ?? style.prompt.slice(0, 24);
}

export function compositionLocksAboveStyle(prompt: string, styleMarker: string): string[] {
  const at = prompt.indexOf(styleMarker);
  const head = at >= 0 ? prompt.slice(0, at) : prompt;
  const lower = head.toLowerCase();
  return PETPOSTEROUS_COMPOSITION_LOCKS.filter((phrase) => lower.includes(phrase.toLowerCase()));
}

/**
 * Fixed inputs for the apparel style QA batch.
 * The concept is the funny truth only. Position, props and a second person
 * belong to the style. The behaviour string is batch metadata and is not composed.
 * Hostile Negotiations stays pinned on the row; its shot language is not composed.
 */
export const PETPOSTEROUS_ART_STYLE_BATCH = {
  behaviour: "dog refuses to get into the back seat of the car",
  concept: "the dog has claimed the passenger seat and will not move",
  frameworkId: "pp-hostile-negotiations" as const,
  words: "PASSENGER SELECTED.",
  humorId: "dry" as const,
  relationshipId: "rivals" as const,
  aspectRatio: "1:1" as const,
  rendererId: "openai-flare" as const,
  quality: "medium" as const,
  background: "transparent" as const,
  referenceLabel: "springer spaniel",
  referencePhotoId: "5eb9654283a8ab16",
};

/**
 * A truth can name the joke. A shot names where bodies are, a prop's state,
 * or a second person — and then every style draws that shot.
 */
const ART_STYLE_SHOT_FLAGS: { kind: string; pattern: RegExp }[] = [
  { kind: "second person", pattern: /\b(owner|driver|human|person|someone|man|woman)\b/i },
  { kind: "staging", pattern: /\b(door|waiting|camera|interior)\b/i },
  { kind: "position", pattern: /\b(front seat|back seat|in the front|in the back|beside|behind)\b/i },
];

export function artStyleConceptShotFlags(text: string): string[] {
  const found: string[] = [];
  for (const rule of ART_STYLE_SHOT_FLAGS) {
    if (rule.pattern.test(text)) found.push(rule.kind);
  }
  return found;
}

/**
 * Short form is the only art-style compose. `length` is accepted so older
 * probe clients still resolve, and it no longer selects a longer prompt.
 * Concept and words are arguments. This function does not read the pinned batch.
 * Shared print and type rules sit once, immediately before the style block.
 */
/** The two lines that change per idea. Shared print rules and the style block follow. */
export function artStyleConceptHeading(concept: string, words: string): string {
  const clean = concept.replace(/\s+/g, " ").trim().replace(/\.+$/, "");
  if (!clean) return "";
  const wording = words.replace(/\s+/g, " ").trim();
  return [`CONCEPT: ${clean}.`, wording ? `Exact wording, once: ${wording}` : ""].filter(Boolean).join("\n");
}

export function composePetposterousArtStylePrompt(opts: {
  styleId: string;
  /** Funny truth only. Not a camera, a prop state, or a second person. */
  concept: string;
  /** Exact wording. Empty string means the design has no text line. */
  words: string;
  length?: "full" | "short";
}): { prompt: string; style: PetposterousArtStyle; length: "short" } {
  const style = petposterousArtStyle(opts.styleId);
  if (!style) throw new Error(`Unknown art style "${opts.styleId}"`);
  void opts.length;
  const heading = artStyleConceptHeading(opts.concept, opts.words);
  if (!heading.startsWith("CONCEPT:")) throw new Error("Art style compose needs a concept");
  const prompt = [heading, PETPOSTEROUS_APPAREL_PRINT, PETPOSTEROUS_TYPE_RESTRAINT, style.prompt]
    .filter(Boolean)
    .join("\n\n");
  return { prompt, style, length: "short" };
}
