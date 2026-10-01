/**
 * Central generation provider / credential / renderer resolution (server-only).
 *
 * Routes never branch on a store or pack name: they call resolveGenerationPlan()
 * and pass the plan to the generator. Who spends through which credential lives
 * only in ASSIGNMENTS below.
 *
 * Precedence: merchant assignment → pack assignment → default.
 * Default (every ordinary merchant today) = imagePath "legacy": the existing
 * Replicate / Nano Banana / chroma behaviour, untouched. The shared umbrella
 * OpenAI credential (OPENAI_API_KEY_MAIN) resolves for ordinary merchants but no
 * merchant is routed through it yet, and it is not required at startup.
 *
 * Credentials are env var NAMES only. Values are read at call time by
 * readCredential() and never returned in a plan, stored, logged or put in an
 * error. A missing credential never falls back to another credential/provider.
 */

export type ProviderId = "openai" | "google" | "replicate";
export type CredentialScope = "shared" | "dedicated";

export type CredentialRef = {
  id: string;
  provider: ProviderId;
  scope: CredentialScope;
  /** Env var name holding the secret. Never the value. */
  credentialKey: string;
  label: string;
};

export type GenerationQualitySetting = "low" | "medium" | "high" | "xhigh" | "max" | "auto";

export type ImageRenderer = {
  id: string;
  provider: "openai";
  model: string;
  quality: GenerationQualitySetting;
  /** USD per 1M tokens, for estimated cost from provider usage. */
  pricing: { textInPerM: number; imageInPerM: number; outputPerM: number };
};

export type GenerationAssignment = {
  credentials: Partial<Record<ProviderId, string>>;
  openaiImage?: {
    mode: "direct";
    defaultRenderer: string;
    escalationRenderer?: string;
    /** Product families rendered by direct OpenAI; others keep their legacy path. Omit = all. */
    productFamilies?: string[];
  };
};

export const CREDENTIALS: Record<string, CredentialRef> = {
  "openai:shared": {
    id: "openai:shared",
    provider: "openai",
    scope: "shared",
    credentialKey: "OPENAI_API_KEY_MAIN",
    label: "AppAI umbrella OpenAI project",
  },
  "openai:petposterous": {
    id: "openai:petposterous",
    provider: "openai",
    scope: "dedicated",
    credentialKey: "OPENAI_API_KEY_PETPOSTEROUS",
    label: "Petposterous OpenAI project",
  },
  "replicate:shared": {
    id: "replicate:shared",
    provider: "replicate",
    scope: "shared",
    credentialKey: "REPLICATE_API_TOKEN",
    label: "AppAI Replicate account (legacy paths)",
  },
};

const GPT_IMAGE_25_PRICING = { textInPerM: 5, imageInPerM: 8, outputPerM: 30 };

export const RENDERERS: Record<string, ImageRenderer> = {
  "openai-flare": {
    id: "openai-flare",
    provider: "openai",
    model: "gpt-image-2.5-flare",
    quality: "medium",
    pricing: GPT_IMAGE_25_PRICING,
  },
  "openai-sunburst": {
    id: "openai-sunburst",
    provider: "openai",
    model: "gpt-image-2.5-sunburst",
    quality: "medium",
    pricing: GPT_IMAGE_25_PRICING,
  },
};

/** Keys: `merchant:<merchantId>` or `pack:<style pack prompt_profile_key>`. */
export const ASSIGNMENTS: Record<string, GenerationAssignment> = {
  "pack:petposterous": {
    credentials: { openai: "openai:petposterous" },
    // Decor (poster/pillow/tapestry/bedding) stays on its current Nano Banana path for now.
    openaiImage: {
      mode: "direct",
      defaultRenderer: "openai-flare",
      escalationRenderer: "openai-sunburst",
      productFamilies: ["apparel"],
    },
  },
};

const DEFAULT_CREDENTIALS: Partial<Record<ProviderId, string>> = {
  openai: "openai:shared",
  replicate: "replicate:shared",
};

export type DirectOpenAIImagePath = {
  kind: "direct-openai";
  credential: CredentialRef;
  renderer: ImageRenderer;
  escalation: ImageRenderer | null;
};

