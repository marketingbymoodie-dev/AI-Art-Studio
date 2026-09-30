/**
 * Per-request style-pack handling for the generate routes:
 *   1. enforce pack-only styles (resolveGeneratePack),
 *   2. check tagged reference images against the style's declared inputs,
 *   3. when the pack has a prompt profile, build the pack layers for compose.
 * A null context means legacy generation, unchanged.
 */
import { parseStyleInputCapabilities, checkReferenceInputs, type StyleInputCapabilities } from "@shared/stylePacks";
import {
  buildPackPromptLayers,
  countPunchlineWords,
  getStylePackProfile,
  type StylePackPromptProfile,
} from "@shared/stylePackProfiles";
import { buildRoleReferenceInstruction, type TaggedReferenceImage } from "@shared/referenceImages";
import type { PackPromptLayers } from "@shared/promptLayers";
import {
  parsePersonalityTraits,
  parseWordsMode,
  type CreativeBriefReference,
  type CreativeBriefV1,
  type WordsMode,
} from "@shared/creativeBrief";
import { resolveGeneratePack } from "./style-packs";
import { signReferencePath, storeReferenceDataUrl } from "./customer-references";

/** Request body fields (all optional; absent = legacy request). */
export type PackGenerateBody = {
  stylePackId?: unknown;
  packInputs?: unknown;
};

export type PackGenerationContext = {
  packId: string;
  packSlug: string;
  profile: StylePackPromptProfile;
  capabilities: StyleInputCapabilities | null;
  humorId: string | null;
  relationshipId: string | null;
  /** Selected visual joke (concept engine output, customer-picked). */
  concept: string | null;
  /** Words to render; "" = no words. Resolved from wordsMode. */
  punchline: string | null;
  wordsMode: WordsMode;
  petName: string | null;
  species: string | null;
  personalityTraits: string[];
  behavior: string | null;
  funnyTruth: string | null;
  subjectPriority: string | null;
  conceptIndex: number | null;
};

type Rejection = { status: number; body: Record<string, unknown> };

function str(v: unknown, max = 600): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim().slice(0, max);
  return t || null;
}

export async function preparePackGeneration(opts: {
  style: { id: string | number; catalogSlug?: string | null; visibility?: string | null; inputCapabilities?: unknown };
  merchantId: string | null | undefined;
  body: PackGenerateBody;
  referenceImages: TaggedReferenceImage[];
}): Promise<{ ok: true; ctx: PackGenerationContext | null } | ({ ok: false } & Rejection)> {
  const requestedPackId = str(opts.body.stylePackId, 80);
  const { allowed, pack } = await resolveGeneratePack(opts.style, opts.merchantId, requestedPackId);
  if (!allowed) {
    return { ok: false, status: 403, body: { error: "STYLE_NOT_AVAILABLE", message: "This style is not available." } };
  }

  const inputs = (opts.body.packInputs && typeof opts.body.packInputs === "object"
    ? opts.body.packInputs
    : {}) as Record<string, unknown>;
  const capabilities = parseStyleInputCapabilities(opts.style.inputCapabilities);
  const capError = checkReferenceInputs(
    capabilities,
    opts.referenceImages.map((r) => r.role),
    { personalized: inputs.personalized === true },
  );
  if (capError) {
    return { ok: false, status: 400, body: { error: capError.code, message: capError.message, role: capError.role } };
  }

  const profile = pack ? getStylePackProfile(pack.pack.promptProfileKey) : null;
  if (!pack || !profile) return { ok: true, ctx: null };

  const wordsMode = parseWordsMode(inputs.wordsMode);
  const punchline =
    wordsMode === "none" ? "" : wordsMode === "exact" ? str(inputs.exactWords, 120) ?? str(inputs.punchline, 120) : str(inputs.punchline, 120);
  const maxWords = profile.concept?.punchlineMaxWords;
  if (punchline && maxWords != null && countPunchlineWords(punchline) > maxWords) {
    return {
      ok: false,
      status: 400,
      body: { error: "PUNCHLINE_TOO_LONG", message: `Keep the words to ${maxWords} or fewer.` },
    };
  }
  return {
    ok: true,
    ctx: {
      packId: pack.pack.id,
      packSlug: pack.pack.slug,
      profile,
      capabilities,
      humorId: str(inputs.humor, 40),
      relationshipId: str(inputs.relationship, 40),
      concept: str(inputs.visualJoke),
      punchline,
      wordsMode,
      petName: str(inputs.petName, 40),
      species: str(inputs.species, 40),
      personalityTraits: parsePersonalityTraits(inputs.personalityTraits),
      behavior: str(inputs.behavior),
      funnyTruth: str(inputs.funnyTruth),
      subjectPriority: str(inputs.subjectPriority),
      conceptIndex: Number.isInteger(inputs.conceptIndex) ? (inputs.conceptIndex as number) : null,
    },
  };
}

