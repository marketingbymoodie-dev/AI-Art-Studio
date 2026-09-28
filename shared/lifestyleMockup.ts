/**
 * AI lifestyle mockups ("See it worn") for AOP zip and pullover hoodies.
 *
 * One Replicate google/nano-banana call per (design + gender): a single wide
 * image of the same person front + back, built from a fixed per-garment prompt
 * template and three reference images in a LOAD-BEARING order (the template
 * names "reference image 1/2/3"):
 *   1 = front design flat, 2 = back design flat, 3 = pocket close-up.
 */
import { isPulloverHoodieBlueprint, isZipHoodieBlueprint } from "./hoodieTemplate";

export type LifestyleGarment = "zip" | "pullover";
export type LifestyleGender = "male" | "female";

export const LIFESTYLE_GENDERS: readonly LifestyleGender[] = ["male", "female"];

/** Admin test caps. One generation per (design + gender), plus re-rolls. */
export const LIFESTYLE_MAX_REROLLS = 3;
export const LIFESTYLE_MAX_PER_DESIGN_GENDER = 1 + LIFESTYLE_MAX_REROLLS;
export const LIFESTYLE_DAILY_CAP = 200;

export const LIFESTYLE_SETTING_FALLBACK = "a plain city sidewalk";

export function lifestyleGarmentForBlueprint(
  blueprintId: number | null | undefined,
): LifestyleGarment | null {
  if (isZipHoodieBlueprint(blueprintId)) return "zip";
  if (isPulloverHoodieBlueprint(blueprintId)) return "pullover";
  return null;
}

// Finalised templates (2026-09-29), verbatim. Do not reword without re-testing:
// the "reference image N" numbering must match LIFESTYLE_REFERENCE_ORDER.
const ZIP_TEMPLATE = `A single wide image: two photographs of the same {GENDER} person in the same location, side by side. LEFT = front view, RIGHT = rear view. Treat each half as its own independent photograph — the print on each figure's hoodie comes ONLY from that half's reference and must never appear on the other figure.

LEFT hoodie: front print exactly as reference image 1. Printed: {FRONT_PRINTED_PANELS}. Plain (no artwork): {FRONT_PLAIN_PANELS}.
RIGHT hoodie: back print exactly as reference image 2. Printed: {BACK_PRINTED_PANELS}. Plain: {BACK_PLAIN_PANELS}.
Do not copy the front artwork onto the back figure or the back onto the front. Do not add artwork to any plain panel. The artwork appears ONLY on the hoodie. Maintain the garment colours based on the front and back reference images.

Garment: a full-zip hoodie, with the zip running the full length of the front. The hood has NO drawstrings of any kind — no cords, ties or aglets at the hood opening. Only the inner lining seen inside the hood opening is white — a fixed feature of the garment. The outer of the hood shows exactly the colour and/or print that appears on the hood in the front and back reference flats — match the flats exactly, whatever that colour is (printed, garment colour, or white). Hand-warmer pockets sit across the lower front exactly like the close-up in reference image 3 — same shape, seam and opening — with the print continuing over them and the seam and soft shadow still visible (front figure only).

Scene: an ordinary, everyday {SETTING} — clearly a different place from anything shown in the artwork.
Model: a relatable but stylish {GENDER} person, natural looks but a little more attractive than average — not a professional fashion model — in a casual posture, mid-walk or a natural action suited to the scene. Never looking directly at the camera; no eye contact.
Look: shot like a casual smartphone photo, golden-hour lighting, no retouching, slightly imperfect, authentic real-person feel.

References: 1 = front design flat, 2 = back design flat, 3 = zip pocket close-up.`;