export type GenerationPlan = {
  /** Which assignment won (`merchant:…`, `pack:…`, or `default`). */
  assignmentKey: string;
  credentials: Partial<Record<ProviderId, CredentialRef>>;
  imagePath: "legacy" | DirectOpenAIImagePath;
};

export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigError";
  }
}

export class ProviderCredentialUnavailableError extends Error {
  code = "PROVIDER_CREDENTIAL_UNAVAILABLE";
  constructor() {
    super("Artwork generation is temporarily unavailable for this store. Please try again later.");
    this.name = "ProviderCredentialUnavailableError";
  }
}

function credentialRef(id: string): CredentialRef {
  const ref = CREDENTIALS[id];
  if (!ref) throw new ProviderConfigError(`Unknown credential ref "${id}"`);
  return ref;
}

function renderer(id: string): ImageRenderer {
  const r = RENDERERS[id];
  if (!r) throw new ProviderConfigError(`Unknown renderer "${id}"`);
  return r;
}

export function resolveGenerationPlan(
  input: {
    merchantId?: string | null;
    packProfileKey?: string | null;
    productFamily?: string | null;
    /** Apparel storage path (keeps native alpha). An "apparel" family must also be isApparel to render direct. */
    isApparel?: boolean;
  },
  assignments: Record<string, GenerationAssignment> = ASSIGNMENTS,
): GenerationPlan {
  const merchantKey = input.merchantId ? `merchant:${input.merchantId}` : null;
  const packKey = input.packProfileKey ? `pack:${input.packProfileKey}` : null;
  const assignmentKey =
    (merchantKey && assignments[merchantKey] && merchantKey) || (packKey && assignments[packKey] && packKey) || "default";
  const assignment = assignmentKey === "default" ? null : assignments[assignmentKey];

  const credentials: Partial<Record<ProviderId, CredentialRef>> = {};
  for (const provider of ["openai", "google", "replicate"] as ProviderId[]) {
    const id = assignment?.credentials[provider] ?? DEFAULT_CREDENTIALS[provider];
    if (!id) continue;
    const ref = credentialRef(id);
    if (ref.provider !== provider) throw new ProviderConfigError(`Credential "${id}" is not a ${provider} credential`);
    credentials[provider] = ref;
  }

  let imagePath: GenerationPlan["imagePath"] = "legacy";
  const families = assignment?.openaiImage?.productFamilies;
  const familyMatches =
    (!families || (input.productFamily != null && families.includes(input.productFamily))) &&
    (input.productFamily !== "apparel" || input.isApparel === true);
  if (assignment?.openaiImage?.mode === "direct" && familyMatches) {
    const credential = credentials.openai;
    if (!credential) throw new ProviderConfigError(`${assignmentKey} has a direct OpenAI image path but no OpenAI credential`);
    imagePath = {
      kind: "direct-openai",
      credential,
      renderer: renderer(assignment.openaiImage.defaultRenderer),
      escalation: assignment.openaiImage.escalationRenderer ? renderer(assignment.openaiImage.escalationRenderer) : null,
    };
  }
  return { assignmentKey, credentials, imagePath };
}

/** Default renderer, or the escalation renderer when asked (nothing escalates automatically yet). */
export function selectRenderer(path: DirectOpenAIImagePath, opts: { escalate?: boolean } = {}): ImageRenderer {
  return opts.escalate && path.escalation ? path.escalation : path.renderer;
}

/** Reads the secret for exactly this ref. Missing → throws; never substitutes another credential. */
export function readCredential(ref: CredentialRef, env: Record<string, string | undefined> = process.env): string {
  const value = env[ref.credentialKey]?.trim();
  if (!value) {
    console.error(`[Providers] ${ref.credentialKey} is not set; refusing ${ref.id} generation (no fallback)`);
    throw new ProviderCredentialUnavailableError();
  }
  return value;
}

/** Strip a secret (and anything key-shaped) from provider text before it is logged or stored. */
export function redactSecrets(text: string, secret?: string): string {
  let out = secret ? text.split(secret).join("[redacted]") : text;
  out = out.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]");
  return out;
}
