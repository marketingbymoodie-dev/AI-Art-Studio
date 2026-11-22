/**
 * Staging style-example batches: the six Petposterous LOOKs, one pinned joke.
 *
 * Image prompts go through the same pack compose the storefront uses
 * (packLayersForCompose → composeLayeredPrompt → wrap → resolveModelPrompt).
 * The concept writer runs once per batch with the framework forced, then every
 * look reuses that concept. A caller can pass the recorded concept back in so
 * a second batch composes the same prompts.
 */
import { composeLayeredPrompt, wrapLayeredArtworkPrompt } from "@shared/promptLayers";
import {
  PETPOSTEROUS_CONCEPT_FRAMEWORKS,
  PETPOSTEROUS_VISUAL_SYSTEMS,
  petposterousLook,
  type PetposterousProductFamily,
} from "@shared/petposterousCreative";
import { getStylePackProfile } from "@shared/stylePackProfiles";
import type { StyleInputCapabilities } from "@shared/stylePacks";
import { resolveStyleGenerationForProduct } from "@shared/decorBackgroundFill";
import { resolveModelPrompt, type GenerateImageParams } from "./replit_integrations/image/client";
import { resolveGenerationPlan, selectRenderer, styleGenForPlan, type GenerationPlan } from "./generation-providers";
import { packConceptEngine, packConceptUserMessage, type PackConceptOption } from "./pack-concept-engine";
import { runConceptEngine, type ConceptEngine } from "./concept-engine";
import { packLayersForCompose, type PackGenerationContext } from "./pack-generation";

export const STYLE_EXAMPLE_FAMILIES = ["apparel", "poster", "pillow"] as const;
export type StyleExampleFamily = (typeof STYLE_EXAMPLE_FAMILIES)[number];
export const STYLE_EXAMPLE_DEFAULT_VARIANTS = 3;
export const STYLE_EXAMPLE_MAX_VARIANTS = 4;

/** Storefront defaults when the customer leaves humour and relationship alone. */
const HUMOR_ID = "witty";
const RELATIONSHIP_ID = "its-complicated";
const CAPABILITIES: StyleInputCapabilities = {
  petPhoto: "optional",
  ownerPhoto: "optional",
  humor: { supported: true, default: HUMOR_ID },
  relationship: { supported: true, default: RELATIONSHIP_ID },
};

export type StyleExampleConcept = {
  funnyTruth: string;
  visualJoke: string;
  punchline: string;
  subjectPriority: string;
};

export type StyleExampleRecipe = {
  productFamily: StyleExampleFamily;
  isApparel: boolean;
  aspectRatio: string;
  route: string;
  model: string;
  rendererId: string;
  credentialRef: string;
  imageSize: string | null;
  provider: string;
  plan: GenerationPlan;
  styleGen: ReturnType<typeof resolveStyleGenerationForProduct>;
};

export class StyleExampleInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StyleExampleInputError";
  }
}

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export function parseStyleExampleConcept(raw: unknown): StyleExampleConcept | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const funnyTruth = clip(o.funnyTruth, 400);
  const visualJoke = clip(o.visualJoke, 400);
  const subjectPriority = clip(o.subjectPriority, 400);
  const punchline = clip(o.punchline, 120);
  if (!funnyTruth || !visualJoke || !subjectPriority) return null;
  const profile = getStylePackProfile("petposterous");
  const max = profile?.concept?.punchlineMaxWords;
  if (punchline && max != null && punchline.split(/\s+/).length > max) return null;
  return { funnyTruth, visualJoke, punchline, subjectPriority };
}

export function styleExampleFamilyError(family: string): string | null {
  if (!(STYLE_EXAMPLE_FAMILIES as readonly string[]).includes(family)) {
    return "Choose apparel, poster, or pillow so all six looks stay available.";
  }
  const hidden = PETPOSTEROUS_VISUAL_SYSTEMS.filter((look) => look.compatibility[family as PetposterousProductFamily] === "hidden");
  if (hidden.length) return `${hidden.map((l) => l.label).join(", ")} is not available on ${family}.`;
  return null;
}

