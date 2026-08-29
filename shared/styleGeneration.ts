/**
 * Per-style generation model (WP2-NATIVE Phase 1).
 * Null generationModel = current nano-banana + chroma. gpt-image-2 = native transparent PNG.
 */

export const GENERATION_MODEL_GPT_IMAGE_2 = "gpt-image-2";

export type GenerationQuality = "low" | "medium" | "high" | "auto";

/** Operator-confirmed Replicate list prices (USD). auto logged as high. */
export const GPT_IMAGE_2_COST_USD: Record<GenerationQuality, number> = {
  low: 0.01,
  medium: 0.05,
  high: 0.13,
  auto: 0.13,
};

export const TRANSPARENT_SCREENPRINT_INSTRUCTION =
  "Isolated centered graphic on a TRANSPARENT background, for screen printing. " +
  "No scenic plate, no white mat, no rectangular card. Clean edges. " +
  "Do not add text unless the user explicitly requested it.";

export function isGptImage2Model(model?: string | null): boolean {
  const m = (model || "").trim().toLowerCase();
  return m === "gpt-image-2" || m === "openai/gpt-image-2";
}

export function resolveGenerationQuality(raw?: string | null): GenerationQuality {
  const q = (raw || "").trim().toLowerCase();
  if (q === "medium" || q === "high" || q === "auto" || q === "low") return q;
  return "low";
}

export function estimatedGptImage2CostUsd(quality: GenerationQuality): number {
  return GPT_IMAGE_2_COST_USD[quality] ?? GPT_IMAGE_2_COST_USD.low;
}

export function resolveStyleGeneration(style?: {
  generationModel?: string | null;
  generationQuality?: string | null;
} | null): {
  model: typeof GENERATION_MODEL_GPT_IMAGE_2 | null;
  quality: GenerationQuality;
  nativeTransparent: boolean;
} {
  const model = isGptImage2Model(style?.generationModel) ? GENERATION_MODEL_GPT_IMAGE_2 : null;
  return {
    model,
    quality: resolveGenerationQuality(style?.generationQuality),
    nativeTransparent: model === GENERATION_MODEL_GPT_IMAGE_2,
  };
}

/** `undefined` = field omitted (leave existing). */
export function persistGenerationModel(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw == null || raw === "") return null;
  return isGptImage2Model(String(raw)) ? GENERATION_MODEL_GPT_IMAGE_2 : null;
}

/** `undefined` = field omitted (leave existing). */
export function persistVectorizeEnabled(raw: unknown): boolean | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (raw === true || raw === "true") return true;
  if (raw === false || raw === "false") return false;
  return null;
}

/** `undefined` = field omitted (leave existing). */
export function persistGenerationQuality(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw == null || raw === "") return null;
  const q = String(raw).trim().toLowerCase();
  if (q === "low" || q === "medium" || q === "high" || q === "auto") return q;
  return null;
}

/** GPT-Image-2 on Replicate accepts only 1:1, 3:2, 2:3. */
export function mapGptImage2AspectRatio(aspectRatio?: string | null): "1:1" | "3:2" | "2:3" {
  if (!aspectRatio) return "1:1";
  const [wStr, hStr] = aspectRatio.split(":");
  const w = Number(wStr);
  const h = Number(hStr);
  if (!w || !h || Number.isNaN(w) || Number.isNaN(h)) return "1:1";
  const ratio = w / h;
  if (ratio >= 1.2) return "3:2";
  if (ratio <= 0.8) return "2:3";
  return "1:1";
}

const PLATE_PHRASES: RegExp[] = [
  /isolated on a solid hot pink\s*(?:\(#FF00FF\))?\s*background/gi,
  /isolated on solid hot pink\s*(?:\(#FF00FF\))?\s*background/gi,
  /on SOLID HOT PINK\s*(?:\(#FF00FF\))?/gi,
  /SOLID HOT PINK\s*(?:\(#FF00FF\))?/gi,
  /Every pixel that is not part of the (?:design|pattern) must be exactly #FF00FF\.?/gi,
  /Every pixel not part of the (?:design|pattern) must be exactly #FF00FF\.?/gi,
  /#FF00FF is reserved exclusively for the background(?: mat)?\.?/gi,
  /DO NOT use solid hot pink\s*(?:\(#FF00FF\))?\s*or magenta anywhere in the main design[^.]*\.?/gi,
  /DO NOT use solid hot pink\s*(?:\(#FF00FF\))?\s*or magenta in the design\.?/gi,
  /\([^)]*avoid[^)]*hot pink[^)]*\)/gi,
  /the ONLY background color is #FF00FF edge-to-edge\.?/gi,
  /leave #FF00FF around the subject instead\.?/gi,
  /leaving clean #FF00FF space around it\.?/gi,
  /fill entire canvas with #FF00FF outside the subject\.?/gi,
  /background must be pure #FF00FF to all four edges\.?/gi,
  /hot pink\s*\(#FF00FF\)\s*background/gi,
  /solid,?\s*uniform hot pink(?:\s*\(#FF00FF\))?/gi,
  /AVOID hot pink\/magenta(?: colors)?(?: in the design)?\.?/gi,
  /and hot pink\/magenta colors in the design\.?/gi,
  /#FF00FF/gi,
  /\bhot pink background\b/gi,
  /\bhot-pink background\b/gi,
];

export function stripChromaPlateLanguage(text: string): string {
  let out = text;
  for (const pattern of PLATE_PHRASES) {
    out = out.replace(pattern, " ");
  }
  return out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function chromaPlateLeakMatches(prompt: string): string[] {
  const lower = prompt.toLowerCase();
  const matches: string[] = [];
  if (lower.includes("#ff00ff")) matches.push("#FF00FF");
  if (lower.includes("hot pink background")) matches.push("hot pink background");
  if (lower.includes("hot-pink background")) matches.push("hot-pink background");
  if (lower.includes("solid hot pink")) matches.push("solid hot pink");
  return matches;
}

export function composeTransparentPrompt(raw: string): string {
  const stripped = stripChromaPlateLanguage(raw);
  if (/transparent background/i.test(stripped)) return stripped;
  return `${TRANSPARENT_SCREENPRINT_INSTRUCTION} ${stripped}`.trim();
}

export function logComposedPrompt(prompt: string, label: string): void {
  const leaks = chromaPlateLeakMatches(prompt);
  console.log(`[${label}] Composed prompt (${prompt.length} chars):\n${prompt}`);
  if (leaks.length > 0) {
    console.error(`[${label}] CHROMA PLATE LANGUAGE LEAKED:`, leaks);
  } else {
    console.log(`[${label}] Chroma plate language: none (ok)`);
  }
}