/** Pack layers for composeLayeredPrompt, with images numbered in model-input order. */
export function packLayersForCompose(
  ctx: PackGenerationContext,
  opts: {
    isApparel: boolean;
    colorTier?: "light" | "dark" | null;
    styleImageCount: number;
    customerImages: TaggedReferenceImage[];
  },
): PackPromptLayers {
  return buildPackPromptLayers({
    profile: ctx.profile,
    capabilities: ctx.capabilities,
    isApparel: opts.isApparel,
    colorTier: opts.colorTier,
    humorId: ctx.humorId,
    relationshipId: ctx.relationshipId,
    concept: packConceptText(ctx),
    punchline: ctx.punchline,
    exactText: ctx.wordsMode === "exact",
    noText: ctx.wordsMode === "none",
    referenceInstruction: buildRoleReferenceInstruction({
      styleImageCount: opts.styleImageCount,
      customerImages: opts.customerImages,
      identityRules: ctx.profile.referenceIdentity,
    }),
  });
}

/** Subject facts + chosen visual joke, as one concept layer. */
export function packConceptText(ctx: Pick<PackGenerationContext, "petName" | "species" | "personalityTraits" | "concept" | "subjectPriority">): string | null {
  const who = [ctx.petName, ctx.species ? `a ${ctx.species.toLowerCase()}` : null].filter(Boolean).join(", ");
  const traits = ctx.personalityTraits.length ? `; a bit ${ctx.personalityTraits.map((t) => t.toLowerCase()).join(", ")}` : "";
  const lines = [
    who || traits ? `SUBJECT: ${who || "the pet"}${traits}.` : "",
    ctx.concept ? `CONCEPT: ${ctx.concept}` : "",
    ctx.subjectPriority ? `MUST STAY RECOGNISABLE: ${ctx.subjectPriority}` : "",
  ].filter(Boolean);
  return lines.length ? lines.join("\n") : null;
}

/** creative_brief for the job (hosted reference paths only — never data or signed URLs). */
export function creativeBriefFromContext(
  ctx: PackGenerationContext,
  opts: { styleSlug: string | null; subStyle: string | null; references: CreativeBriefReference[] },
): CreativeBriefV1 {
  return {
    v: 1,
    profileKey: ctx.profile.key,
    stylePackSlug: ctx.packSlug,
    stylePackId: ctx.packId,
    styleSlug: opts.styleSlug,
    subStyle: opts.subStyle,
    petName: ctx.petName,
    species: ctx.species,
    personalityTraits: ctx.personalityTraits,
    behavior: ctx.behavior,
    relationship: ctx.relationshipId,
    humor: ctx.humorId,
    wordsMode: ctx.wordsMode,
    funnyTruth: ctx.funnyTruth,
    visualJoke: ctx.concept,
    punchline: ctx.punchline,
    subjectPriority: ctx.subjectPriority,
    conceptIndex: ctx.conceptIndex,
    referenceImages: opts.references,
  };
}

/**
 * Pack generations: move customer photos into the private bucket and hand the
 * model short-lived signed URLs. Stored-photo references (brief reuse) are
 * re-signed only for this shop. Returns the refs for the model plus the brief
 * entries (paths only). A photo that can't be stored still reaches the model
 * as-is; it just isn't persisted.
 */
export async function hostPackReferences(opts: {
  shop: string;
  jobId: string;
  refs: TaggedReferenceImage[];
  log?: (msg: string) => void;
}): Promise<{ refs: TaggedReferenceImage[]; brief: CreativeBriefReference[] }> {
  const refs: TaggedReferenceImage[] = [];
  const brief: CreativeBriefReference[] = [];
  for (let i = 0; i < opts.refs.length; i++) {
    const r = opts.refs[i];
    try {
      if (r.storagePath) {
        const url = await signReferencePath(r.storagePath, opts.shop);
        if (!url) {
          opts.log?.(`reference ${i}: stored path rejected for this shop — skipped`);
          continue;
        }
        refs.push({ ...r, url });
        brief.push({ path: r.storagePath, role: r.role, label: r.label });
        continue;
      }
      if (r.url.startsWith("data:")) {
        const path = await storeReferenceDataUrl({ shop: opts.shop, jobId: opts.jobId, index: i, role: r.role, dataUrl: r.url });
        const url = await signReferencePath(path, opts.shop);
        refs.push({ ...r, url: url ?? r.url });
        brief.push({ path, role: r.role, label: r.label });
        continue;
      }
      refs.push(r);
    } catch (e: any) {
      opts.log?.(`reference ${i}: private store failed (${e?.message || e}) — sent unstored`);
      if (r.url) refs.push(r);
    }
  }
  return { refs, brief };
}
