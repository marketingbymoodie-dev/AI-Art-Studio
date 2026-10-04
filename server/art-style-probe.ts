/**
 * Staging probe: one pinned Petposterous concept through the apparel art styles.
 * Uses the same direct-Flare plan and prompt compression the storefront uses
 * (packLayered, so the long compose is not tail-cut) and native transparency.
 */
import {
  PETPOSTEROUS_ART_STYLE_BATCH,
  composePetposterousArtStylePrompt,
} from "@shared/petposterousArtStyles";
import { resolveModelPrompt, type GenerateImageParams } from "./replit_integrations/image/client";
import { styleExampleRecipe } from "./style-example-batch";

export function composeArtStyleProbe(opts: {
  styleId: string;
  length?: "full" | "short";
  referenceDataUrl: string;
}) {
  const composed = composePetposterousArtStylePrompt({ styleId: opts.styleId, length: opts.length ?? "full" });
  const recipe = styleExampleRecipe("apparel");
  const params: GenerateImageParams = {
    prompt: composed.prompt,
    aspectRatio: PETPOSTEROUS_ART_STYLE_BATCH.aspectRatio,
    inputImageUrl: opts.referenceDataUrl,
    isApparel: true,
    isAllOverPrint: false,
    isPatternStyle: false,
    userPrompt: PETPOSTEROUS_ART_STYLE_BATCH.concept,
    cylindricalWrap: false,
    generationModel: recipe.styleGen.model,
    generationQuality: recipe.styleGen.quality,
    nativeTransparent: true,
    layered: true,
    packLayered: true,
    transparencyCheck: "enforce",
    generationPlan: recipe.plan,
  };
  return {
    composed,
    sentPrompt: resolveModelPrompt(params).sentPrompt,
    params,
    recipe,
    batch: PETPOSTEROUS_ART_STYLE_BATCH,
  };
}
