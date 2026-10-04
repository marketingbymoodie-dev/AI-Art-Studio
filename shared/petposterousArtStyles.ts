/**
 * Petposterous apparel ART STYLE layer.
 *
 * Joke frameworks (shared/petposterousCreative.ts) say what kind of joke.
 * These styles say what visual language the joke is drawn in. Tone, narrative
 * treatment, composition and print treatment are separate roles and are not
 * customer controls.
 *
 * The style block owns composition. Nothing above it may freeze pose, camera,
 * framing, placement or layout. The shared apparel rule is print constraints
 * only, and it is not copied into each style.
 */
import { PETPOSTEROUS_PROMPT_PROFILE } from "./packs/petposterous";
import { PETPOSTEROUS_CONCEPT_FRAMEWORKS } from "./petposterousCreative";
import { composeLayeredPrompt, type PackPromptLayers } from "./promptLayers";
import { buildRoleReferenceInstruction } from "./referenceImages";

export const PETPOSTEROUS_APPAREL_OUTPUT_RULE =
  "APPAREL OUTPUT RULE: Create the finished print artwork only, not a T-shirt, garment, product mockup, poster or photograph of printed artwork. Design specifically for front-of-garment printing. Create one strong self-contained composition with transparent space surrounding the artwork and no rectangular scene boundary. Prioritise a clear outer silhouette, large readable forms and strong visual hierarchy at normal T-shirt viewing distance. Avoid tiny peripheral details, fragile isolated marks and unnecessary scenery. The pet's action, expression, pose or relationship with another subject must communicate the joke visually; do not simply draw the pet sitting or posing and place a caption underneath it. Allow the garment color to participate naturally as negative space. If exact wording is supplied, reproduce it exactly once and integrate it intentionally into the composition. Do not invent additional slogans, labels or text. No generic paw prints, bones, hearts, whisker motifs or generic pet-store decoration.";

/**
 * Replaces APPAREL_BASE_TRANSPARENT on this path only. The global base still
 * says "isolated centered graphic" / "no background scene" for classic apparel.
 * Native transparency itself is the OpenAI background flag plus alpha cleanup,
 * not this sentence.
 */
export const PETPOSTEROUS_ART_STYLE_PLATE =
  "PETPOSTEROUS TRANSPARENT PLATE: Pixels that are not ink in the finished print are fully transparent. No white mat, no rectangular card, no ground shadow, no product mockup.";

const CONCEPT_AUTHORITY =
  "CONCEPT AUTHORITY: The concept states what is true about the behaviour and the joke. The art style decides how the picture is drawn and may reinterpret the shot.";

