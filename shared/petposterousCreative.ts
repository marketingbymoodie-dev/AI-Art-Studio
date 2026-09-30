/** Petposterous-only creative taxonomy. Legacy pack style IDs remain intact. */
export type PetposterousProductFamily = "apparel" | "poster" | "pillow" | "tapestry" | "bedding";
export type LookCompatibility = "recommended" | "available" | "hidden";
export type PetposterousVisualSystem = {
  id: string;
  label: string;
  prompt: string;
  compatibility: Record<PetposterousProductFamily, LookCompatibility>;
};

export const PETPOSTEROUS_VISUAL_SYSTEMS: PetposterousVisualSystem[] = [
  { id: "editorial-deadpan", label: "Deadpan", prompt: "LOOK — DEADPAN: intelligent sparse editorial illustration; strong outer silhouette, intentional negative space, one meaningful visual device, 1–2 subjects and minimum props. Expression, posture and gaze carry the joke. Use 2–4 dominant ink, bone, oxblood or institutional-green colours and restrained editorial typography. Never generic minimalist line art, a cute pose, or pet-name merchandise.", compatibility: { apparel: "recommended", poster: "recommended", pillow: "available", tapestry: "hidden", bedding: "hidden" } },
  { id: "academic-institutional", label: "Field Notes", prompt: "LOOK — FIELD NOTES: archival natural-history illustration and restrained behavioural documentation. Study the ridiculous behaviour, not the species taxonomy. Bone, ink, faded burgundy or institutional green; sparse book-serif or grotesque labels only when words are permitted. No fake paragraphs, pseudo-science, dense charts, meaningless labels or scientific decoration. The visual evidence carries the joke.", compatibility: { apparel: "recommended", poster: "recommended", pillow: "available", tapestry: "available", bedding: "hidden" } },
  { id: "vintage-print", label: "Vintage Print", prompt: "LOOK — VINTAGE PRINT: bold analog commercial-print illustration, strong silhouette and 2–5 dominant warm cream, rust, charcoal, mustard, faded-blue or sage colours. Controlled halftone, subtle ink misregistration and selective worn ink. Restrained slab serif or grotesque. No bootleg photo collages, giant pet-name type, chrome, lightning, Y2K effects, random distress or fake vintage rectangle on apparel. The joke outranks nostalgia.", compatibility: { apparel: "recommended", poster: "recommended", pillow: "recommended", tapestry: "available", bedding: "available" } },
  { id: "illustrated-character", label: "Character", prompt: "LOOK — CHARACTER: expressive contemporary illustration, recognisable pet likeness, strong facial and body acting, slight exaggeration, confident contour, clean shapes and 3–6 curated colours. The pet is a character actor with specific intention. Typography is secondary. No generic mascot, infantilisation, excessive cuteness or stock pose unrelated to the story.", compatibility: { apparel: "recommended", poster: "recommended", pillow: "recommended", tapestry: "available", bedding: "available" } },
  { id: "fine-art", label: "Portrait", prompt: "LOOK — PORTRAIT: coherent painterly fine-art portraiture with prestigious light and subtle behavioural evidence. Paint every subject fully in the same medium; never paste a photographic face into painting or a pet head into royal human costume. Likeness outranks costume accuracy; preserve distinctive hair, face, coat, markings and identity accessories. Usually no typography; use only the requested words when present. No unwanted inscriptions, Latin-like text or crown clichés. Do not copy a specific painting.", compatibility: { apparel: "available", poster: "recommended", pillow: "recommended", tapestry: "recommended", bedding: "available" } },
  { id: "cinematic-domestic", label: "Domestic Cinema", prompt: "LOOK — DOMESTIC CINEMA: environmental storytelling with directional light, meaningful spatial relationships, strong blocking and eye lines. A serious frozen narrative moment of a trivial domestic dispute. Furniture, doors and bedding serve the joke. No generic cinematic portrait, unearned drama, tiny unreadable story detail or rectangular movie still pasted onto apparel. Typography is minimal or absent.", compatibility: { apparel: "available", poster: "recommended", pillow: "available", tapestry: "recommended", bedding: "recommended" } },
];

