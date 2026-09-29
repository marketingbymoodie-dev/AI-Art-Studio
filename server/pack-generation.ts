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
import { resolveGeneratePack } from "./style-packs";

/** Request body fields (all optional; absent = legacy request). */
export type PackGenerateBody = {
  stylePackId?: unknown;
  packInputs?: unknown;
};

export type PackGenerationContext = {
  packId: string;
  profile: StylePackPromptProfile;
  capabilities: StyleInputCapabilities | null;
  humorId: string | null;
  relationshipId: string | null;
  concept: string | null;
  punchline: string | null;
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

  const punchline = str(inputs.punchline, 120);
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
      profile,
      capabilities,
      humorId: str(inputs.humor, 40),
      relationshipId: str(inputs.relationship, 40),
      concept: str(inputs.visualJoke),
      punchline,
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
    concept: ctx.concept,
    punchline: ctx.punchline,
    referenceInstruction: buildRoleReferenceInstruction({
      styleImageCount: opts.styleImageCount,
      customerImages: opts.customerImages,
      identityRules: ctx.profile.referenceIdentity,
    }),
  });
}