const FRAMEWORK_SCOPE =
  "FRAMEWORK SCOPE: The joke framework names the kind of joke. It does not decide pose, camera, framing, subject placement or layout. The art style does.";

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
      "RETRO CHARACTER STYLE: Create a purpose-built illustrated T-shirt graphic with the personality of a vintage character tee. Render the pet as an expressive character actor with clear body language, a knowing expression and a slightly exaggerated pose while preserving recognisable traits from supplied reference imagery. Use confident hand-drawn outlines, simplified forms, chunky shadows and a limited palette of approximately 3–5 harmonious spot-ink colors. Use subtle vintage screen-print texture, halftone or natural ink imperfection without sacrificing clarity. Build one compact graphic with a strong irregular outer silhouette and deliberate negative space. If wording is required, integrate it naturally using bold hand-lettered retro typography that belongs to the illustration rather than sitting beneath it as a generic caption. The pet's behaviour must deliver the visual joke. Avoid photorealism, glossy digital rendering, generic vector mascots and excessive distress.",
  },
  {
    id: "woodcut",
    label: "Woodcut",
    rendererId: null,
    prompt:
      "WOODCUT STYLE: Create a bold hand-carved woodcut or linocut-style apparel illustration. Construct the image from strong areas of solid ink and expressive carved negative-space marks. Use irregular gouged lines to describe fur, form, light, movement and expression. Prioritise a striking silhouette and large readable shapes rather than fine realistic detail. Use one dominant ink color, optionally with one secondary accent ink, allowing the garment color to form substantial portions of the illustration. Preserve the pet's recognisable characteristics while translating them convincingly into relief-print language. Include subtle manual printing imperfections while retaining crisp apparel readability. Any required typography should feel hand-cut or block-printed and integrated into the same visual language. No smooth digital shading, gradients, photorealism, tiny engraving detail or rectangular background.",
  },
  {
    id: "folk-graphic",
    label: "Folk Graphic",
    rendererId: null,
    prompt:
      "FOLK GRAPHIC STYLE: Create a whimsical hand-made folk-art apparel graphic using simplified anatomy, chunky shapes, charmingly awkward proportions and intentionally irregular drawing. Preserve distinctive pet markings and personality while translating the subject into bold naïve forms. Use uneven hand-drawn or block-print-like contours, repeated handmade marks and flattened graphic shapes rather than realistic modelling. Use approximately 2–5 warm, muted, print-friendly colors. Small household, botanical or behavioural objects may support the story only when they contribute directly to the joke. Keep the composition compact and immediately readable. Any lettering should feel genuinely hand-rendered and integrated into the artwork. Aim for intelligent, eccentric handmade charm rather than childish cuteness. Avoid polished mascot illustration, glossy digital rendering, elaborate scenery and generic cute-pet styling.",
  },
  {
    id: "pen-ink",
    label: "Pen & Ink",
    rendererId: null,
    prompt:
      "PEN & INK STYLE: Create a clean hand-drawn pen-and-ink apparel illustration using confident black contour lines, selective cross-hatching and stippling. Use the garment itself as the background and leave generous areas completely open. Preserve recognisable pet characteristics while simplifying photographic detail into expressive line drawing. Communicate the joke primarily through pose, scale, gaze, interaction or an absurd visual situation rather than elaborate scenery. Concentrate detail around important facial, behavioural and interaction cues while keeping secondary areas economical. Primarily use one ink color, with a second accent only when it materially improves the concept. The result should feel like sophisticated editorial illustration adapted for a T-shirt. No washes, gradients, photorealism, heavy distress, decorative frame or unnecessary typography.",
  },
  {
    id: "vintage-engraving",
    label: "Vintage Engraving",
    rendererId: null,
    prompt:
      "VINTAGE ENGRAVING STYLE: Render the ridiculous contemporary pet behaviour with the visual seriousness of an antique engraved illustration, nineteenth-century editorial etching or old natural-history plate. Use refined engraved linework, cross-hatching, stippling and controlled areas of solid black to model the subject. Preserve recognisable pet characteristics from reference imagery. Treat the animal with absurd dignity and scholarly seriousness while ensuring its pose, expression and interaction communicate intentional agency. Use monochrome or a restrained 2–3 ink palette. Keep the engraving as isolated apparel artwork with a strong irregular silhouette. Do not depict parchment, an old book page, paper rectangle, museum card or frame. If wording is required, use restrained period-inspired serif lettering integrated with the illustration. Avoid crowns, thrones and generic aristocratic-pet tropes.",
  },
  {
    id: "conceptual-graphic",
    label: "Conceptual Graphic",
    rendererId: null,
    prompt:
      "CONCEPTUAL GRAPHIC STYLE: Create a clever, highly simplified visual-concept T-shirt graphic in which the joke is communicated through one unexpected visual relationship rather than conventional scene illustration. When appropriate, use silhouette, negative space, visual substitution, impossible scale, objects contained inside other forms, merged shapes, visual metaphor, deliberate contradiction or another simple graphic device derived specifically from the concept. Reduce the artwork to a small number of bold, immediately readable shapes using approximately 1–3 print colors. Prioritise an intelligent visual idea over decorative detail. The pet's behaviour or relationship with the human must create the visual punchline. Keep the composition sparse, iconic and self-contained with generous transparent garment space. Prefer zero text when the image carries the joke; otherwise use only the supplied wording. No generic pet portrait, decorative scenery, gradients, poster layout or unnecessary embellishment. Do not apply a graphic filter to the literal scene. Find a visual idea.",
  },
  {
    id: "bold-type",
    label: "Bold Type",
    rendererId: null,
    prompt:
      "BOLD TYPE STYLE: Create a typography-led graphic T-shirt design in which the exact supplied punchline is the dominant visual element and a concise illustrated pet vignette provides the secondary visual joke. Use large expressive hand-lettered, vintage display or characterful graphic typography with strong hierarchy, excellent legibility and deliberate line breaks. Integrate the pet illustration into, around, through or between the letterforms so text and image form one unified composition. The pet must be performing the specific behaviour described by the concept rather than simply posing beneath the words. Use approximately 2–4 strong print-friendly colors with clear garment contrast. Maintain a compact irregular outer silhouette. Do not create a generic slogan template, rectangular text box, plain caption-under-image layout or excessive decorative lettering. Reproduce supplied wording exactly once.",
  },
  {
    id: "ornamental",
    label: "Ornamental",
    rendererId: null,
    prompt:
      "ORNAMENTAL STYLE: Create an elegant decorative apparel illustration inspired by vintage storybook art, Arts and Crafts printmaking and restrained Art Nouveau ornament. Keep the recognisable pet and its behavioural joke as the central focal point. Surround or interweave the subject selectively with flowing organic curves, botanical forms, household objects or decorative motifs that relate meaningfully to the story. Use graceful contour drawing, flattened decorative shapes, controlled symmetry or asymmetry and a sophisticated limited palette of approximately 3–5 inks. Ornament must frame and reinforce the pet rather than overwhelm it. Maintain a strong irregular apparel silhouette with transparent negative space around the complete composition rather than reproducing a rectangular historical poster. Integrate wording elegantly into curves, ribbons or negative space only when required. Sophisticated, strange and witty rather than saccharine or fantasy-cute.",
  },
  {
    id: "painterly",
    label: "Painterly",
    rendererId: null,
    prompt:
      "PAINTERLY STYLE: Create an expressive hand-painted apparel illustration using watercolor and gouache character, visible brushwork, organic pigment variation, selectively defined edges and natural color transitions. Preserve recognisable pet markings and personality while simplifying unnecessary photographic detail. Concentrate richer pigment and visual definition around the focal pet and behavioural action, allowing outer painted marks to break up organically into transparent garment space. Use approximately 4–7 harmonious colors. Maintain a deliberate central graphic silhouette rather than creating a conventional rectangular painting. If wording is required, keep it minimal, highly legible and deliberately integrated. Do not depict watercolor paper, torn paper, canvas, easel, framed painting, poster, white page or product mockup. The painting itself is the print artwork.",
  },
  {
    id: "psychedelic",
    label: "Psychedelic",
    rendererId: null,
    prompt:
      "PSYCHEDELIC STYLE: Create a bold late-1960s to 1970s psychedelic graphic T-shirt illustration using playful warped forms, flowing contours, chunky hand-drawn shapes and expressive retro display lettering where wording is supplied. Use a saturated but controlled print palette of approximately 4–6 colors such as burnt orange, mustard, avocado, turquoise, coral, warm cream and deep brown. Allow the pet's expression, pose and behavioural situation to become slightly exaggerated or surreal while preserving recognisable reference characteristics. Typography may swell, curve, bend or interlock with the illustration to form one unified graphic. Use subtle vintage screen-print texture and natural ink imperfection. Maintain a strong self-contained silhouette with transparent negative garment space. Aim for strange, funny and stylish rather than visually chaotic. Avoid generic tie-dye backgrounds, random hippie symbols, modern gradients, glossy 3D effects or rectangular poster compositions.",
  },
];

