/**
 * Art-style text writers. Separate from generatePackConceptOptions.
 * That function still writes a concrete visual joke for the six-look path.
 * These two write a funny truth, then a per-style device. Neither renders an image.
 */
import { countPunchlineWords } from "@shared/stylePackProfiles";
import { PETPOSTEROUS_CONCEPT_FRAMEWORKS } from "@shared/petposterousCreative";
import {
  ART_STYLE_DEVICE_STRUCTURES,
  darknessLevel,
  deviceStructureId,
  flywheelSpecies,
  humourOperatorId,
  type ArtStyleDeviceStructure,
} from "@shared/flywheelRecipe";
import { artStyleProfile, type ArtStyleProfile } from "@shared/petposterousArtStyleProfiles";
import {
  artStyleConceptShotFlags,
  petposterousArtStyle,
  settleArtStyleTruth,
  type ArtStyleSurface,
  type SettledArtStyleTruth,
} from "@shared/petposterousArtStyles";
import { runConceptEngine, type ConceptEngine } from "./concept-engine";

/** Product briefs for the truth writer only. The ten styles still render as apparel graphics. */
export const ART_STYLE_PRODUCT_BRIEFS: Record<string, string> = {
  apparel: "Apparel: a shirt graphic. Write a truth, not a picture. It must still be drawable as one wearable graphic, readable at arm's length.",
  poster: "Poster: a wall artwork. Write a truth, not a picture. It can hold a slightly larger idea than a shirt, still readable from across a room.",
  pillow: "Pillow: a square cushion graphic. Write a truth, not a picture. One joke, compact enough to read across the cushion.",
};

const PUNCHLINE_MAX_WORDS = 6;

export type ArtStyleTruthDraft = {
  funnyTruth: string;
  punchline: string;
  humourOperator: string;
  darknessLevel: number;
  species: "dog" | "cat" | "other";
};

export type ArtStyleDeviceDraft = {
  deviceStructure: ArtStyleDeviceStructure;
  deviceText: string;
};

function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export function artStyleTruthFields(behaviour: string, productFamily: string, styleId: string): Array<[string, string]> {
  const sentence = behaviour.replace(/\s+/g, " ").trim().slice(0, 400);
  const brief = ART_STYLE_PRODUCT_BRIEFS[productFamily];
  if (!sentence) throw Object.assign(new Error("Describe what they do."), { status: 400 });
  if (!brief) throw Object.assign(new Error("Choose apparel, poster, or pillow."), { status: 400 });
  const fields: Array<[string, string]> = [
    ["behaviour", sentence],
    ["product", brief],
  ];
  if (!styleId) {
    fields.push(["styles", "This truth will be drawn in all ten styles. Do not specialise it to typography or to a text-free symbol."]);
    return fields;
  }
  const style = petposterousArtStyle(styleId);
  const profile = artStyleProfile(styleId);
  if (!style || !profile) throw Object.assign(new Error("Choose an art style."), { status: 400 });
  fields.push(["style", style.label]);
  fields.push(["truth shape", profile.truthShape]);
  fields.push(["text appetite", profile.textAppetite]);
  return fields;
}

function truthEngine(): ConceptEngine<ArtStyleTruthDraft> {
  return {
    id: "art-style-truth",
    logTag: "[art-style-truth]",
    noun: "Truth writer",
    maxTokens: 1100,
    system: `You write three funny truths about a pet.
A truth is what is funny. It is not a picture.
It may name the behaviour, the attitude, and the relationship.
It must not name a position, a camera, a setting, who else is present, or the state of a prop.
Good: "the dog has decided the bed is not for sharing". "he sneezes when he wants something". "she considers the sofa hers".
Bad: "dog in the front seat, door open, owner waiting". "cat sitting on the keyboard while the owner types".
The three options are different angles on the same behaviour, not three drawings.
You do not see a photo. species is dog, cat, or other, taken from the behaviour. If the behaviour does not say, use other.
humour_operator is exactly one of: ${Object.keys(PETPOSTEROUS_CONCEPT_FRAMEWORKS).join(", ")}.
darkness_level is an integer from 1 (light) to 5 (bleak).
Return ONLY JSON: {"options":[{"funny_truth": string, "punchline": string, "humour_operator": string, "darkness_level": number, "species": string}, {"funny_truth": string, "punchline": string, "humour_operator": string, "darkness_level": number, "species": string}, {"funny_truth": string, "punchline": string, "humour_operator": string, "darkness_level": number, "species": string}]}
punchline is the words on the design, at most ${PUNCHLINE_MAX_WORDS} words, or "" when the image is stronger without text.`,
    parse: (raw) => parseArtStyleTruths(raw),
  };
}

