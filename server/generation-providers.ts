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
 * credentials (OPENAI_API_KEY_MAIN, GEMINI_API_KEY_MAIN) serve styles whose
 * generation route (style_presets.generation_model) names a direct provider;
 * floating styles default to Flare (OpenAI direct), so OPENAI_API_KEY_MAIN is
 * required wherever floating styles are live.
 *
 * A style route overrides the assignment's renderer choice but never its
 * credentials: the winning assignment still decides whose key pays.
 *
 * Model, quality and output resolution live in RENDERERS / ASSIGNMENTS, never in
 * creative prompt text. Aspect ratio stays a product property, separate from
 * resolution.
 *
 * Credentials are ref ids + env var NAMES only. Values are read at call time by
 * readCredential() — operator-entered DB key (server/credential-store.ts) first,
 * then the env var — and never returned in a plan, stored, logged or put in an
 * error. A missing credential never falls back to another credential/provider.
 */

import type { GenerationRouteId } from "@shared/generationRoutes";

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

export type GoogleImageSize = "1K" | "2K" | "4K";

export type GoogleImageRenderer = {
  id: string;
  provider: "google";
  model: string;
  /** USD per 1M tokens (input text/image, output image). */
  pricing: { inputPerM: number; outputPerM: number };
  /** False for models without the 1K/2K/4K setting (they render at their native size). */
  supportsImageSize?: boolean;
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
  googleImage?: {
    mode: "direct";
    defaultRenderer: string;
    escalationRenderer?: string;
    /** Product families rendered by direct Google; others keep their legacy path. Omit = all. */
    productFamilies?: string[];
    defaultImageSize: GoogleImageSize;
    /** Product treatment: output resolution per family (aspect ratio comes from the product). */
    imageSizeByFamily?: Partial<Record<string, GoogleImageSize>>;
    /** Full-bleed wall-art families: add the no-border / reach-the-edges output rule. */
    fullBleedWallArtFamilies?: string[];
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
  "google:shared": {
    id: "google:shared",
    provider: "google",
    scope: "shared",
    credentialKey: "GEMINI_API_KEY_MAIN",
    label: "AppAI umbrella Google AI Studio project",
  },
  "google:petposterous": {
    id: "google:petposterous",
    provider: "google",
    scope: "dedicated",
    credentialKey: "GEMINI_API_KEY_PETPOSTEROUS",
    label: "Petposterous Google AI Studio project",
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

export const GOOGLE_RENDERERS: Record<string, GoogleImageRenderer> = {
  // Nano Banana 2 — default. Supports 1K/2K/4K itself; size is chosen per product, not by model.
  "google-nb2": {
    id: "google-nb2",
    provider: "google",
    model: "gemini-3.1-flash-image",
    pricing: { inputPerM: 0.5, outputPerM: 60 },
  },
  // Nano Banana Pro — premium/escalation for precision-heavy work; never automatic yet.
  // Nano Banana (Gemini 2.5 Flash Image, the model Replicate's google/nano-banana serves).
  // Not a default anywhere; available for controlled comparisons.
  "google-nb25": {
    id: "google-nb25",
    provider: "google",
    model: "gemini-2.5-flash-image",
    pricing: { inputPerM: 0.3, outputPerM: 30 },
    supportsImageSize: false,
  },
  "google-nb-pro": {
    id: "google-nb-pro",
    provider: "google",
    model: "gemini-3-pro-image",
    pricing: { inputPerM: 2, outputPerM: 120 },
  },
};

/** Keys: `merchant:<merchantId>` or `pack:<style pack prompt_profile_key>`. */
export const ASSIGNMENTS: Record<string, GenerationAssignment> = {
  "pack:petposterous": {
    credentials: { openai: "openai:petposterous", google: "google:petposterous" },
    openaiImage: {
      mode: "direct",
      defaultRenderer: "openai-flare",
      escalationRenderer: "openai-sunburst",
      productFamilies: ["apparel"],
    },
    googleImage: {
      mode: "direct",
      defaultRenderer: "google-nb2",
      escalationRenderer: "google-nb-pro",
      productFamilies: ["poster", "pillow", "tapestry", "bedding"],
      defaultImageSize: "2K",
      imageSizeByFamily: { poster: "2K", pillow: "2K", tapestry: "4K", bedding: "4K" },
      fullBleedWallArtFamilies: ["poster", "tapestry"],
    },
  },
};

const DEFAULT_CREDENTIALS: Partial<Record<ProviderId, string>> = {
  openai: "openai:shared",
  google: "google:shared",
  replicate: "replicate:shared",
};

/** Replicate model slugs behind the Replicate style routes (model-slug predictions endpoint). */
export const REPLICATE_ROUTE_MODELS: Record<"replicate-flare" | "replicate-nb2", string> = {
  "replicate-flare": "openai/gpt-image-2.5-flare",
  "replicate-nb2": "google/nano-banana-2",
};

/** Full-bleed wall-art families when no assignment lists its own. */
const DEFAULT_FULL_BLEED_WALL_ART_FAMILIES = ["poster", "tapestry"];
const DEFAULT_GOOGLE_IMAGE_SIZE_BY_FAMILY: Partial<Record<string, GoogleImageSize>> = { tapestry: "4K", bedding: "4K" };

export type DirectOpenAIImagePath = {
  kind: "direct-openai";
  credential: CredentialRef;
  renderer: ImageRenderer;
  escalation: ImageRenderer | null;
  /** "transparent" for apparel / floating styles; "opaque" for full-canvas decor art. */
  background: "transparent" | "opaque";
  fullBleedWallArt: boolean;
};

export type ReplicateImagePath = {
  kind: "replicate";
  credential: CredentialRef;
  routeId: "replicate-flare" | "replicate-nb2";
  model: string;
  background: "transparent" | "opaque";
  fullBleedWallArt: boolean;
};

export type DirectGoogleImagePath = {
  kind: "direct-google";
  credential: CredentialRef;
  renderer: GoogleImageRenderer;
  escalation: GoogleImageRenderer | null;
  imageSize: GoogleImageSize;
  fullBleedWallArt: boolean;
};

export type GenerationPlan = {
  /** Which assignment won (`merchant:…`, `pack:…`, or `default`). */
  assignmentKey: string;
  credentials: Partial<Record<ProviderId, CredentialRef>>;
  imagePath: "legacy" | DirectOpenAIImagePath | DirectGoogleImagePath | ReplicateImagePath;
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

function googleRenderer(id: string): GoogleImageRenderer {
  const r = GOOGLE_RENDERERS[id];
  if (!r) throw new ProviderConfigError(`Unknown Google renderer "${id}"`);
  return r;
}

function familyMatches(families: string[] | undefined, input: { productFamily?: string | null; isApparel?: boolean }) {
  return (
    (!families || (input.productFamily != null && families.includes(input.productFamily))) &&
    (input.productFamily !== "apparel" || input.isApparel === true)
  );
}

export function resolveGenerationPlan(
  input: {
    merchantId?: string | null;
    packProfileKey?: string | null;
    productFamily?: string | null;
    /** Apparel storage path (keeps native alpha). An "apparel" family must also be isApparel to render direct. */
    isApparel?: boolean;
    /**
     * Route chosen on the style (shared/generationRoutes.ts). Overrides the
     * assignment's renderer choice; credentials still come from the assignment.
     * Null = assignment / legacy behaviour.
     */
    styleRoute?: GenerationRouteId | null;
    /** Style + product want native alpha (apparel / floating). Only read with styleRoute. */
    nativeTransparent?: boolean;
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
  const google = assignment?.googleImage;
  const family = input.productFamily ?? null;
  const fullBleedWallArt =
    !input.isApparel && !!family && (google?.fullBleedWallArtFamilies ?? DEFAULT_FULL_BLEED_WALL_ART_FAMILIES).includes(family);
  const route = input.styleRoute ?? null;
  if (route) {
    const background = input.nativeTransparent ? "transparent" : "opaque";
    const need = (provider: ProviderId) => {
      const credential = credentials[provider];
      if (!credential) throw new ProviderConfigError(`${assignmentKey} has no ${provider} credential for style route ${route}`);
      return credential;
    };
    if (route === "openai-flare") {
      const escalation = assignment?.openaiImage?.escalationRenderer;
      imagePath = {
        kind: "direct-openai",
        credential: need("openai"),
        renderer: renderer("openai-flare"),
        escalation: escalation ? renderer(escalation) : null,
        background,
        fullBleedWallArt: background === "opaque" && fullBleedWallArt,
      };
    } else if (route === "google-nb2" || route === "google-nb-pro") {
      imagePath = {
        kind: "direct-google",
        credential: need("google"),
        renderer: googleRenderer(route),
        escalation: route === "google-nb2" ? googleRenderer("google-nb-pro") : null,
        imageSize:
          (family && (google?.imageSizeByFamily ?? DEFAULT_GOOGLE_IMAGE_SIZE_BY_FAMILY)[family]) ||
          google?.defaultImageSize ||
          "2K",
        fullBleedWallArt,
      };
    } else {
      imagePath = {
        kind: "replicate",
        credential: need("replicate"),
        routeId: route,
        model: REPLICATE_ROUTE_MODELS[route],
        background: route === "replicate-flare" ? background : "opaque",
        fullBleedWallArt,
      };
    }
    return { assignmentKey, credentials, imagePath };
  }
  if (assignment?.openaiImage?.mode === "direct" && familyMatches(assignment.openaiImage.productFamilies, input)) {
    const credential = credentials.openai;
    if (!credential) throw new ProviderConfigError(`${assignmentKey} has a direct OpenAI image path but no OpenAI credential`);
    imagePath = {
      kind: "direct-openai",
      credential,
      renderer: renderer(assignment.openaiImage.defaultRenderer),
      escalation: assignment.openaiImage.escalationRenderer ? renderer(assignment.openaiImage.escalationRenderer) : null,
      background: "transparent",
      fullBleedWallArt: false,
    };
  } else if (google?.mode === "direct" && familyMatches(google.productFamilies, input)) {
    const credential = credentials.google;
    if (!credential) throw new ProviderConfigError(`${assignmentKey} has a direct Google image path but no Google credential`);
    imagePath = {
      kind: "direct-google",
      credential,
      renderer: googleRenderer(google.defaultRenderer),
      escalation: google.escalationRenderer ? googleRenderer(google.escalationRenderer) : null,
      imageSize: (input.productFamily && google.imageSizeByFamily?.[input.productFamily]) || google.defaultImageSize,
      fullBleedWallArt: !!input.productFamily && (google.fullBleedWallArtFamilies ?? []).includes(input.productFamily),
    };
  }
  return { assignmentKey, credentials, imagePath };
}

/**
 * Staging-only, per-request renderer swap for controlled model comparisons. Swaps the
 * renderer of an already-resolved direct path to another configured renderer of the
 * same provider; credential, prompt and processing are untouched. Ignored unless the
 * Railway environment is staging (or GENERATION_RENDERER_OVERRIDE_ENABLED=true), and
 * never in production.
 */
export function applyRendererOverride(
  plan: GenerationPlan,
  requested: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): GenerationPlan {
  if (!requested || plan.imagePath === "legacy") return plan;
  const envName = String(env.RAILWAY_ENVIRONMENT_NAME ?? "").toLowerCase();
  const allowed = envName !== "production" && (envName === "staging" || env.GENERATION_RENDERER_OVERRIDE_ENABLED === "true");
  if (!allowed) return plan;
  const path = plan.imagePath;
  if (path.kind === "direct-google" && GOOGLE_RENDERERS[requested]) {
    console.log(`[Providers] staging renderer override ${path.renderer.id} -> ${requested} (${plan.assignmentKey})`);
    return { ...plan, imagePath: { ...path, renderer: GOOGLE_RENDERERS[requested] } };
  }
  if (path.kind === "direct-openai" && RENDERERS[requested]) {
    console.log(`[Providers] staging renderer override ${path.renderer.id} -> ${requested} (${plan.assignmentKey})`);
    return { ...plan, imagePath: { ...path, renderer: RENDERERS[requested] } };
  }
  return plan;
}

/**
 * Align the style's native-alpha marker with the plan: storage skips chroma only
 * when the planned render really is transparent. Legacy plans keep the marker.
 */
export function styleGenForPlan<T extends { model: string | null; nativeTransparent: boolean }>(
  styleGen: T,
  plan: GenerationPlan,
): T {
  const path = plan.imagePath;
  if (path === "legacy" || path.kind === "direct-google") return styleGen;
  const transparent = path.background === "transparent";
  return { ...styleGen, nativeTransparent: transparent, model: transparent ? styleGen.model ?? "gpt-image-2" : null };
}

/** Direct renders that already match the print aspect keep their pixels (lossless print master). */
export function planKeepsSourceResolution(plan: GenerationPlan): boolean {
  const path = plan.imagePath;
  if (path === "legacy") return false;
  return path.kind === "direct-google" || (path.kind === "direct-openai" && path.background === "opaque");
}

/** Default renderer, or the escalation renderer when asked (nothing escalates automatically yet). */
export function selectRenderer<P extends DirectOpenAIImagePath | DirectGoogleImagePath>(
  path: P,
  opts: { escalate?: boolean } = {},
): P["renderer"] {
  return opts.escalate && path.escalation ? path.escalation : path.renderer;
}

export type CredentialSource = "db" | "env";
export type DbCredentialLookup = (refId: string) => Promise<string | null>;

async function defaultDbLookup(refId: string): Promise<string | null> {
  if (!process.env.CREDENTIAL_ENCRYPTION_KEY) return null;
  return (await import("./credential-store")).getPlatformCredential(refId);
}

/** Last source each ref resolved from since boot (admin verification only; never the secret). */
export const credentialResolutionLog = new Map<string, { source: CredentialSource; at: Date }>();

/**
 * Reads the secret for exactly this ref: operator-entered platform DB key (active),
 * then the env var. Missing in both → throws; never substitutes another credential.
 */
export async function readCredential(
  ref: CredentialRef,
  env: Record<string, string | undefined> = process.env,
  dbLookup: DbCredentialLookup = defaultDbLookup,
): Promise<string> {
  let value: string | null = null;
  let source: CredentialSource = "db";
  try {
    value = (await dbLookup(ref.id))?.trim() || null;
  } catch (err) {
    console.error(`[Providers] DB credential lookup failed for ${ref.id}; using env:`, (err as Error)?.message);
  }
  if (!value) {
    value = env[ref.credentialKey]?.trim() || null;
    source = "env";
  }
  if (!value) {
    console.error(`[Providers] ${ref.credentialKey} is not set; refusing ${ref.id} generation (no fallback)`);
    throw new ProviderCredentialUnavailableError();
  }
  credentialResolutionLog.set(ref.id, { source, at: new Date() });
  return value;
}

/** Strip a secret (and anything key-shaped) from provider text before it is logged or stored. */
export function redactSecrets(text: string, secret?: string): string {
  let out = secret ? text.split(secret).join("[redacted]") : text;
  out = out.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]").replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]");
  return out;
}