export function petposterousArtStyle(id: unknown): PetposterousArtStyle | undefined {
  return PETPOSTEROUS_ART_STYLES.find((style) => style.id === id);
}

export function artStyleMarker(style: PetposterousArtStyle): string {
  const match = /^[A-Z0-9 &]+ STYLE:/.exec(style.prompt);
  return match?.[0] ?? style.prompt.slice(0, 24);
}

export function compositionLocksAboveStyle(prompt: string, styleMarker: string): string[] {
  const at = prompt.indexOf(styleMarker);
  const head = at >= 0 ? prompt.slice(0, at) : prompt;
  const lower = head.toLowerCase();
  return PETPOSTEROUS_COMPOSITION_LOCKS.filter((phrase) => lower.includes(phrase.toLowerCase()));
}

/** Fixed inputs for the apparel style QA batch. Humor and relationship are tone, pinned so they are not a hidden variable. */
export const PETPOSTEROUS_ART_STYLE_BATCH = {
  behaviour: "dog refuses to get into the back seat of the car",
  concept: "dog occupies the front passenger seat, driver's door open and waiting",
  frameworkId: "pp-hostile-negotiations" as const,
  words: "PASSENGER SELECTED.",
  humorId: "dry" as const,
  relationshipId: "rivals" as const,
  aspectRatio: "1:1" as const,
  rendererId: "openai-flare" as const,
  quality: "medium" as const,
  background: "transparent" as const,
  referenceLabel: "springer spaniel",
};

