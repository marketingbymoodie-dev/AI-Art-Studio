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
/**
 * Surface rules. The composer picks one from the product class.
 * Prop permission stays on apparel: one abstracted prop, a second person only as a partial mark.
 * Aspect, pixel size, background and transparency are not in these strings.
 */
export const PETPOSTEROUS_APPAREL_PRINT =
  "APPAREL PRINT: Finished print artwork only — no garment, mockup or photograph. Transparent surround, no rectangular boundary. No environments or interiors. The art style may call for up to one abstracted prop; a second person only as a partial mark — a hand, a foot, a sliver of silhouette — never a full figure. Strong outer silhouette, large forms readable at arm's length. The pet's pose and expression carry the joke.";

export const PETPOSTEROUS_DECOR_PRINT =
  "DECOR PRINT: Finished framed-print artwork — a composed rectangular picture with generous margins and nothing cropped at the edge. More detail and more depth than a garment graphic, but still a designed print, not a photograph or a painted scene. One spare setting is permitted, held as graphic shapes rather than scenery. The pet remains the dominant character and carries the joke.";

/** Tone and palette, once. Not copied into the style blocks. */
export const PETPOSTEROUS_BRAND =
  "PETPOSTEROUS: The animal is fully aware of what it is doing — guilty but unbothered, dignified about something ridiculous, in quiet control of the household. The humour is dry, observant and affectionate; never childish, cute or meme-like. Solid colours only, no gradients, no photorealism. Palette: Deep Ink, Warm Bone, Oxblood, Institutional Green, plus one species-appropriate accent. No paw prints, bones, hearts or pet-shop motifs.";

export type ArtStyleSurface = "apparel" | "decor";

/** Poster, pillow, tapestry and bedding are decor. Apparel, and anything unnamed, stays apparel. */
export function artStyleSurfaceForProduct(productFamily: string): ArtStyleSurface {
  const id = productFamily.trim().toLowerCase();
  if (id === "poster" || id === "pillow" || id === "tapestry" || id === "bedding") return "decor";
  return "apparel";
}

export function artStyleSurfaceRule(surface: ArtStyleSurface): string {
  return surface === "decor" ? PETPOSTEROUS_DECOR_PRINT : PETPOSTEROUS_APPAREL_PRINT;
}

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
  /** Six are the launch set. The other four stay until a bench run with the device layer. */
  launch: boolean;
  /** Apparel block. Drawing language only. */
  prompt: string;
  /** Decor block. Null means this style has not been rewritten for decor yet. */
  decor: string | null;
  /** Unassigned on purpose. Renderer choice is a later test, not a theory lock. */
  rendererId: null;
};

export const PETPOSTEROUS_ART_STYLE_LAUNCH = [
  "vintage-engraving",
  "pen-ink",
  "woodcut",
  "retro-character",
  "bold-type",
  "folk-graphic",
] as const;

