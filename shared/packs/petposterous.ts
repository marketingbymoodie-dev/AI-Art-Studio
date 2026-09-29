/**
 * Petposterous V1 — style pack content (pack slug `petposterous-v1`, prompt
 * profile `petposterous`, experience profile `petposterous`).
 *
 * Composable by design: each style below is only a creative *scenario*. The
 * creative base, reference identity, humour, relationship, text rule,
 * renderer and garment-colour layers come from PETPOSTEROUS_PROMPT_PROFILE and
 * are composed around it (shared/promptLayers.ts packLayers).
 *
 * Types are imported type-only: shared/packStyleCatalog.ts and
 * shared/stylePackProfiles.ts import this file.
 */
import type { PackStyleDefinition } from "../packStyleCatalog";
import type { StylePackPromptProfile } from "../stylePackProfiles";

export const PETPOSTEROUS_PACK_SLUG = "petposterous-v1";
export const PETPOSTEROUS_PROFILE_KEY = "petposterous";

const CAPS_PET_AND_OWNER = {
  petPhoto: "optional",
  ownerPhoto: "optional",
  humor: { supported: true, default: "witty" },
  relationship: { supported: true, default: "its-complicated" },
};
/** Genuinely pet-only compositions. */
const CAPS_PET_ONLY = { ...CAPS_PET_AND_OWNER, ownerPhoto: "unsupported" };

function style(
  id: string,
  name: string,
  promptPrefix: string,
  opts: {
    petOnly?: boolean;
    launchActive: boolean;
    placeholder?: string;
    options?: PackStyleDefinition["options"];
  },
): PackStyleDefinition {
  return {
    id,
    name,
    category: "all",
    promptPrefix,
    promptPlaceholder: opts.placeholder ?? "e.g. Malcolm pees in the laundry basket when dinner is late",
    descriptionOptional: false,
    options: opts.options,
    inputCapabilities: opts.petOnly ? CAPS_PET_ONLY : CAPS_PET_AND_OWNER,
    generationModel: "gpt-image-2",
    generationModelDecor: "nano-banana",
    generationQuality: "medium",
    launchActive: opts.launchActive,
  };
}

