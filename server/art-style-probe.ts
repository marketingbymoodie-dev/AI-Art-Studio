/**
 * Staging probe: apparel art styles.
 * pinned — one fixed concept and punchline, so style is the only variable.
 * full — the storefront concept writer turns a behaviour into three ideas;
 *         the caller picks one and that idea is what gets rendered.
 * Uses the same direct-Flare plan and prompt compression the storefront uses
 * (packLayered, so the long compose is not tail-cut) and native transparency.
 */
import {
  PETPOSTEROUS_ART_STYLE_BATCH,
  composePetposterousArtStylePrompt,
} from "@shared/petposterousArtStyles";
import { getStylePackProfile } from "@shared/stylePackProfiles";
import { compressPrompt, type GenerateImageParams } from "./replit_integrations/image/client";
import { generatePackConceptOptions, type PackConceptOption } from "./pack-concept-engine";
import { styleExampleRecipe } from "./style-example-batch";

export type ArtStyleProbeMode = "pinned" | "full";

/** Same fields the storefront concept writer returns. Full mode renders one of these. */
export type ArtStyleProbeIdea = PackConceptOption;

/**
 * Full flow uses the storefront concept writer: behaviour in, three ideas out.
 * Humour, relationship and exact words are not sent — the writer invents the punchline.
 */
export async function generateArtStyleIdeas(behaviour: string): Promise<PackConceptOption[]> {
  const sentence = behaviour.replace(/\s+/g, " ").trim().slice(0, 400);
  if (!sentence) throw Object.assign(new Error("A behaviour sentence is required"), { status: 400 });
  const profile = getStylePackProfile("petposterous");
  if (!profile) throw new Error("Petposterous has no concept writer");
  return generatePackConceptOptions(profile, [["behaviour", sentence]]);
}

export function parseArtStyleProbeIdea(raw: unknown): ArtStyleProbeIdea | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const funnyTruth = String(o.funnyTruth || "").replace(/\s+/g, " ").trim().slice(0, 400);
  const visualJoke = String(o.visualJoke || "").replace(/\s+/g, " ").trim().slice(0, 400);
  const punchline = String(o.punchline || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const subjectPriority = String(o.subjectPriority || "").replace(/\s+/g, " ").trim().slice(0, 400);
  const conceptFramework = String(o.conceptFramework || "").trim().slice(0, 80);
  if (!funnyTruth || !visualJoke || !subjectPriority) return null;
  return {
    funnyTruth,
    visualJoke,
    punchline,
    subjectPriority,
    ...(conceptFramework ? { conceptFramework } : {}),
  };
}

export function composeArtStyleProbe(opts: {
  styleId: string;
  length?: "full" | "short";
  referenceDataUrl: string;
  mode?: ArtStyleProbeMode;
  idea?: ArtStyleProbeIdea | null;
  behaviour?: string;
}) {
  const mode: ArtStyleProbeMode = opts.mode === "full" ? "full" : "pinned";
  const idea = mode === "full" ? opts.idea : null;
  if (mode === "full") {
    const joke = String(idea?.visualJoke || "").trim();
    if (!joke) throw Object.assign(new Error("Full flow needs a selected idea"), { status: 400 });
  }
  const composed = composePetposterousArtStylePrompt({
    styleId: opts.styleId,
    length: opts.length ?? "full",
    ...(mode === "full" && idea
      ? { concept: idea.visualJoke, words: idea.punchline || "" }
      : {}),
  });
  const recipe = styleExampleRecipe("apparel");
  const params: GenerateImageParams = {
    prompt: composed.prompt,
    aspectRatio: PETPOSTEROUS_ART_STYLE_BATCH.aspectRatio,
    inputImageUrl: opts.referenceDataUrl,
    isApparel: true,
    isAllOverPrint: false,
    isPatternStyle: false,
    userPrompt: mode === "full" && idea ? idea.visualJoke : PETPOSTEROUS_ART_STYLE_BATCH.concept,
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
    mode,
    behaviour,
    idea: idea ?? null,
  };
}