export function parseArtStyleTruths(raw: unknown): ArtStyleTruthDraft[] | null {
  if (!raw || typeof raw !== "object") return null;
  const list = (raw as { options?: unknown }).options;
  if (!Array.isArray(list) || list.length !== 3) return null;
  const out: ArtStyleTruthDraft[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") return null;
    const o = item as Record<string, unknown>;
    const funnyTruth = clip(o.funny_truth, 400);
    const punchline = clip(o.punchline, 120).replace(/^["“”]+|["“”]+$/g, "").trim();
    const humourOperator = humourOperatorId(o.humour_operator);
    const darkness = darknessLevel(o.darkness_level);
    const species = flywheelSpecies(o.species);
    if (!funnyTruth || !humourOperator || darkness == null || !species) return null;
    if (countPunchlineWords(punchline) > PUNCHLINE_MAX_WORDS) return null;
    out.push({ funnyTruth, punchline, humourOperator, darknessLevel: darkness, species });
  }
  return out;
}

function rewriteEngine(): ConceptEngine<string> {
  return {
    id: "art-style-truth-rewrite",
    logTag: "[art-style-truth-rewrite]",
    noun: "Truth rewrite",
    maxTokens: 300,
    system: `You rewrite one funny truth that was flagged as a camera shot.
Keep the joke. Remove the staging. Do not name where a body is, a second person, a camera, or the state of a door.
"the bed is not for sharing" is allowed. "dog in the front seat, door open" is not.
Return ONLY JSON: {"funny_truth": string}`,
    parse: (raw) => {
      if (!raw || typeof raw !== "object") return null;
      const funnyTruth = clip((raw as { funny_truth?: unknown }).funny_truth, 400);
      return funnyTruth ? [funnyTruth] : null;
    },
  };
}

const SURFACE_DEVICE: Record<ArtStyleSurface, string> = {
  apparel: "Apparel: one subject, a strong silhouette. Props only as abstracted forms. No environment or interior.",
  decor: "Decor: a composed picture. One spare setting is permitted, held as graphic shapes rather than scenery. Margins are part of the design. The pet stays the dominant character.",
};

export function parseArtStyleDevice(raw: unknown): ArtStyleDeviceDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as { device_structure?: unknown; device_text?: unknown };
  const deviceStructure = deviceStructureId(row.device_structure);
  const deviceText = clip(row.device_text, 400);
  if (!deviceStructure || !deviceText) return null;
  return { deviceStructure, deviceText };
}

function deviceEngine(profile: ArtStyleProfile, surface: ArtStyleSurface): ConceptEngine<ArtStyleDeviceDraft> {
  const style = petposterousArtStyle(profile.styleId);
  return {
    id: `art-style-device:${profile.styleId}:${surface}`,
    logTag: `[art-style-device:${profile.styleId}:${surface}]`,
    noun: "Device writer",
    maxTokens: 400,
    system: `You choose one device structure, then write one visual device for a pet graphic.
device_structure is exactly one of: ${ART_STYLE_DEVICE_STRUCTURES.join(", ")}.
device_text is how a funny truth becomes a picture in one art style on one surface. One sentence.
A second person may appear only as a hand, a foot, or a sliver of silhouette.
Surface: ${surface}. ${SURFACE_DEVICE[surface]}
Style: ${style?.label ?? profile.styleId}.
Truth shape it suits: ${profile.truthShape}
Text appetite: ${profile.textAppetite}.
Complexity ceiling: ${profile.complexityCeiling}
Props it may call for: ${profile.props}
Return ONLY JSON: {"device_structure": string, "device_text": string}`,
    parse: (raw) => {
      const device = parseArtStyleDevice(raw);
      return device ? [device] : null;
    },
  };
}