export const PETPOSTEROUS_STYLES: PackStyleDefinition[] = [
  style(
    "pp-minimal-deadpan",
    "Minimal Deadpan",
    "STYLE — MINIMAL DEADPAN: one exceptionally simple visual joke. One primary pet character and the absolute minimum props needed to communicate the behaviour. The pet's expression, posture or deliberate action carries most of the humour. Generous negative space, restrained colours, clean shapes, sophisticated editorial simplicity. Effortless and deadpan, never loud. If text is needed, 1–3 words.",
    { petOnly: true, launchActive: true },
  ),
  style(
    "pp-domestic-affairs",
    "Domestic Affairs",
    "STYLE — DOMESTIC AFFAIRS: an ordinary disagreement between human and pet treated with the seriousness of government administration, diplomacy or institutional bureaucracy. Use formal positioning, official-looking structure, negotiation tables, documents, seals, barriers or procedural behaviour — without large amounts of fake written text. The joke is that a ridiculous household issue has become an official matter; the pet's real behaviour stays recognisable underneath.",
    { launchActive: true },
  ),
  style(
    "pp-petty-crimes",
    "Petty Crimes",
    "STYLE — PETTY CRIMES: the pet is the unapologetic suspect in a minor domestic offence, told through evidence photography, mugshots, criminal investigation or courtroom imagery. Show the offence through obvious visual evidence — stolen objects, destroyed furniture, forbidden food, suspicious mess, excavation, shredded paper or the customer's described behaviour. The pet looks innocent, defiant, smug, composed or entirely without remorse, true to its personality. No long charge sheets or fake text.",
    {
      launchActive: true,
      options: {
        label: "Case Type",
        required: false,
        choices: [
          { id: "mugshot", name: "Mugshot", promptFragment: "Case type: police mugshot — the pet facing camera against a height chart, holding a placard only if it adds to the joke." },
          { id: "caught", name: "Caught", promptFragment: "Case type: caught in the act — the pet frozen mid-offence, the evidence unmistakable." },
          { id: "evidence", name: "Evidence", promptFragment: "Case type: evidence photo — the aftermath laid out and marked, the pet posed nearby as the obvious suspect." },
          { id: "courtroom", name: "Courtroom", promptFragment: "Case type: courtroom — the pet on trial, composed and unrepentant, the evidence presented." },
          { id: "repeat-offender", name: "Repeat Offender", promptFragment: "Case type: repeat offender — clear signs this has happened many times before, the pet utterly unbothered." },
        ],
      },
    },
  ),
  style(
    "pp-behavioural-studies",
    "Behavioural Studies",
    "STYLE — BEHAVIOURAL STUDIES: ordinary pet behaviour treated as the subject of unnecessarily serious scientific or academic investigation. Elegant scientific illustration, observational diagrams, specimen-like composition, research aesthetics or scholarly visual organisation. The comedy is rigorous analysis applied to something every owner recognises. Avoid dense fake scientific text — show the theory visually.",
    { launchActive: true },
  ),
  style(
    "pp-portrait-character",
    "Portrait of Character",
    "STYLE — PORTRAIT OF CHARACTER: a highly characterful portrait that captures who this pet believes it is, not just its appearance. Expression, pose, clothing when appropriate, props and composition all communicate its self-image — dignified, editorial, historical or theatrical — while keeping its recognisable features. The joke comes from the contrast between the grand portrait and the pet's actual behaviour.",
    {
      petOnly: true,
      launchActive: true,
      options: {
        label: "Character",
        required: false,
        choices: [
          { id: "executive", name: "Executive", promptFragment: "Character: the executive — power pose, corner office confidence, clearly in charge." },
          { id: "aristocrat", name: "Aristocrat", promptFragment: "Character: the aristocrat — refined, entitled, faintly disappointed in everyone." },
          { id: "intellectual", name: "Intellectual", promptFragment: "Character: the intellectual — thoughtful, bookish, quietly superior." },
          { id: "menace", name: "Menace", promptFragment: "Character: the menace — cheerful chaos barely contained." },
          { id: "mastermind", name: "Mastermind", promptFragment: "Character: the mastermind — calm, calculating, three steps ahead." },
          { id: "victim", name: "Victim", promptFragment: "Character: the victim — theatrical suffering, deeply wronged by minor inconveniences." },
        ],
      },
    },
  ),
  style(
    "pp-hostile-negotiations",
    "Hostile Negotiations",
    "STYLE — HOSTILE NEGOTIATIONS: human and pet locked in a recognisable battle of wills. Eye contact, posture, spatial positioning and a contested object — treats, doors, furniture, food, leads, beds — make the negotiation obvious. Neither side is powerless; the pet understands the situation and has leverage. The petty disagreement gets absurd diplomatic seriousness.",
    { launchActive: false },
  ),
  style(
    "pp-retro-ad",
    "Retro Advertisement",
    "STYLE — RETRO ADVERTISEMENT: a polished vintage commercial illustration inspired by mid-century advertising and classic printed consumer artwork. Confident composition, expressive character acting, limited retro palettes and tasteful period print texture, subverting the optimistic advertising look with a truthful, funny observation about living with this pet. Never reproduce real historical brands, trademarks or advertisements.",
    { launchActive: false },
  ),
  style(
    "pp-forensic",
    "Forensic Evidence",
    "STYLE — FORENSIC EVIDENCE: an ordinary pet incident presented as though it needs forensic investigation. Visual evidence, object placement, suspicious circumstances, directional composition and the pet's body language tell the story so the viewer can reconstruct what happened without explanation. The pet may be obviously guilty while behaving as though the evidence is entirely circumstantial.",
    { launchActive: false },
  ),
  style(
    "pp-domestic-epic",
    "Domestic Epic",
    "STYLE — DOMESTIC EPIC: a completely ordinary pet behaviour transformed into an absurdly grand dramatic event — heroic composition, dramatic pose, heightened scale, cinematic movement, monumental storytelling. The behaviour itself stays recognisable and mundane: demanding dinner, stealing a seat, refusing rain, waking the owner, guarding a toy. The contrast between trivial event and epic treatment is the joke.",
    { launchActive: false },
  ),
  style(
    "pp-owner-vs-pet",
    "Owner vs Pet",
    "STYLE — OWNER VS PET: the relationship between the person and the pet is the subject. Expressions, eye contact, body language, physical distance and possession of objects show that these two know each other extremely well. A moment from an ongoing relationship, never a generic person posing with an animal — affection underneath rivalry, irritation, negotiation or mutual manipulation.",
    { launchActive: true },
  ),
  style(
    "pp-old-master",
    "Old Master",
    "STYLE — OLD MASTER: the pet, or pet and owner together, as a grand historical fine-art portrait inspired by classical European oil portraiture and museum painting. Rich painterly lighting, sophisticated composition, period-appropriate visual language and dignified posing, with recognisable likeness. Subtle behavioural clues or ridiculous props reveal the true personality beneath the prestigious presentation. Never imitate one specific modern artwork.",
    { launchActive: true },
  ),
  style(
    "pp-domestic-drama",
    "Domestic Drama",
    "STYLE — DOMESTIC DRAMA: a mundane human–pet interaction rendered with cinematic dramatic intensity — expressive lighting, framing, environmental storytelling and emotionally heightened staging, as though a tiny domestic incident were the decisive scene of a prestige drama. Expressions stay believable rather than cartoonishly exaggerated.",
    { launchActive: true },
  ),
  style(
    "pp-illustrated-character",
    "Illustrated Character",
    "STYLE — ILLUSTRATED CHARACTER: a polished contemporary illustrated character interpretation of the pet. Emphasise distinctive appearance, expression, personality and recognisable behaviour with expressive but sophisticated illustration, clean shapes, controlled colour and strong character acting. Cute is fine when it fits, but personality and humour dominate over generic cuteness.",
    { petOnly: true, launchActive: false },
  ),
  style(
    "pp-pet-propaganda",
    "Pet Propaganda",
    "STYLE — PET PROPAGANDA: the pet's demand, belief, grievance or agenda as an exaggerated vintage propaganda-style graphic — bold composition, simplified heroic forms, commanding hierarchy and limited high-impact colours. The pet is completely convinced of the righteousness of its cause, and the cause is amusingly mundane: more food, open doors, ownership of furniture, opposition to baths, unrestricted treats. Never reproduce real political campaign branding, extremist imagery or real propaganda slogans.",
    { launchActive: false },
  ),
  style(
    "pp-head-household",
    "Head of Household",
    "STYLE — HEAD OF HOUSEHOLD: the pet as the true authority figure of the household — confident portraiture, commanding posture, privileged positioning and subtle environmental cues establishing hierarchy. If a human appears, they affectionately occupy the supporting role. The humour is instantly recognising who actually runs the house.",
    { launchActive: true },
  ),
  style(
    "pp-sleep-warfare",
    "Sleep Warfare",
    "STYLE — SLEEP WARFARE: the territorial conflict between humans and pets during sleep or rest. Exaggerated but recognisable spatial imbalance — the pet occupying excessive bed, couch, pillow or blanket territory while the human adapts around it. Body position and space allocation deliver the joke. On bedding products, use the product's physical shape and function as part of the joke whenever possible.",
    {
      launchActive: true,
      options: {
        label: "Territory",
        required: false,
        choices: [
          { id: "bed-hog", name: "Bed Hog", promptFragment: "Territory: bed hog — the pet sprawled diagonally across the bed, the human clinging to the edge." },
          { id: "pillow-thief", name: "Pillow Thief", promptFragment: "Territory: pillow thief — the pet enthroned on the human's pillow, the human making do without." },
          { id: "blanket-thief", name: "Blanket Thief", promptFragment: "Territory: blanket thief — the pet wrapped in all the covers, the human cold and uncovered." },
          { id: "early-riser", name: "Early Riser", promptFragment: "Territory: early riser — the pet looming over the sleeping human at dawn, demanding the day begin." },
        ],
      },
    },
  ),
];