function fragment(options: { id: string; fragment: string }[] | undefined, id: string): string {
  return options?.find((option) => option.id === id)?.fragment ?? "";
}

/**
 * Same woodcut job, compressed. The long stack is the control's other arm.
 * Target ~800 characters: truth, exact words, and how to draw — not the full brand essay.
 */
export const WOODCUT_SHORT_PROMPT = [
  "APPAREL: Finished print only, not a shirt, mockup or photo of a print. Transparent surround, no rectangular boundary, clear silhouette, large readable forms. The action carries the joke, not a caption under a posed pet. Garment color is negative space. Text once, exactly: PASSENGER SELECTED.",
  "TRUTH: the dog refused the back seat and took the front passenger seat; the driver's door is open and waiting. Joke type: a battle of wills. Keep this springer spaniel recognisable. Reinterpret pose, framing and layout.",
  "WOODCUT: Bold hand-carved relief print. Solid ink and gouged negative-space marks for fur, form and expression. Striking silhouette, large shapes, one dominant ink plus an optional accent, garment showing through. Hand-cut type in the same language. No gradients, photorealism or tiny engraving.",
].join(" ");

export function composePetposterousArtStylePrompt(opts: {
  styleId: string;
  length?: "full" | "short";
}): { prompt: string; style: PetposterousArtStyle; length: "full" | "short" } {
  const style = petposterousArtStyle(opts.styleId);
  if (!style) throw new Error(`Unknown art style "${opts.styleId}"`);
  const length = opts.length ?? "full";
  if (length === "short") {
    if (style.id !== "woodcut") throw new Error("The short-prompt control is woodcut only");
    return { prompt: WOODCUT_SHORT_PROMPT, style, length };
  }
  const batch = PETPOSTEROUS_ART_STYLE_BATCH;
  const framework = PETPOSTEROUS_CONCEPT_FRAMEWORKS[batch.frameworkId];
  if (!framework) throw new Error("Pinned joke framework is missing");
  const profile = PETPOSTEROUS_PROMPT_PROFILE;
  const pack: PackPromptLayers = {
    suppressStyleLayers: true,
    styleOwnsComposition: true,
    creativeBase: profile.creativeBase,
    referenceIdentity: buildRoleReferenceInstruction({
      styleImageCount: 0,
      customerImages: [{ role: "pet", label: batch.referenceLabel }],
      identityRules: profile.referenceIdentity,
    }),
    humor: fragment(profile.humorOptions, batch.humorId),
    relationship: fragment(profile.relationshipOptions, batch.relationshipId),
    concept: `BEHAVIOUR: ${batch.behaviour}.\nCONCEPT: ${batch.concept}.\n${CONCEPT_AUTHORITY}`,
    conceptFramework: `JOKE FRAMEWORK — Hostile Negotiations: ${framework}`,
    printConstraint: `${FRAMEWORK_SCOPE}\n\n${PETPOSTEROUS_APPAREL_OUTPUT_RULE}`,
    visualSystem: style.prompt,
    punchline: batch.words,
    textRule: profile.exactTextRule,
    rendererExtra: null,
    garmentColour: null,
  };
  const prompt = composeLayeredPrompt({
    category: "apparel",
    isApparelGeneration: true,
    generationModel: "openai-flare",
    styleLayer: "",
    userInput: "",
    lockedBaseOverride: PETPOSTEROUS_ART_STYLE_PLATE,
    packLayers: pack,
  }).prompt;
  return { prompt, style, length };
}
