/**
 * Staging probe compose for apparel art styles.
 * The truth and the device are arguments. This does not call the six-look pack composer.
 * renderAnyway is the probe operator override. The customer path must not pass it.
 */
import {
  PETPOSTEROUS_ART_STYLE_BATCH,
  artStyleConceptShotFlags,
  composePetposterousArtStylePrompt,
} from "@shared/petposterousArtStyles";
import { compressPrompt, type GenerateImageParams } from "./replit_integrations/image/client";
import { styleExampleRecipe } from "./style-example-batch";

export { ART_STYLE_PRODUCT_BRIEFS, artStyleTruthFields as artStyleConceptFields } from "./art-style-writers";

export type ArtStyleProbeMode = "pinned" | "full";

export function composeArtStyleProbe(opts: {
  styleId: string;
  length?: "full" | "short";
  referenceDataUrl: string;
  concept: string;
  words: string;
  device: string;
  /** Probe only. A flagged truth renders when the operator asks to see it. */
  renderAnyway?: boolean;
  behaviour?: string;
  mode?: ArtStyleProbeMode;
}) {
  const concept = opts.concept.replace(/\s+/g, " ").trim();
  const flags = artStyleConceptShotFlags(concept);
  if (flags.length && !opts.renderAnyway) {
    throw Object.assign(
      new Error("This truth is a shot. The probe can render it anyway; the customer path cannot."),
      { status: 400, shotFlags: flags },
    );
  }
  const composed = composePetposterousArtStylePrompt({
    styleId: opts.styleId,
    length: opts.length ?? "full",
    concept,
    words: opts.words,
    device: opts.device,
  });
  const recipe = styleExampleRecipe("apparel");
  const params: GenerateImageParams = {
    prompt: composed.prompt,
    aspectRatio: PETPOSTEROUS_ART_STYLE_BATCH.aspectRatio,
    inputImageUrl: opts.referenceDataUrl,
    isApparel: true,
    isAllOverPrint: false,
    isPatternStyle: false,
    userPrompt: concept,
    cylindricalWrap: false,
    generationModel: recipe.styleGen.model,
    generationQuality: recipe.styleGen.quality,
    nativeTransparent: true,
    layered: true,
    packLayered: true,
    transparencyCheck: "enforce",
    generationPlan: recipe.plan,
  };
  const batch = PETPOSTEROUS_ART_STYLE_BATCH;
  const behaviour = (opts.behaviour || batch.behaviour).trim();
  const planPath = params.generationPlan?.imagePath;
  const direct = planPath && planPath !== "legacy" && planPath.kind === "direct-openai" ? planPath : null;
  const nativeTransparent = direct ? direct.background === "transparent" : params.nativeTransparent === true;
  const sentPrompt = compressPrompt(
    params.prompt,
    true,
    false,
    params.userPrompt,
    false,
    params.aspectRatio,
    false,
    nativeTransparent,
    true,
    true,
  );
  return {
    composed,
    sentPrompt,
    params,
    recipe,
    batch,
    mode: opts.mode === "pinned" ? "pinned" as const : "full" as const,
    behaviour,
    concept,
    words: opts.words.replace(/\s+/g, " ").trim(),
    device: opts.device.replace(/\s+/g, " ").trim(),
    shotFlags: flags,
    renderAnyway: opts.renderAnyway === true,
  };
}