const HUMOR = [
  { id: "warm", label: "Warm", fragment: "HUMOUR: warm — affectionate observational humour; sweet without becoming sentimental or childish." },
  { id: "dry", label: "Dry", fragment: "HUMOUR: dry — understated deadpan; treat the absurd situation with complete seriousness." },
  { id: "witty", label: "Witty", fragment: "HUMOUR: witty — clever observational humour with an intelligent, concise punchline or visual twist." },
  { id: "sarcastic", label: "Sarcastic", fragment: "HUMOUR: sarcastic — sharper, knowing humour; human and pet both understand the conflict and neither is entirely innocent." },
  { id: "unhinged", label: "Unhinged", fragment: "HUMOUR: unhinged — escalate an ordinary pet behaviour into a disproportionately dramatic situation while the underlying behaviour stays recognisable." },
  { id: "risque", label: "A Little Inappropriate", fragment: "HUMOUR: a little inappropriate — cheeky adult observational humour about real pet behaviour (bodily functions, embarrassing habits, stolen underwear, inappropriate licking and similar), clever rather than graphic, vulgar or shocking." },
];

const RELATIONSHIP = [
  { id: "best-friends", label: "Best Friends", fragment: "RELATIONSHIP: best friends — loyal, easy companionship; clearly on the same team." },
  { id: "parent-child", label: "Parent & Child", fragment: "RELATIONSHIP: parent and child — the human fusses and provides; the pet behaves like a knowing, slightly spoiled child." },
  { id: "roommates", label: "Roommates", fragment: "RELATIONSHIP: roommates — two housemates sharing space, chores and grievances with polite tension." },
  { id: "rivals", label: "Rivals", fragment: "RELATIONSHIP: rivals — a long-running competition for the same space, food or attention." },
  { id: "codependent", label: "Co-dependent", fragment: "RELATIONSHIP: co-dependent — neither can function without the other, to a slightly ridiculous degree." },
  { id: "management-staff", label: "Management & Staff", fragment: "RELATIONSHIP: management and staff — the pet is the boss; the human is the employee who serves." },
  { id: "co-conspirators", label: "Co-conspirators", fragment: "RELATIONSHIP: co-conspirators — human and pet are in on the same mischief together." },
  { id: "its-complicated", label: "It's Complicated", fragment: "RELATIONSHIP: it's complicated — deep affection underneath rivalry, irritation and mutual manipulation." },
];