/** Portrait chest print, wall-art fallback, or a square pillow. Held for the whole batch. */
export function styleExampleAspect(family: StyleExampleFamily): string {
  if (family === "apparel") return "2:3";
  if (family === "pillow") return "1:1";
  return "3:4";
}

export function styleExampleRecipe(family: StyleExampleFamily): StyleExampleRecipe {
  const isApparel = family === "apparel";
  const legacy = resolveStyleGenerationForProduct(
    {
      generationModel: "openai-flare",
      generationQuality: "medium",
      generationModelDecor: "google-nb2",
      catalogSlug: "pp-owner-vs-pet",
    },
    isApparel ? "apparel" : "poster",
    { isApparel },
  );
  const plan = resolveGenerationPlan({
    packProfileKey: "petposterous",
    productFamily: family,
    isApparel,
    styleRoute: legacy.route,
    nativeTransparent: legacy.nativeTransparent,
  });
  const styleGen = styleGenForPlan(legacy, plan);
  const path = plan.imagePath;
  if (path === "legacy" || path.kind === "replicate") {
    throw new StyleExampleInputError("Petposterous has no direct renderer for this product.");
  }
  const renderer = selectRenderer(path);
  return {
    productFamily: family,
    isApparel,
    aspectRatio: styleExampleAspect(family),
    route: legacy.route ?? path.renderer.id,
    model: renderer.model,
    rendererId: renderer.id,
    credentialRef: path.credential.id,
    imageSize: path.kind === "direct-google" ? path.imageSize : path.renderer.quality,
    provider: path.credential.provider,
    plan,
    styleGen,
  };
}

export function styleExampleGenerationParams(input: {
  behavior: string;
  conceptFramework: string;
  productFamily: StyleExampleFamily;
  visualSystem: string;
  concept: StyleExampleConcept;
  referenceDataUrl: string;
}): GenerateImageParams & { sentPrompt: string; recipe: StyleExampleRecipe } {
  const composed = composeStyleExample(input);
  return {
    ...composed.params,
    sentPrompt: composed.sentPrompt,
    recipe: composed.recipe,
  };
}

export function composeStyleExample(input: {
  behavior: string;
  conceptFramework: string;
  productFamily: StyleExampleFamily;
  visualSystem: string;
  concept: StyleExampleConcept;
  referenceDataUrl?: string;
}): { sentPrompt: string; recipe: StyleExampleRecipe; params: GenerateImageParams } {
  const behavior = clip(input.behavior, 600);
  if (!behavior) throw new StyleExampleInputError("Describe what they do.");
  if (!Object.prototype.hasOwnProperty.call(PETPOSTEROUS_CONCEPT_FRAMEWORKS, input.conceptFramework)) {
    throw new StyleExampleInputError("Choose a concept framework.");
  }
  const familyError = styleExampleFamilyError(input.productFamily);
  if (familyError) throw new StyleExampleInputError(familyError);
  const look = petposterousLook(input.visualSystem);
  if (!look) throw new StyleExampleInputError("Unknown look.");
  const concept = parseStyleExampleConcept(input.concept);
  if (!concept) throw new StyleExampleInputError("Concept is missing a visual joke.");

  const recipe = styleExampleRecipe(input.productFamily);
  const profile = getStylePackProfile("petposterous");
  if (!profile) throw new StyleExampleInputError("Petposterous profile is missing.");
  const ctx: PackGenerationContext = {
    packId: "style-example-batch",
    packSlug: "petposterous-v1",
    profile,
    capabilities: CAPABILITIES,
    humorId: HUMOR_ID,
    relationshipId: RELATIONSHIP_ID,
    concept: concept.visualJoke,
    punchline: concept.punchline,
    wordsMode: "suggest",
    petName: null,
    species: null,
    personalityTraits: [],
    behavior,
    funnyTruth: concept.funnyTruth,
    subjectPriority: concept.subjectPriority,
    conceptIndex: 0,
    conceptFramework: input.conceptFramework,
    visualSystem: look.id,
    productRenderer: input.productFamily,
  };
  const layered = composeLayeredPrompt({
    category: "all",
    isApparelGeneration: recipe.isApparel,
    generationModel: recipe.styleGen.model,
    catalogSlug: input.conceptFramework,
    styleLayer: "",
    subStyleLayer: "",
    userInput: behavior,
    isAllOverPrint: false,
    isPatternStyle: false,
    outputMode: null,
    packLayers: packLayersForCompose(ctx, {
      isApparel: recipe.isApparel,
      colorTier: recipe.isApparel ? "light" : null,
      styleImageCount: 0,
      customerImages: input.referenceDataUrl ? [{ role: "pet", label: null, url: input.referenceDataUrl }] : [],
    }),
  });
  const params: GenerateImageParams = {
    prompt: wrapLayeredArtworkPrompt(layered, ""),
    aspectRatio: recipe.aspectRatio,
    inputImageUrl: input.referenceDataUrl || null,
    isApparel: recipe.isApparel,
    isAllOverPrint: false,
    isPatternStyle: false,
    userPrompt: behavior,
    cylindricalWrap: false,
    generationModel: recipe.styleGen.model,
    generationQuality: recipe.styleGen.quality,
    nativeTransparent: recipe.styleGen.nativeTransparent,
    layered: true,
    packLayered: true,
    transparencyCheck: "enforce",
    generationPlan: recipe.plan,
  };
  return { sentPrompt: resolveModelPrompt(params).sentPrompt, recipe, params };
}