export const PETPOSTEROUS_CONCEPT_FRAMEWORKS: Record<string, string> = {
  "pp-minimal-deadpan": "One deliberate animal action, expression or gaze makes the behaviour obvious; use visual economy.",
  "pp-domestic-affairs": "An ordinary household disagreement treated as formal diplomacy or bureaucracy; the domestic problem stays recognisable without dense paperwork.",
  "pp-petty-crimes": "Harmless pet misconduct treated as a minor criminal matter; evidence makes the offence obvious and the suspect has attitude. No violence or grim incarceration.",
  "pp-behavioural-studies": "A ridiculous pet behaviour treated as a serious scientific or observational study; visual comparison or evidence, never fake academic paragraphs.",
  "pp-portrait-character": "Reveal who the animal believes it is through posture, gaze and one meaningful prop; no generic cute portrait.",
  "pp-hostile-negotiations": "A battle of wills through mutual eye contact, distance and an object of contention; both parties understand the dispute.",
  "pp-retro-ad": "Inconvenient pet truth presented as an absurdly optimistic fictional commercial proposition; no real brand or campaign.",
  "pp-forensic": "Reconstruct a harmless domestic incident through traces and spatial evidence; no gore, violence or dense labels.",
  "pp-domestic-epic": "Treat a trivial behaviour as monumental through exaggerated seriousness and scale; no unrequested fantasy creatures.",
  "pp-owner-vs-pet": "The relationship is central: mutual agency, years of history conveyed through gaze, posture, distance or a shared object; no sentimental cliché.",
  "pp-old-master": "Dignified prestige treatment undermined by one absurd behavioural clue; likeness matters and no existing painting is copied.",
  "pp-domestic-drama": "A mundane interaction treated as consequential drama through blocking and gaze; believable acting, not cartoon melodrama.",
  "pp-illustrated-character": "Pet personality drives expressive character acting and specific behaviour; no stock mascot pose.",
  "pp-pet-propaganda": "A pet's fictional demand or grievance treated as a cause; original short wording, no real politics or historical propaganda copying.",
  "pp-head-household": "The pet is the household authority through privileged positioning and hierarchy; no lazy crown cliché.",
  "pp-sleep-warfare": "Spatial injustice during rest is the joke: body position shows the pet taking most territory and the human adapting at the edge.",
};

export function petposterousProductFamily(product: { name?: string | null; designerType?: string | null } | null | undefined, isApparel = false): PetposterousProductFamily {
  const name = `${product?.name ?? ""} ${product?.designerType ?? ""}`.toLowerCase();
  if (/comforter|bedding|blanket|duvet/.test(name)) return "bedding";
  if (/pillow|cushion/.test(name)) return "pillow";
  if (/tapestry/.test(name)) return "tapestry";
  if (isApparel || /apparel|shirt|tee\b|hoodie|sweatshirt/.test(name)) return "apparel";
  return "poster";
}

export function petposterousLook(id: unknown): PetposterousVisualSystem | undefined {
  return PETPOSTEROUS_VISUAL_SYSTEMS.find((look) => look.id === id);
}

export function petposterousLooks(family: PetposterousProductFamily, framework?: string | null) {
  const preferred = framework === "pp-sleep-warfare" || framework === "pp-domestic-drama" ? "cinematic-domestic"
    : framework === "pp-old-master" || framework === "pp-portrait-character" ? "fine-art"
    : framework === "pp-behavioural-studies" || framework === "pp-forensic" ? "academic-institutional"
    : framework === "pp-petty-crimes" || framework === "pp-retro-ad" ? "vintage-print"
    : framework === "pp-head-household" || framework === "pp-illustrated-character" ? "illustrated-character" : "editorial-deadpan";
  const compatible = PETPOSTEROUS_VISUAL_SYSTEMS.filter((look) => look.compatibility[family] !== "hidden");
  compatible.sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
  const recommended = compatible.filter((look) => look.compatibility[family] === "recommended").slice(0, 4);
  return { recommended, more: compatible.filter((look) => !recommended.includes(look)) };
}

export const PETPOSTEROUS_PRODUCT_RENDERERS: Record<PetposterousProductFamily, string> = {
  apparel: "PRODUCT RENDERER — APPAREL: compact chest-print vignette, native transparent outer background, strong silhouette, intentional negative space, robust text and generally 2–5 ink-like colours. No rectangular scene boundary, poster margins, pink chroma, mockup or garment. Simplify environments and omit tiny peripheral detail. The garment colour participates in contrast.",
  poster: "PRODUCT RENDERER — WALL ART: deliberate aspect-ratio-aware rectangular artwork with richer environmental storytelling and coherent full-bleed scene. Recompose the idea for wall art; never merely centre a transparent apparel PNG on a white rectangle. Protect faces and requested text from trim.",
  pillow: "PRODUCT RENDERER — PILLOW: square-first surface composition; use the full square intentionally. Keep faces, joke elements and text well inside seam-safe areas and legible after stuffing. The pillow may be part of the joke. No tiny apparel graphic floating in the middle.",
  tapestry: "PRODUCT RENDERER — TAPESTRY: expanded environmental composition, large-scale visual relationships and macro-read from a distance. Protect faces and text from edges and avoid tiny typography. Recompose for scale rather than stretching apparel art.",
  bedding: "PRODUCT RENDERER — BEDDING: the physical bedding surface itself is the territory. Large-scale pet body placement and spatial injustice exploit the actual comforter/blanket, with important content protected from edges and folds. For bed-hog concepts, the dog occupies roughly 90% of the actual bedding surface; do not print a picture of a bed or room onto the comforter. No poster-on-bedding composition or small punchline text.",
};
