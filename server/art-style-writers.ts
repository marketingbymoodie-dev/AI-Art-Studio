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

/** A wording line in the behaviour box. The Exact wording field wins when it is filled. */
export function suppliedWordingFromBehaviour(behaviour: string): { situation: string; wording: string } {
  const clean = behaviour.replace(/\s+/g, " ").trim();
  const match = /\btext\s+(?:reads|says|is)\s*:?\s*(.+)$/i.exec(clean);
  if (!match) return { situation: clean, wording: "" };
  const wording = match[1].replace(/^["“”]+|["“”]+$/g, "").trim();
  const situation = clean.slice(0, match.index).replace(/[\s.]+$/, "").trim();
  return { situation: situation || clean, wording };
}

export function deviceContradictsSpecies(text: string, species: string): boolean {
  const animal = species === "dog" ? "cat" : species === "cat" ? "dog" : "";
  if (!animal) return false;
  const other = new RegExp(`\\b${animal}\\b`, "i");
  const same = new RegExp(`\\b${species}\\b`, "i");
  return other.test(text) && !same.test(text);
}

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

function truthEngine(suppliedWording: string): ConceptEngine<ArtStyleTruthDraft> {
  const punchlineRule = suppliedWording
    ? `The operator supplied the exact wording. Every punchline is exactly "${suppliedWording}". Do not write a different line.`
    : `punchline is the words on the design, at most ${PUNCHLINE_MAX_WORDS} words, or "" when the image is stronger without text.`;
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
${punchlineRule}`,
    parse: (raw) => parseArtStyleTruths(raw, suppliedWording),
  };
}

export function parseArtStyleTruths(raw: unknown, suppliedWording = ""): ArtStyleTruthDraft[] | null {
  if (!raw || typeof raw !== "object") return null;
  const list = (raw as { options?: unknown }).options;
  if (!Array.isArray(list) || list.length !== 3) return null;
  const locked = suppliedWording.replace(/\s+/g, " ").trim();
  if (locked && countPunchlineWords(locked) > PUNCHLINE_MAX_WORDS) return null;
  const out: ArtStyleTruthDraft[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") return null;
    const o = item as Record<string, unknown>;
    const funnyTruth = clip(o.funny_truth, 400);
    const punchline = locked || clip(o.punchline, 120).replace(/^["“”]+|["“”]+$/g, "").trim();
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

/** What the device writer is told. The truth may abstract the incident; the behaviour still has it. */
export const ART_STYLE_DEVICE_BINDING = "The behaviour is what happened. Draw that incident. The truth is the angle on it, not a replacement incident. Species is the animal. Do not change the animal or swap the behaviour's object for a different one.";

export function artStyleDeviceSystem(profile: ArtStyleProfile, surface: ArtStyleSurface): string {
  const style = petposterousArtStyle(profile.styleId);
  return `You choose one device structure, then write one visual device for a pet graphic.
device_structure is exactly one of: ${ART_STYLE_DEVICE_STRUCTURES.join(", ")}.
device_text is one sentence: the behaviour, seen from the truth, in this art style.
${ART_STYLE_DEVICE_BINDING}
The props line is a limit, not a subject. Do not draw its example unless the behaviour is about that object.
You receive the exact wording so your composition can leave room for it. Do not repeat it, quote it, or describe how it appears. The type rules already govern the lettering, and a second instruction about the words will override them — whatever object you attach the words to is where the renderer will put them. Describe the picture and leave clear space for the lettering.
A second person may appear only as a hand, a foot, or a sliver of silhouette.
Surface: ${surface}. ${SURFACE_DEVICE[surface]}
Style: ${style?.label ?? profile.styleId}.
Truth shape it suits: ${profile.truthShape}
Text appetite: ${profile.textAppetite}.
Complexity ceiling: ${profile.complexityCeiling}
Props it may call for: ${profile.props}
Return ONLY JSON: {"device_structure": string, "device_text": string}`;
}

export function artStyleDeviceUserMessage(opts: {
  behaviour: string;
  truth: string;
  words: string;
  species: string;
  styleLabel: string;
  surfaceLine: string;
}): string {
  return userLines([
    ["behaviour", opts.behaviour],
    ["truth", opts.truth],
    ["words", opts.words],
    ["species", opts.species],
    ["style", opts.styleLabel],
    ["surface", opts.surfaceLine],
  ]);
}

function deviceEngine(profile: ArtStyleProfile, surface: ArtStyleSurface): ConceptEngine<ArtStyleDeviceDraft> {
  return {
    id: `art-style-device:${profile.styleId}:${surface}`,
    logTag: `[art-style-device:${profile.styleId}:${surface}]`,
    noun: "Device writer",
    maxTokens: 400,
    system: artStyleDeviceSystem(profile, surface),
    parse: (raw) => {
      const device = parseArtStyleDevice(raw);
      return device ? [device] : null;
    },
  };
}

function userLines(fields: Array<[string, string]>): string {
  return fields.map(([label, value]) => `${label.toUpperCase()}: ${value}`).join("\n");
}

export async function generateArtStyleTruths(behaviour: string, productFamily: string, styleId: string, exactWording = ""): Promise<SettledArtStyleTruth[]> {
  const parsed = suppliedWordingFromBehaviour(behaviour);
  const typed = exactWording.replace(/\s+/g, " ").trim().replace(/^["“”]+|["“”]+$/g, "");
  const split = { situation: parsed.situation, wording: typed || parsed.wording };
  if (split.wording && countPunchlineWords(split.wording) > PUNCHLINE_MAX_WORDS) {
    throw Object.assign(new Error(`Exact wording is more than ${PUNCHLINE_MAX_WORDS} words.`), { status: 400 });
  }
  const fields = artStyleTruthFields(split.situation, productFamily, styleId);
  const drafts = await runConceptEngine(truthEngine(split.wording), `${userLines(fields)}\nWrite three options.`);
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
  behaviour: string;
  species: string;
  surface?: ArtStyleSurface;
}): Promise<{ styleId: string; device: string; deviceText: string; deviceStructure: ArtStyleDeviceStructure; deviceMs: number; surface: ArtStyleSurface }> {
  const profile = artStyleProfile(opts.styleId);
  const style = petposterousArtStyle(opts.styleId);
  if (!profile || !style) throw Object.assign(new Error("Choose an art style."), { status: 400 });
  const truth = opts.funnyTruth.replace(/\s+/g, " ").trim();
  const behaviour = opts.behaviour.replace(/\s+/g, " ").trim();
  const species = flywheelSpecies(opts.species) ?? "";
  if (!truth) throw Object.assign(new Error("A truth is required."), { status: 400 });
  if (!behaviour) throw Object.assign(new Error("The behaviour is required."), { status: 400 });
  if (!species) throw Object.assign(new Error("Species is required."), { status: 400 });
  const surface = opts.surface ?? "apparel";
  const started = Date.now();
  let written: ArtStyleDeviceDraft | undefined;
  const userMessage = artStyleDeviceUserMessage({
    behaviour,
    truth,
    words: opts.punchline.replace(/\s+/g, " ").trim(),
    species,
    styleLabel: style.label,
    surfaceLine: SURFACE_DEVICE[surface],
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const [row] = await runConceptEngine(deviceEngine(profile, surface), userMessage);
    if (!deviceContradictsSpecies(row.deviceText, species)) {
      written = row;
      break;
    }
  }
  if (!written) throw Object.assign(new Error("Device writer changed the animal."), { status: 502 });
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
  behaviour: string;
  species: string;
  surface?: ArtStyleSurface;
}): Promise<{ devices: Array<{ styleId: string; device: string; deviceText: string; deviceStructure: ArtStyleDeviceStructure; deviceMs: number; surface: ArtStyleSurface }>; deviceMs: number; surface: ArtStyleSurface }> {
  if (!opts.styleIds.length) throw Object.assign(new Error("Choose an art style."), { status: 400 });
  const surface = opts.surface ?? "apparel";
  const started = Date.now();
  const devices = await Promise.all(opts.styleIds.map((styleId) => generateArtStyleDevice({
    styleId,
    funnyTruth: opts.funnyTruth,
    punchline: opts.punchline,
    behaviour: opts.behaviour,
    species: opts.species,
    surface,
  })));
  return { devices, deviceMs: Date.now() - started, surface };
}
