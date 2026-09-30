/**
 * Code-level prompt profiles for style packs (`style_packs.prompt_profile_key`).
 * A profile holds the reusable layers every style in a pack shares; each pack
 * style's DB row keeps only its own creative scenario (prompt_prefix).
 *
 * A pack without a profile is a pure style filter: legacy compose, no layers.
 * Profiles are registered here by content work, not by infrastructure.
 */
import type { PackPromptLayers } from "./promptLayers";
import type { StyleInputCapabilities } from "./stylePacks";
import { PETPOSTEROUS_PROMPT_PROFILE } from "./packs/petposterous";

export type StylePackOption = { id: string; label: string; fragment: string };

export type StylePackConceptConfig = {
  /** Creative brief for the concept writer; the JSON output contract is appended by the engine. */
  system: string;
  /** Hard cap on punchline words (0 = text-free is always allowed). */
  punchlineMaxWords: number;
};

export type StylePackPromptProfile = {
  key: string;
  creativeBase: string;
  textRule: string;
  /** Added after textRule only when the customer supplied their own exact words. */
  exactTextRule?: string;
  /** Likeness rules, added after the numbered image list when a pet/owner photo is present. */
  referenceIdentity: string;
  rendererExtra: { apparel?: string; decor?: string };
  garmentColour?: { light?: string; dark?: string };
  humorOptions: StylePackOption[];
  relationshipOptions: StylePackOption[];
  concept?: StylePackConceptConfig | null;
};

const PROFILES = new Map<string, StylePackPromptProfile>();

export function registerStylePackProfile(profile: StylePackPromptProfile): void {
  PROFILES.set(profile.key, profile);
}

registerStylePackProfile(PETPOSTEROUS_PROMPT_PROFILE);

export function getStylePackProfile(key: string | null | undefined): StylePackPromptProfile | null {
  return key ? PROFILES.get(key) ?? null : null;
}

function pickOption(
  options: StylePackOption[],
  requested: string | null | undefined,
  selector: { supported: boolean; default: string | null } | undefined,
): StylePackOption | null {
  // A style that declares the selector unsupported never gets the layer.
  if (selector && !selector.supported) return null;
  const want = (requested || "").trim() || selector?.default || "";
  return options.find((o) => o.id === want) ?? null;
}

export type BuildPackLayersInput = {
  profile: StylePackPromptProfile;
  capabilities: StyleInputCapabilities | null;
  isApparel: boolean;
  colorTier?: "light" | "dark" | null;
  humorId?: string | null;
  relationshipId?: string | null;
  /** Visual joke from the concept engine (or customer-edited). */
  concept?: string | null;
  punchline?: string | null;
  /** The punchline is the customer's own exact words (not a suggestion). */
  exactText?: boolean;
  /** Output of buildRoleReferenceInstruction (already includes identity rules). */
  referenceInstruction?: string | null;
};

export function buildPackPromptLayers(input: BuildPackLayersInput): PackPromptLayers {
  const { profile, capabilities } = input;
  const humor = pickOption(profile.humorOptions, input.humorId, capabilities?.humor);
  const relationship = pickOption(profile.relationshipOptions, input.relationshipId, capabilities?.relationship);
  const colour = input.isApparel
    ? input.colorTier === "dark"
      ? profile.garmentColour?.dark
      : profile.garmentColour?.light
    : null;
  return {
    creativeBase: profile.creativeBase,
    referenceIdentity: input.referenceInstruction || null,
    humor: humor?.fragment ?? null,
    relationship: relationship?.fragment ?? null,
    concept: input.concept ?? null,
    punchline: input.punchline ?? null,
    textRule:
      input.exactText && input.punchline && profile.exactTextRule
        ? `${profile.textRule}
${profile.exactTextRule}`
        : profile.textRule,
    rendererExtra: input.isApparel ? profile.rendererExtra.apparel ?? null : profile.rendererExtra.decor ?? null,
    garmentColour: colour ?? null,
  };
}

export function countPunchlineWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}