export const PETPOSTEROUS_PROMPT_PROFILE: StylePackPromptProfile = {
  key: PETPOSTEROUS_PROFILE_KEY,
  creativeBase:
    "PETPOSTEROUS CREATIVE DIRECTION: artwork about the unusually human relationship between people and their pets. The pet is a character, not an accessory — give it recognisable intention, personality, attitude and agency. The humour comes from familiar pet behaviour, mutual understanding, rivalry, affection, manipulation, habits, negotiations, rule-breaking or the private language between a person and an animal. Find the funny truth and communicate it visually; favour a clever visual punchline over explaining the joke in words. Show relationships through body language, positioning and who holds what, never a label. Avoid generic pet-store sentiment, generic cute-animal humour, paw-print clichés, hearts, 'dog mom'/'cat dad', meme layouts and clip-art. The result should feel observant, intelligent, distinctive and emotionally recognisable to anyone who lives with an animal.",
  textRule:
    "TEXT RULE: visual storytelling comes first. Prefer no words when the visual joke works without them; ideally 1–4 words; never more than 6. No paragraphs, long captions, fake fine print, dense labels, complicated signs or secondary copy. When exact text is supplied, reproduce only that text, spelled exactly. Typography stays highly legible and subordinate to the artwork unless typography is the concept.",
  referenceIdentity:
    "REFERENCE IDENTITY: preserve the pet's recognisable identity — species, breed characteristics, coat colour and pattern, markings, facial structure, ear shape, eyes, body proportions and distinctive features. Keep a pictured person recognisable while adapting them naturally into the style. Do not beautify, change breed, invent markings, change coat colour or replace the subjects with generic lookalikes. Stylise the subjects; do not erase their identity.",
  rendererExtra: {
    apparel:
      "APPAREL ARTWORK: a strong, readable silhouette in a compact garment-friendly composition, using only the props needed for the visual joke. It must read clearly from normal viewing distance on a t-shirt, hoodie or sweatshirt. No mockup, no garment — artwork only.",
    decor:
      "DECOR ARTWORK: a deliberately composed decorative artwork, not an enlarged t-shirt graphic. Use the space for environmental storytelling, lighting, body language, props and visual irony, keeping the pet and the story readable from a distance. Square decor and pillows: a strong central or balanced composition. Wall art and tapestries: richer environmental storytelling. Blankets and comforters: let the artwork play with the object itself.",
  },
  garmentColour: {
    light:
      "GARMENT COLOUR: printed on a light garment — rich, saturated colours and dark linework; avoid white and very pale tones that disappear on the fabric.",
    dark:
      "GARMENT COLOUR: printed on a dark garment — bright, light and white inks with strong contrast; avoid black and very dark tones that disappear on the fabric.",
  },
  humorOptions: HUMOR,
  relationshipOptions: RELATIONSHIP,
  concept: {
    punchlineMaxWords: 6,
    system: `You are the Petposterous punchline engine. From a customer's pet, its personality, a behaviour and the human–pet relationship, you invent artwork concepts about the unusually human relationship between people and their pets.

The pet is a character with intention, personality and agency. Find the FUNNY TRUTH — the recognisable truth about this relationship that makes it funny — and the single VISUAL JOKE that communicates it most efficiently. Favour a clever visual punchline over explaining the joke. Avoid generic pet-store sentiment, cute-animal clichés, paw prints, hearts, "dog mom"/"cat dad" and meme formats.

Match the requested HUMOUR and RELATIONSHIP. "A little inappropriate" means cheeky adult observational humour about real pet behaviour — clever, never graphic, vulgar or shocking.

PUNCHLINE: 0–4 words preferred, 6 absolute maximum; use "" when the image is stronger without text. Invent new lines from the customer's story; these are only examples of the register, never reuse them verbatim: HE HEARD YOU. / MESSAGE RECEIVED. / NO REMORSE. / YOUR MOVE. / NO COMMENT. / VACANCY FILLED. / STARVING. APPARENTLY. / SHARED EQUALLY. / COME BACK. / ACQUIRED LEGALLY. / WE HAD A DEAL. / I LIVE HERE. / YOU FIRST. / PROVE IT. / ALLEGEDLY. / TERMS REJECTED. / TALKS HAVE FAILED. / AGAIN. / NO WITNESSES. / AS EXPECTED.

The three options must be genuinely different jokes, each suited to the selected STYLE. visual_joke is a concrete scene description (who, doing what, where, with which telling detail). subject_priority says what must stay recognisable from the customer's photos (e.g. "orange tabby with white chin and one torn ear").`,
  },
};