const PULLOVER_TEMPLATE = `A single wide image: two photographs of the same {GENDER} person in the same location, side by side. LEFT = front view, RIGHT = rear view. Treat each half as its own independent photograph — the print on each figure's hoodie comes ONLY from that half's reference and must never appear on the other figure.

LEFT hoodie: front print exactly as reference image 1. Printed: {FRONT_PRINTED_PANELS}. Plain (no artwork): {FRONT_PLAIN_PANELS}.
RIGHT hoodie: back print exactly as reference image 2. Printed: {BACK_PRINTED_PANELS}. Plain: {BACK_PLAIN_PANELS}.
Do not copy the front artwork onto the back figure or the back onto the front. Do not add artwork to any plain panel. The artwork appears ONLY on the hoodie. Maintain the garment colours based on the front and back reference images.

Garment: a pullover hoodie with no zip. The hood has white knotted drawstrings, always. Only the inner lining seen inside the hood opening is white — a fixed feature of the garment. The outer of the hood shows exactly the colour and/or print that appears on the hood in the front and back reference flats — match the flats exactly, whatever that colour is (printed, garment colour, or white). A kangaroo pouch pocket sits across the lower front exactly like the close-up in reference image 3 — same shape, seam and opening — with the print continuing over it and the seam and soft shadow still visible (front figure only).

Scene: an ordinary, everyday {SETTING} — clearly a different place from anything shown in the artwork.
Model: a relatable but stylish {GENDER} person, natural looks but a little more attractive than average — not a professional fashion model — in a casual posture, mid-walk or a natural action suited to the scene. Never looking directly at the camera; no eye contact.
Look: shot like a casual smartphone photo, golden-hour lighting, no retouching, slightly imperfect, authentic real-person feel.

References: 1 = front design flat, 2 = back design flat, 3 = pullover pocket close-up.`;

export const LIFESTYLE_TEMPLATES: Record<LifestyleGarment, string> = {
  zip: ZIP_TEMPLATE,
  pullover: PULLOVER_TEMPLATE,
};

export type LifestyleSlots = {
  gender: LifestyleGender;
  setting: string;
  frontPrinted: string;
  frontPlain: string;
  backPrinted: string;
  backPlain: string;
};

/** Fill every slot; throws if any `{SLOT}` survives (a template/slot mismatch). */
export function fillLifestyleTemplate(garment: LifestyleGarment, slots: LifestyleSlots): string {
  const values: Record<string, string> = {
    GENDER: slots.gender,
    SETTING: slots.setting,
    FRONT_PRINTED_PANELS: slots.frontPrinted,
    FRONT_PLAIN_PANELS: slots.frontPlain,
    BACK_PRINTED_PANELS: slots.backPrinted,
    BACK_PLAIN_PANELS: slots.backPlain,
  };
  const out = LIFESTYLE_TEMPLATES[garment].replace(/\{([A-Z_]+)\}/g, (m, key: string) =>
    key in values ? values[key] : m,
  );
  const left = out.match(/\{[A-Z_]+\}/g);
  if (left) throw new Error(`Unfilled lifestyle template slots: ${left.join(", ")}`);
  return out;
}

/** Reference images in the exact order the templates number them. */
export const LIFESTYLE_REFERENCE_ORDER = ["frontFlat", "backFlat", "pocket"] as const;

export function lifestyleImageInput(refs: {
  frontFlat: string;
  backFlat: string;
  pocket: string;
}): string[] {
  return LIFESTYLE_REFERENCE_ORDER.map((k) => refs[k]);
}

/** Subset of the placer / capture-signature state that decides printed vs plain. */
export type LifestylePanelState = {
  mode?: unknown;
  enabled?: Record<string, unknown> | null;
  pocketsEnabled?: unknown;
};

/**
 * Measured per-part print state (from the job's print files); overrides the
 * toggle rules. "partial" = artwork reaches only a small part of the panel
 * (e.g. the bottom of a motif spilling onto the hood) — named as printed but
 * flagged "mostly plain" so the model doesn't cover the whole panel.
 */
export type LifestylePartState = boolean | "partial";
export type LifestylePanelFacts = Partial<Record<"front" | "pockets" | "hood" | "sleeves" | "back", LifestylePartState>>;

/** Coverage bands (fraction of a panel's pixels that are artwork). */
export const LIFESTYLE_PLAIN_BELOW = 0.01;
export const LIFESTYLE_PARTIAL_BELOW = 0.35;