export const PETPOSTEROUS_ART_STYLES: PetposterousArtStyle[] = [
  {
    id: "retro-character",
    label: "Retro Character",
    launch: true,
    rendererId: null,
    prompt:
      "RETRO CHARACTER — APPAREL: Vintage character tee. Confident hand-drawn outlines, simplified forms, chunky shadows, 3–5 spot inks, light halftone and print distress. The pet is an expressive character actor — knowing look, slightly exaggerated pose. Hand-lettered retro type that belongs to the drawing. No glossy vector mascot, no photorealism.",
    decor:
      "RETRO CHARACTER — DECOR: Mid-century character illustration composed as a print. Expressive posing, richer drawing, subtle print texture, a considered editorial layout. The pet is a fully formed household character. Domestic props and posture deliver the joke. 4–6 inks. A small caption or badge is permitted.",
  },
  {
    id: "woodcut",
    label: "Woodcut",
    launch: true,
    rendererId: null,
    prompt:
      "WOODCUT — APPAREL: Hand-carved woodcut or linocut. Solid ink masses and gouged negative-space marks; irregular carved lines describe fur, form and movement. One dominant ink, optional second accent; garment colour forms large parts of the image. Block-printed lettering. No digital shading, gradients or fine engraving detail.",
    decor:
      "WOODCUT — DECOR: A full relief print of a domestic incident. Carved ink texture, bold shadow masses, expressive gouged cuts, visible handmade printing character. Enough setting to place the incident, held as carved shapes rather than scenery. Two to three inks. A small printer's mark or footer is permitted.",
  },
  {
    id: "folk-graphic",
    label: "Folk Graphic",
    launch: true,
    rendererId: null,
    prompt:
      "FOLK GRAPHIC — APPAREL: Naïve hand-made folk art. Simplified anatomy, chunky shapes, charmingly awkward proportions, uneven hand-drawn contours, flattened forms. 2–5 warm muted inks. Genuinely hand-rendered lettering. Eccentric and intelligent rather than cute. No polished mascot art, no glossy rendering.",
    decor:
      "FOLK GRAPHIC — DECOR: A small domestic legend told as a folk print. Naïve handmade drawing, irregular symmetry, restrained decorative motifs, household objects arranged like a folk tale or a warning sign. 3–5 warm muted inks. Folk lettering or plain serif. Handcrafted warmth, never children's-book cuteness.",
  },
  {
    id: "pen-ink",
    label: "Pen & Ink",
    launch: true,
    rendererId: null,
    prompt:
      "PEN & INK — APPAREL: Sparse editorial pen drawing. Confident black contour, selective stippling, light hatching, large areas left completely open. One ink, a second only if essential. Detail concentrated at the face and the action, everything else economical. No washes, gradients, decorative frame or filler.",
    decor:
      "PEN & INK — DECOR: A literary pen-and-ink observation — a quiet forensic note on domestic absurdity. Elegant sparse linework, stippling, considered negative space, a calm editorial layout with real margins. A few telling objects may place the scene. One or two inks. Clever, cultured and faintly accusatory.",
  },
  {
    id: "vintage-engraving",
    label: "Vintage Engraving",
    launch: true,
    rendererId: null,
    prompt:
      "VINTAGE ENGRAVING — APPAREL: An antique engraved plate simplified for a garment. Bold engraved outline, restrained cross-hatching, controlled solid blacks, high contrast, strong silhouette. Monochrome or two inks. Period serif lettering. No parchment, book page, paper rectangle, museum card or frame. No crowns or aristocratic-pet tropes.",
    decor:
      "VINTAGE ENGRAVING — DECOR: A full antique engraved plate. Refined linework, stippling, dense cross-hatching, formal margins, small institutional captions and evidence labels. Treat the behaviour with the seriousness of a natural-history or legal case study. Two to three inks. The engraving is the artwork — no depicted parchment, book page or frame within the frame.",
  },
  {
    id: "conceptual-graphic",
    label: "Conceptual Graphic",
    launch: false,
    rendererId: null,
    decor: null,
    prompt:
      "CONCEPTUAL GRAPHIC: One visual idea, not an illustrated scene. Use silhouette, negative space, substitution, impossible scale, containment, merged shapes or visual metaphor drawn from the concept itself. Reduce to a few bold shapes in 1–3 inks. Prefer no text when the image carries the joke. No scene illustration, no portrait, no decoration.",
  },
  {
    id: "bold-type",
    label: "Bold Type",
    launch: true,
    rendererId: null,
    prompt:
      "BOLD TYPE — APPAREL: Typography leads. The supplied words dominate — large hand-lettered or vintage display type, strong hierarchy, deliberate line breaks. A small pet vignette integrates into, around or between the letterforms as one composition. 2–4 inks. No caption-under-image layout, no text box, no slogan template.",
    decor:
      "BOLD TYPE — DECOR: The words set as an official household declaration. Refined serif or institutional sans, strong typographic hierarchy, formal margins, a composed editorial grid. The pet appears within the layout as evidence, witness or culprit. Bureaucratically absurd and entirely straight-faced. Small file or case labels are permitted.",
  },
  {
    id: "ornamental",
    label: "Ornamental",
    launch: false,
    rendererId: null,
    decor: null,
    prompt:
      "ORNAMENTAL: Storybook and Arts-and-Crafts decoration with restrained Art Nouveau line. Pet central; flowing organic curves and botanical forms interwoven around it, relating to the story. Graceful contour, flattened decorative shapes, 3–5 inks. Ornament supports and never overwhelms. No rectangular poster reproduction.",
  },
  {
    id: "painterly",
    label: "Painterly",
    launch: false,
    rendererId: null,
    decor: null,
    prompt:
      "PAINTERLY: Gouache and watercolour character — visible brushwork, pigment variation, edges defined where they matter and dissolving where they don't. Richest pigment at the face and the action. 4–7 harmonious colours. Keep a deliberate silhouette. No paper, canvas, easel, frame or white page — the painting is the print.",
  },
  {
    id: "psychedelic",
    label: "Psychedelic",
    launch: false,
    rendererId: null,
    decor: null,
    prompt:
      "PSYCHEDELIC: Late-60s/70s poster language. Warped flowing forms, chunky hand-drawn shapes, swelling retro display lettering interlocking with the illustration. 4–6 saturated retro inks — burnt orange, mustard, avocado, turquoise, coral, deep brown. Slight surreal exaggeration. No tie-dye background, no hippie symbols, no gradients.",
  },
];