/** Same writer as the storefront, with the framework required on every option. */
export function pinnedPackConceptEngine(
  profile: NonNullable<ReturnType<typeof getStylePackProfile>>,
  frameworkId: string,
): ConceptEngine<PackConceptOption> {
  if (!Object.prototype.hasOwnProperty.call(PETPOSTEROUS_CONCEPT_FRAMEWORKS, frameworkId)) {
    throw new StyleExampleInputError("Choose a concept framework.");
  }
  const base = packConceptEngine(profile);
  if (!base) throw new StyleExampleInputError("This style pack has no concept writer.");
  const description = PETPOSTEROUS_CONCEPT_FRAMEWORKS[frameworkId];
  return {
    ...base,
    id: `${base.id}:pinned:${frameworkId}`,
    system: `${base.system}\n\nPINNED FRAMEWORK: every option's concept_framework MUST be "${frameworkId}" (${description}). Do not choose any other id. The visual LOOK is selected afterward; do not describe an art style.`,
    parse: (raw) => {
      const options = base.parse(raw);
      if (!options || options.some((o) => o.conceptFramework !== frameworkId)) return null;
      return options;
    },
  };
}

export function styleExampleConceptFields(behavior: string): Array<[string, string | null]> {
  const profile = getStylePackProfile("petposterous");
  const humor = profile?.humorOptions.find((o) => o.id === HUMOR_ID)?.label ?? HUMOR_ID;
  const relationship = profile?.relationshipOptions.find((o) => o.id === RELATIONSHIP_ID)?.label ?? RELATIONSHIP_ID;
  return [
    ["behaviour", behavior],
    ["humour", humor],
    ["relationship", relationship],
    ["words mode", "suggest"],
  ];
}

/** One concept for the whole batch. Retries once if the writer ignores the pin. */
export async function generatePinnedStyleConcept(behavior: string, frameworkId: string): Promise<StyleExampleConcept> {
  const profile = getStylePackProfile("petposterous");
  if (!profile) throw new StyleExampleInputError("Petposterous profile is missing.");
  const engine = pinnedPackConceptEngine(profile, frameworkId);
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const options = await runConceptEngine(engine, packConceptUserMessage(styleExampleConceptFields(behavior)));
      const concept = parseStyleExampleConcept(options[0]);
      if (!concept) throw new StyleExampleInputError("Concept writer returned an empty joke.");
      return concept;
    } catch (err) {
      last = err;
      if ((err as { quoteStage?: string })?.quoteStage !== "validation" || attempt === 1) throw err;
    }
  }
  throw last;
}