const PERSONALITY = [
  "Affectionate", "Bossy", "Greedy", "Judgmental", "Dramatic", "Sneaky", "Stubborn",
  "Clever", "Chaotic", "Jealous", "Manipulative", "Lazy", "Weird", "Other",
];
const SPECIES = ["Dog", "Cat", "Bird", "Small Pet", "Reptile", "Other"];
const toChoice = (label: string) => ({ id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"), label });

/** Seed for the `petposterous` experience profile (experience_profiles.config). */
export const PETPOSTEROUS_EXPERIENCE_CONFIG = {
  brand: { name: "Petposterous", shortName: "Petposterous" },
  copy: {
    savedDesignsLabel: "My Creations",
    savedDesignsIntro: "Your Petposterous creations live here. Revisit, regenerate or use them on another product.",
    accountHeading: "Save your creations",
    accountBody: "Create an account to keep your Petposterous designs and return to them later.",
    uploadLabel: "Add Pet Photo",
    uploadCaption: "Optional — helps us get their likeness right",
    petUploadLabel: "Add Pet Photo",
    ownerUploadLabel: "Add Me Too",
    promptLabel: "Tell us what they do…",
    conceptButtonLabel: "Give Me 3 Ideas",
    generateButtonLabel: "Create Artwork",
    emailCaptureMenuLabel: "Join the Petposterous list",
    emailCaptureHeading: "Join the Petposterous list",
    emailCaptureBody: "New designs, new styles and mildly questionable pet behaviour, straight to your inbox.",
    emailCaptureButton: "Join",
  },
  controls: {
    humor: { label: "Humour" },
    relationship: { label: "You two are…" },
    personality: { label: "THEY'RE A BIT…", max: 3, options: PERSONALITY.map(toChoice) },
    species: { label: "Pet", options: SPECIES.map(toChoice) },
    petName: { label: "Pet's name", placeholder: "e.g. Malcolm" },
    words: { label: "Words on the design" },
  },
};