export function lifestylePartStateFromCoverage(coverage: number): LifestylePartState {
  if (coverage < LIFESTYLE_PLAIN_BELOW) return false;
  if (coverage < LIFESTYLE_PARTIAL_BELOW) return "partial";
  return true;
}

export type LifestylePanelManifest = {
  frontPrinted: string[];
  frontPlain: string[];
  backPrinted: string[];
  backPlain: string[];
};

/**
 * Which visible panels carry artwork, per view. Mirrors the customer placer:
 * Place mode honours group toggles with the hoodie defaults (front body + hood
 * on; back, sleeves off — customerGroupEnabledByDefault); Pattern mode prints
 * every group; trim (cuffs, waistband) is always plain (buildPanelOverrides);
 * pockets follow `pocketsEnabled`. `facts` (printed/plain read from the
 * actual print files) win over those rules — a group can be toggled on yet
 * print plain when the artwork never reaches that panel (e.g. the hood).
 */
export function lifestylePanelManifest(
  garment: LifestyleGarment,
  state: LifestylePanelState,
  facts: LifestylePanelFacts = {},
): LifestylePanelManifest {
  const pattern = state.mode === "pattern";
  const enabled = (state.enabled ?? {}) as Record<string, unknown>;
  const on = (groupId: string, fallback: boolean): boolean => {
    if (pattern) return true;
    const v = enabled[groupId];
    return typeof v === "boolean" ? v : fallback;
  };
  const front: LifestylePartState = facts.front ?? on("front-body", true);
  const hood: LifestylePartState = facts.hood ?? on("hood", true);
  const back: LifestylePartState = facts.back ?? on("back-body", false);
  const sleeves: LifestylePartState = facts.sleeves ?? (on("left-sleeve", false) || on("right-sleeve", false));
  const pockets: LifestylePartState = facts.pockets ?? state.pocketsEnabled === true;

  const frontBody = garment === "zip" ? "the left and right front panels" : "the front body";
  const pocketName = garment === "zip" ? "the hand-warmer pockets" : "the kangaroo pocket";

  const frontPrinted: string[] = [];
  const frontPlain: string[] = [];
  const backPrinted: string[] = [];
  const backPlain: string[] = [];
  const put = (printed: LifestylePartState, name: string, p: string[], q: string[]) => {
    if (printed === "partial") p.push(`${name} (only partly — mostly plain)`);
    else (printed ? p : q).push(name);
  };

  put(front, frontBody, frontPrinted, frontPlain);
  put(pockets, pocketName, frontPrinted, frontPlain);
  put(hood, "the hood", frontPrinted, frontPlain);
  put(sleeves, "both sleeves", frontPrinted, frontPlain);
  frontPlain.push("the cuffs", "the waistband");

  put(back, "the back body", backPrinted, backPlain);
  put(hood, "the hood", backPrinted, backPlain);
  put(sleeves, "both sleeves", backPrinted, backPlain);
  backPlain.push("the cuffs", "the waistband");

  return { frontPrinted, frontPlain, backPrinted, backPlain };
}

/** "a, b and c" / "none". */
/** Print-file positions that make up each manifest part, per garment. */
export const LIFESTYLE_PART_POSITIONS: Record<LifestyleGarment, Record<keyof LifestylePanelFacts, string[]>> = {
  zip: {
    front: ["front_left", "front_right"],
    pockets: ["pocket_left", "pocket_right"],
    hood: ["left_hood", "right_hood"],
    sleeves: ["left_sleeve", "right_sleeve"],
    back: ["back"],
  },
  pullover: {
    front: ["front"],
    pockets: ["pocket"],
    hood: ["left_hood", "right_hood"],
    sleeves: ["left_sleeve", "right_sleeve"],
    back: ["back"],
  },
};

export function joinPanelList(names: string[]): string {
  if (names.length === 0) return "none";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Clean a model-suggested setting to a short phrase, or null if unusable. */
export function sanitiseLifestyleSetting(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const line = raw.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  const cleaned = line
    .replace(/^["'`*\s-]+|["'`*\s.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 10) return null;
  if (/[{}<>]/.test(cleaned)) return null;
  return cleaned.toLowerCase();
}