export function petposterousArtStyle(id: unknown): PetposterousArtStyle | undefined {
  return PETPOSTEROUS_ART_STYLES.find((style) => style.id === id);
}

/** Decor uses the decor block when one exists. The four untested styles still have apparel text only. */
export function artStyleBlock(style: PetposterousArtStyle, surface: ArtStyleSurface = "apparel"): string {
  if (surface === "decor" && style.decor) return style.decor;
  return style.prompt;
}

export function artStyleMarker(style: PetposterousArtStyle, surface: ArtStyleSurface = "apparel"): string {
  const block = artStyleBlock(style, surface);
  const match = /^[^:\n]+:/.exec(block);
  return match?.[0] ?? block.slice(0, 24);
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
 * A truth can name the dispute ("the bed", "the sofa", "the lead").
 * Those nouns are not flags. A shot names where a body is, a prop's state,
 * a camera, or a second person.
 */
const ART_STYLE_SHOT_FLAGS: { kind: string; pattern: RegExp }[] = [
  { kind: "second person", pattern: /\b(owner|driver|human|person|someone|man|woman)\b/i },
  { kind: "staging", pattern: /\b(door|waiting|camera|interior|looking back|standing at|sitting on)\b/i },
  { kind: "position", pattern: /\b(front seat|back seat|passenger seat|in the front|in the back|beside|behind)\b/i },
];

/** Truths the validator must leave alone, including ones that name the disputed object. */
export const ART_STYLE_TRUTH_PASS = [
  "the dog has decided the bed is not for sharing",
  "he sneezes when he wants something",
  "she considers the sofa hers",
  "he refuses to acknowledge the lead",
] as const;

/** Truths the validator must flag. Each one is a picture, not a dispute. */
export const ART_STYLE_TRUTH_FAIL = [
  "dog in the front seat, door open, owner waiting",
  "cat sitting on the keyboard while the owner types",
  "dog standing at the door looking back",
] as const;

export function artStyleConceptShotFlags(text: string): string[] {
  const found: string[] = [];
  for (const rule of ART_STYLE_SHOT_FLAGS) {
    if (rule.pattern.test(text)) found.push(rule.kind);
  }
  return found;
}

export type SettledArtStyleTruth = {
  /** What renders unless the probe operator chooses the rejected original. */
  funnyTruth: string;
  punchline: string;
  /** Flags on funnyTruth. Empty means the default render is clean. */
  shotFlags: string[];
  originalTruth: string;
  originalFlags: string[];
  rewritten: boolean;
  /** The rewrite text when one was attempted, including a rewrite that still flags. */
  rewriteAttempt: string;
  rewriteFlags: string[];
};

/**
 * A clean truth is kept. A flagged truth is replaced by a clean rewrite.
 * If the rewrite still flags, the original stays and shotFlags stays set,
 * so the probe can render that original on purpose.
 */
export function settleArtStyleTruth(original: string, punchline: string, rewrite: string | null): SettledArtStyleTruth {
  const originalTruth = original.replace(/\s+/g, " ").trim();
  const words = punchline.replace(/\s+/g, " ").trim();
  const originalFlags = artStyleConceptShotFlags(originalTruth);
  const attempt = (rewrite || "").replace(/\s+/g, " ").trim();
  if (originalFlags.length === 0) {
    return {
      funnyTruth: originalTruth,
      punchline: words,
      shotFlags: [],
      originalTruth,
      originalFlags: [],
      rewritten: false,
      rewriteAttempt: "",
      rewriteFlags: [],
    };
  }
  const rewriteFlags = attempt ? artStyleConceptShotFlags(attempt) : [];
  if (attempt && rewriteFlags.length === 0) {
    return {
      funnyTruth: attempt,
      punchline: words,
      shotFlags: [],
      originalTruth,
      originalFlags,
      rewritten: true,
      rewriteAttempt: attempt,
      rewriteFlags: [],
    };
  }
  return {
    funnyTruth: originalTruth,
    punchline: words,
    shotFlags: originalFlags,
    originalTruth,
    originalFlags,
    rewritten: false,
    rewriteAttempt: attempt,
    rewriteFlags,
  };
}

/**
 * Short form is the only art-style compose. `length` is accepted so older
 * probe clients still resolve, and it no longer selects a longer prompt.
 * Concept and words are arguments. This function does not read the pinned batch.
 * Shared print and type rules sit once, immediately before the style block.
 */
/** Truth and words. The device is the next block, then the shared rules and the style. */
export function artStyleConceptHeading(concept: string, words: string): string {
  const clean = concept.replace(/\s+/g, " ").trim().replace(/\.+$/, "");
  if (!clean) return "";
  const wording = words.replace(/\s+/g, " ").trim();
  return [`CONCEPT: ${clean}.`, wording ? `Exact wording, once: ${wording}` : ""].filter(Boolean).join("\n");
}

export function artStyleDeviceLine(device: string): string {
  const clean = device.replace(/\s+/g, " ").trim().replace(/\.+$/, "");
  if (!clean) return "";
  return `DEVICE: ${clean}.`;
}

export function composePetposterousArtStylePrompt(opts: {
  styleId: string;
  /** Funny truth only. Not a camera, a prop state, or a second person. */
  concept: string;
  /** Exact wording. Empty string means the design has no text line. */
  words: string;
  /** How this style turns the truth into a graphic. One sentence. */
  device: string;
  /** Product class. Wins over `surface` when both are set. */
  productFamily?: string;
  surface?: ArtStyleSurface;
  length?: "full" | "short";
}): { prompt: string; style: PetposterousArtStyle; surface: ArtStyleSurface; length: "short" } {
  const style = petposterousArtStyle(opts.styleId);
  if (!style) throw new Error(`Unknown art style "${opts.styleId}"`);
  void opts.length;
  const surface = opts.productFamily ? artStyleSurfaceForProduct(opts.productFamily) : (opts.surface ?? "apparel");
  const heading = artStyleConceptHeading(opts.concept, opts.words);
  if (!heading.startsWith("CONCEPT:")) throw new Error("Art style compose needs a concept");
  const deviceLine = artStyleDeviceLine(opts.device);
  if (!deviceLine) throw new Error("Art style compose needs a device");
  const block = artStyleBlock(style, surface);
  const prompt = [heading, deviceLine, artStyleSurfaceRule(surface), PETPOSTEROUS_BRAND, PETPOSTEROUS_TYPE_RESTRAINT, block]
    .filter(Boolean)
    .join("\n\n");
  return { prompt, style, surface, length: "short" };
}