function userLines(fields: Array<[string, string]>): string {
  return fields.map(([label, value]) => `${label.toUpperCase()}: ${value}`).join("\n");
}

export async function generateArtStyleTruths(behaviour: string, productFamily: string, styleId: string): Promise<SettledArtStyleTruth[]> {
  const fields = artStyleTruthFields(behaviour, productFamily, styleId);
  const drafts = await runConceptEngine(truthEngine(), `${userLines(fields)}\nWrite three options.`);
  const settled: SettledArtStyleTruth[] = [];
  for (const draft of drafts) {
    const flags = artStyleConceptShotFlags(draft.funnyTruth);
    let rewrite: string | null = null;
    if (flags.length) {
      try {
        const rewritten = await runConceptEngine(
          rewriteEngine(),
          `TRUTH: ${draft.funnyTruth}\nFLAGS: ${flags.join(", ")}\nRewrite it.`,
        );
        rewrite = rewritten[0] || null;
      } catch {
        rewrite = null;
      }
    }
    settled.push(settleArtStyleTruth(draft.funnyTruth, draft.punchline, rewrite, {
      humourOperator: draft.humourOperator,
      darknessLevel: draft.darknessLevel,
      species: draft.species,
    }));
  }
  return settled;
}

export async function generateArtStyleDevice(opts: {
  styleId: string;
  funnyTruth: string;
  punchline: string;
  surface?: ArtStyleSurface;
}): Promise<{ styleId: string; device: string; deviceText: string; deviceStructure: ArtStyleDeviceStructure; deviceMs: number; surface: ArtStyleSurface }> {
  const profile = artStyleProfile(opts.styleId);
  const style = petposterousArtStyle(opts.styleId);
  if (!profile || !style) throw Object.assign(new Error("Choose an art style."), { status: 400 });
  const truth = opts.funnyTruth.replace(/\s+/g, " ").trim();
  if (!truth) throw Object.assign(new Error("A truth is required."), { status: 400 });
  const surface = opts.surface ?? "apparel";
  const started = Date.now();
  const [written] = await runConceptEngine(
    deviceEngine(profile, surface),
    userLines([
      ["truth", truth],
      ["words", opts.punchline.replace(/\s+/g, " ").trim()],
      ["style", style.label],
      ["surface", SURFACE_DEVICE[surface]],
    ]),
  );
  return {
    styleId: opts.styleId,
    device: written.deviceText,
    deviceText: written.deviceText,
    deviceStructure: written.deviceStructure,
    deviceMs: Date.now() - started,
    surface,
  };
}

export async function generateArtStyleDevices(opts: {
  styleIds: string[];
  funnyTruth: string;
  punchline: string;
  surface?: ArtStyleSurface;
}): Promise<{ devices: Array<{ styleId: string; device: string; deviceText: string; deviceStructure: ArtStyleDeviceStructure; deviceMs: number; surface: ArtStyleSurface }>; deviceMs: number; surface: ArtStyleSurface }> {
  if (!opts.styleIds.length) throw Object.assign(new Error("Choose an art style."), { status: 400 });
  const surface = opts.surface ?? "apparel";
  const started = Date.now();
  const devices = await Promise.all(opts.styleIds.map((styleId) => generateArtStyleDevice({
    styleId,
    funnyTruth: opts.funnyTruth,
    punchline: opts.punchline,
    surface,
  })));
  return { devices, deviceMs: Date.now() - started, surface };
}
