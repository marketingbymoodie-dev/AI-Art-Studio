/**
 * Style-pack concept writer: turns the customer's story + humour/relationship
 * into a visual joke and a short punchline before image generation. Built from
 * a pack profile's `concept` config; runs on the shared concept-engine runner
 * (same Anthropic path as Quotes, separate system prompt).
 */
import { countPunchlineWords, type StylePackPromptProfile } from "@shared/stylePackProfiles";
import { PETPOSTEROUS_CONCEPT_FRAMEWORKS } from "@shared/petposterousCreative";
import { runConceptEngine, type ConceptEngine } from "./concept-engine";

export type PackConceptOption = {
  funnyTruth: string;
  visualJoke: string;
  /** "" = no text on the design. */
  punchline: string;
  subjectPriority: string;
  conceptFramework?: string;
};

export const PACK_CONCEPT_OPTION_COUNT = 3;

const OUTPUT_CONTRACT = `Return ONLY JSON: {"options":[{"funny_truth": string, "visual_joke": string, "punchline": string, "subject_priority": string}, ...]}
Exactly THREE options. No markdown, no commentary.
- funny_truth: the recognisable truth that makes it funny (one sentence).
- visual_joke: the single image that communicates it — ONE concise sentence, at most 25 words, visual only.
- punchline: the words on the design, or "" when the image is stronger without text. No wrapping quotation marks.
- subject_priority: what must stay recognisable from the customer's photos.`;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function parsePackConceptOptions(raw: unknown, punchlineMaxWords: number, requireFramework = false): PackConceptOption[] | null {
  if (!raw || typeof raw !== "object") return null;
  const list = (raw as { options?: unknown }).options;
  if (!Array.isArray(list) || list.length !== PACK_CONCEPT_OPTION_COUNT) return null;
  const out: PackConceptOption[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") return null;
    const o = item as Record<string, unknown>;
    const funnyTruth = str(o.funny_truth);
    const visualJoke = str(o.visual_joke);
    const subjectPriority = str(o.subject_priority);
    const punchline = str(o.punchline).replace(/^["“”]+|["“”]+$/g, "").trim();
    if (!funnyTruth || !visualJoke || !subjectPriority) return null;
    if (countPunchlineWords(punchline) > punchlineMaxWords) return null;
    const framework = str(o.concept_framework);
    if (requireFramework && !Object.prototype.hasOwnProperty.call(PETPOSTEROUS_CONCEPT_FRAMEWORKS, framework)) return null;
    out.push({ funnyTruth, visualJoke, punchline, subjectPriority, ...(requireFramework ? { conceptFramework: framework } : {}) });
  }
  return out;
}

export function packConceptEngine(profile: StylePackPromptProfile): ConceptEngine<PackConceptOption> | null {
  const cfg = profile.concept;
  if (!cfg || !cfg.system.trim()) return null;
  const max = cfg.punchlineMaxWords;
  const v2 = profile.key === "petposterous";
  const frameworkContract = v2 ? `\nFor each option also return concept_framework, choosing one ID from this internal story taxonomy (never an art style): ${JSON.stringify(PETPOSTEROUS_CONCEPT_FRAMEWORKS)}. Choose by the funny truth. Do not constrain the three ideas to a selected visual style; the customer selects the LOOK afterward.` : "";
  return {
    id: `pack:${profile.key}`,
    logTag: `[pack-concept:${profile.key}]`,
    noun: "Concept writer",
    system: `${cfg.system.trim()}\n\nPunchline: at most ${max} words.\n\n${OUTPUT_CONTRACT}${frameworkContract}`,
    maxTokens: v2 ? 1400 : 900,
    parse: (raw) => parsePackConceptOptions(raw, max, v2),
  };
}

/** Labelled inputs ("PET: Malcolm, tabby cat") in the order given; empty values skipped. */
export function packConceptUserMessage(fields: Array<[string, string | null | undefined]>): string {
  const lines = fields
    .map(([label, value]) => [label.trim().toUpperCase(), (value || "").replace(/\s+/g, " ").trim()] as const)
    .filter(([, v]) => v)
    .map(([l, v]) => `${l}: ${v.slice(0, 400)}`);
  return `${lines.join("\n")}\nWrite three options.`;
}

export async function generatePackConceptOptions(
  profile: StylePackPromptProfile,
  fields: Array<[string, string | null | undefined]>,
): Promise<PackConceptOption[]> {
  const engine = packConceptEngine(profile);
  if (!engine) {
    throw Object.assign(new Error("This style pack has no concept writer"), { status: 404 });
  }
  if (!fields.some(([, v]) => (v || "").trim())) {
    throw Object.assign(new Error("Describe your idea first"), { status: 400 });
  }
  return runConceptEngine(engine, packConceptUserMessage(fields));
}
