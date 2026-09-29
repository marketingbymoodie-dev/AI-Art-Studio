/**
 * Structured creative brief for style-pack generations
 * (generation_jobs.creative_brief, server-owned). Lets a design be reloaded,
 * regenerated, reused on another product or restyled later with the same
 * inputs, selected concept and customer photos. Null on legacy generations.
 */
import type { ReferenceImageRole } from "./stylePacks";

export type WordsMode = "suggest" | "exact" | "none";

export type CreativeBriefReference = {
  /** Private storage path (server/customer-references.ts); never a URL. */
  path: string;
  role: ReferenceImageRole;
  label: string | null;
};

export type CreativeBriefV1 = {
  v: 1;
  profileKey: string | null;
  stylePackSlug: string | null;
  stylePackId: string | null;
  styleSlug: string | null;
  subStyle: string | null;
  petName: string | null;
  species: string | null;
  personalityTraits: string[];
  behavior: string | null;
  relationship: string | null;
  humor: string | null;
  wordsMode: WordsMode;
  funnyTruth: string | null;
  visualJoke: string | null;
  punchline: string | null;
  subjectPriority: string | null;
  conceptIndex: number | null;
  referenceImages: CreativeBriefReference[];
};

/** Brief as returned to clients: references carry a fresh signed URL (may be null). */
export type PublicCreativeBrief = Omit<CreativeBriefV1, "referenceImages"> & {
  referenceImages: Array<CreativeBriefReference & { url: string | null }>;
};

export const MAX_PERSONALITY_TRAITS = 3;

function str(v: unknown, max = 600): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim().slice(0, max);
  return t || null;
}

export function parseWordsMode(v: unknown): WordsMode {
  return v === "exact" || v === "none" ? v : "suggest";
}

export function parsePersonalityTraits(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const t of v) {
    const s = str(t, 40);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= MAX_PERSONALITY_TRAITS) break;
  }
  return out;
}

const ROLES: ReferenceImageRole[] = ["pet", "owner", "other"];

/** Tolerant read of a stored brief (older/partial shapes degrade to nulls). */
export function parseCreativeBrief(raw: unknown): CreativeBriefV1 | null {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object" || (v as any).v !== 1) return null;
  const o = v as Record<string, any>;
  const conceptIndex = Number.isInteger(o.conceptIndex) && o.conceptIndex >= 0 && o.conceptIndex < 10 ? o.conceptIndex : null;
  return {
    v: 1,
    profileKey: str(o.profileKey, 60),
    stylePackSlug: str(o.stylePackSlug, 80),
    stylePackId: str(o.stylePackId, 80),
    styleSlug: str(o.styleSlug, 80),
    subStyle: str(o.subStyle, 60),
    petName: str(o.petName, 40),
    species: str(o.species, 40),
    personalityTraits: parsePersonalityTraits(o.personalityTraits),
    behavior: str(o.behavior),
    relationship: str(o.relationship, 40),
    humor: str(o.humor, 40),
    wordsMode: parseWordsMode(o.wordsMode),
    funnyTruth: str(o.funnyTruth),
    visualJoke: str(o.visualJoke),
    punchline: typeof o.punchline === "string" ? o.punchline.trim().slice(0, 120) : null,
    subjectPriority: str(o.subjectPriority),
    conceptIndex,
    referenceImages: (Array.isArray(o.referenceImages) ? o.referenceImages : [])
      .filter((r: any) => r && typeof r.path === "string")
      .slice(0, 5)
      .map((r: any) => ({
        path: r.path,
        role: ROLES.includes(r.role) ? r.role : "other",
        label: str(r.label, 40),
      })),
  };
}
