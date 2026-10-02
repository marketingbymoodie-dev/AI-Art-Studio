/**
 * Per-style generation routes (style_presets.generation_model / generation_model_decor).
 *
 * A route is a (provider, model) pair the operator picks per style. NULL = legacy
 * default (Replicate Nano Banana + chroma). Labels name the route so the two Flare
 * and two NB2 sources are distinguishable. Model ids live in server code;
 * this file only carries ids + labels.
 *
 * Transparency is NOT a property of the route: transparent-capable routes render
 * native alpha on apparel / floating styles and opaque full-bleed art on decor.
 */

export type GenerationRouteId = "openai-flare" | "replicate-flare" | "google-nb2" | "replicate-nb2" | "google-nb-pro";

export type GenerationRouteOption = {
  id: GenerationRouteId;
  label: string;
  hint: string;
  provider: "openai" | "google" | "replicate";
  /** Can return native transparent PNG (used for apparel / floating styles). */
  transparentCapable: boolean;
  /** False until a staging generation has confirmed the route's output. */
  verified: boolean;
};

export const GENERATION_ROUTES: GenerationRouteOption[] = [
  {
    id: "openai-flare",
    label: "Flare (OpenAI direct)",
    hint: "Floating / transparent on apparel and floating styles; full-bleed on decor.",
    provider: "openai",
    transparentCapable: true,
    verified: true,
  },
  {
    id: "replicate-flare",
    label: "Flare (Replicate)",
    hint: "Replicate proxy to Flare. Transparency unverified.",
    provider: "replicate",
    transparentCapable: true,
    verified: false,
  },
  {
    id: "google-nb2",
    label: "NB2 (Google direct)",
    hint: "Full-bleed decor.",
    provider: "google",
    transparentCapable: false,
    verified: true,
  },
  {
    id: "replicate-nb2",
    label: "NB2 (Replicate)",
    hint: "Full-bleed decor via Replicate.",
    provider: "replicate",
    transparentCapable: false,
    verified: false,
  },
  {
    id: "google-nb-pro",
    label: "NB Pro (Google direct)",
    hint: "Premium full-bleed decor.",
    provider: "google",
    transparentCapable: false,
    verified: true,
  },
];

export const LEGACY_DEFAULT_ROUTE_LABEL = "Legacy default — Nano Banana (Replicate) + chroma";

const ROUTE_IDS = new Set<string>(GENERATION_ROUTES.map((r) => r.id));

/** Stored value → route id. Legacy gpt-image-2 markers map to Flare (OpenAI direct); anything else = legacy default. */
export function normalizeGenerationRoute(raw?: string | null): GenerationRouteId | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (ROUTE_IDS.has(v)) return v as GenerationRouteId;
  if (v === "gpt-image-2" || v === "openai/gpt-image-2") return "openai-flare";
  return null;
}

export function generationRouteOption(id?: string | null): GenerationRouteOption | null {
  const route = normalizeGenerationRoute(id);
  return route ? GENERATION_ROUTES.find((r) => r.id === route) ?? null : null;
}

export function isTransparentCapableRoute(id?: string | null): boolean {
  return generationRouteOption(id)?.transparentCapable === true;
}
