/**
 * Petposterous catalogue concept draws.
 * Same pack compose and generation plan as storefront apparel. Each new draw
 * is a pending candidate. A re-render appends draws on the open candidate.
 * Direct OpenAI only: a missing dedicated key fails, and the plan is refused
 * unless it is the transparent Petposterous OpenAI path.
 */
import { randomUUID } from "crypto";
import { and, eq, like } from "drizzle-orm";
import {
  CATALOGUE_CONCEPT_ASPECTS,
  parseCatalogueConceptGeneration,
  type CatalogueConceptDraw,
  type CatalogueConceptGeneration,
} from "@shared/catalogueConcept";
import { resolveStyleGenerationForProduct } from "@shared/decorBackgroundFill";
import { PETPOSTEROUS_CATALOGUE_SHOP, PETSTAGE_CATALOGUE_SHOP, catalogueShopDomain } from "@shared/operatorCatalogue";
import { PETPOSTEROUS_PACK_SLUG, PETPOSTEROUS_PROFILE_KEY, PETPOSTEROUS_PROMPT_PROFILE, PETPOSTEROUS_STYLES } from "@shared/packs/petposterous";
import { petposterousLook } from "@shared/petposterousCreative";
import { composeLayeredPrompt, wrapLayeredArtworkPrompt } from "@shared/promptLayers";
import { catalogueCandidateChoices, designCandidates, stylePresets } from "@shared/schema";
import { countPunchlineWords } from "@shared/stylePackProfiles";
import { db } from "./db";
import { recordGenerationEvent } from "./generation-events";
import {
  resolveGenerationPlan,
  selectRenderer,
  styleGenForPlan,
  type DirectOpenAIImagePath,
  type GenerationPlan,
} from "./generation-providers";
import { writeLibraryObject } from "./mockup-library-store";
import { packLayersForCompose, type PackGenerationContext } from "./pack-generation";
import { isOwnerShopDomain } from "./platformAdmin";
import { compressPrompt, generateImageBase64 } from "./replit_integrations/image/client";

export type CatalogueConceptInput = {
  concept: string;
  species: string;
  humor: string;
  look: string;
  wordsMode: "none" | "exact";
  exactWords: string;
  garment: "light" | "dark";
  aspect: string;
  draws: number;
};

export type CatalogueConceptCreated = {
  id: string;
  studioPath: string;
  model: string;
  prompt: string;
  estimatedCostUsd: number | null;
  actualCostUsd: number | null;
};

const inflight = new Map<string, Promise<unknown>>();
const finished = new Map<string, { at: number; body: unknown }>();
const shopLock = new Map<string, string>();

function clip(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function catalogueConceptShopAllowed(shop: string | null | undefined): boolean {
  const domain = catalogueShopDomain(shop);
  return isOwnerShopDomain(shop) && (domain === PETPOSTEROUS_CATALOGUE_SHOP || domain === PETSTAGE_CATALOGUE_SHOP);
}

export function parseCatalogueConceptInput(body: unknown): CatalogueConceptInput {
  const row = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const concept = clip(row.concept, 600);
  const species = clip(row.species, 40);
  const humor = clip(row.humor, 40);
  const lookId = clip(row.look, 80);
  const wordsMode = row.wordsMode === "exact" ? "exact" : row.wordsMode === "none" ? "none" : "";
  const exactWords = clip(row.exactWords, 120);
  const garment = row.garment === "dark" ? "dark" : row.garment === "light" ? "light" : "";
  const aspect = clip(row.aspect, 8) || "3:4";
  const draws = Math.round(Number(row.draws));
  if (!concept) throw new Error("Write the concept.");
  if (!species) throw new Error("Write the species.");
  if (!PETPOSTEROUS_PROMPT_PROFILE.humorOptions.some((option) => option.id === humor)) {
    throw new Error("Choose a humour.");
  }
  const look = petposterousLook(lookId);
  if (!look || look.compatibility.apparel === "hidden") throw new Error("Choose a look that works on a shirt.");
  if (wordsMode !== "none" && wordsMode !== "exact") throw new Error("Choose a words mode.");
  if (wordsMode === "exact" && !exactWords) throw new Error("Write the exact words, or choose no text.");
  const maxWords = PETPOSTEROUS_PROMPT_PROFILE.concept?.punchlineMaxWords ?? 6;
  if (wordsMode === "exact" && countPunchlineWords(exactWords) > maxWords) {
    throw new Error(`Keep the words to ${maxWords} or fewer.`);
  }
  if (garment !== "light" && garment !== "dark") throw new Error("Choose a light or dark garment.");
  if (!(CATALOGUE_CONCEPT_ASPECTS as readonly string[]).includes(aspect)) throw new Error("Choose an aspect.");
  if (!Number.isInteger(draws) || draws < 1 || draws > 4) throw new Error("Choose 1 to 4 draws.");
  return { concept, species, humor, look: look.id, wordsMode, exactWords: wordsMode === "exact" ? exactWords : "", garment, aspect, draws };
}

/** Apparel plan for a style generation_model, using the same resolver as the storefront. */
export function catalogueApparelPlan(generationModel: string | null): { plan: GenerationPlan; path: DirectOpenAIImagePath } {
  const seed = PETPOSTEROUS_STYLES[0];
  const legacy = resolveStyleGenerationForProduct(
    {
      generationModel: generationModel ?? seed?.generationModel ?? null,
      generationQuality: seed?.generationQuality ?? "medium",
      catalogSlug: seed?.id ?? null,
    },
    "apparel",
    { isApparel: true },
  );
  const plan = resolveGenerationPlan({
    packProfileKey: PETPOSTEROUS_PROFILE_KEY,
    productFamily: "apparel",
    isApparel: true,
    styleRoute: legacy.route,
    nativeTransparent: legacy.nativeTransparent,
  });
  const path = plan.imagePath;
  if (path === "legacy" || path.kind !== "direct-openai" || path.background !== "transparent") {
    throw new Error("Petposterous apparel is not on a direct transparent OpenAI path.");
  }
  if (path.credential.id !== "openai:petposterous") {
    throw new Error("Petposterous apparel is not on the dedicated OpenAI credential.");
  }
  return { plan, path };
}

/** Majority generation_model on live pack-only Petposterous styles, else the seed. */
export async function liveApparelGenerationModel(): Promise<string | null> {
  const seed = PETPOSTEROUS_STYLES[0]?.generationModel ?? null;
  try {
    const rows = await db
      .select({ model: stylePresets.generationModel })
      .from(stylePresets)
      .where(and(eq(stylePresets.visibility, "pack_only"), like(stylePresets.catalogSlug, "pp-%")))
      .limit(40);
    const counts = new Map<string, number>();
    for (const row of rows) {
      const model = String(row.model || "").trim();
      if (!model) continue;
      counts.set(model, (counts.get(model) || 0) + 1);
    }
    const winner = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return winner?.[0] || seed;
  } catch (err) {
    console.warn("[catalogue-concept] style model lookup failed:", (err as Error).message);
    return seed;
  }
}

export function assembleCatalogueConceptPrompt(input: CatalogueConceptInput, generationModel: string | null): {
  prompt: string;
  wrapped: string;
  model: string;
  plan: GenerationPlan;
  path: DirectOpenAIImagePath;
} {
  const { plan, path } = catalogueApparelPlan(generationModel);
  const aligned = styleGenForPlan(
    resolveStyleGenerationForProduct(
      { generationModel, generationQuality: "medium", catalogSlug: PETPOSTEROUS_STYLES[0]?.id ?? null },
      "apparel",
      { isApparel: true },
    ),
    plan,
  );
  const ctx: PackGenerationContext = {
    packId: "catalogue-concept",
    packSlug: PETPOSTEROUS_PACK_SLUG,
    profile: PETPOSTEROUS_PROMPT_PROFILE,
    capabilities: {
      petPhoto: "unsupported",
      ownerPhoto: "unsupported",
      humor: { supported: true, default: null },
      relationship: { supported: false, default: null },
    },
    humorId: input.humor,
    relationshipId: null,
    concept: input.concept,
    punchline: input.wordsMode === "exact" ? input.exactWords : "",
    wordsMode: input.wordsMode,
    petName: null,
    species: input.species,
    personalityTraits: [],
    behavior: null,
    funnyTruth: null,
    subjectPriority: null,
    conceptIndex: null,
    conceptFramework: "",
    visualSystem: input.look,
    productRenderer: "apparel",
  };
  const wrapped = wrapLayeredArtworkPrompt(
    composeLayeredPrompt({
    category: "apparel",
    isApparelGeneration: true,
    generationModel: aligned.model,
    catalogSlug: null,
    styleLayer: "",
    subStyleLayer: "",
    userInput: "",
    isAllOverPrint: false,
    outputMode: "floating",
    packLayers: packLayersForCompose(ctx, {
      isApparel: true,
      colorTier: input.garment,
      styleImageCount: 0,
      customerImages: [],
    }),
  }),
    "",
  );
  const prompt = compressPrompt(
    wrapped,
    true,
    false,
    null,
    false,
    input.aspect,
    false,
    true,
    true,
    true,
  );
  return { prompt, wrapped, model: selectRenderer(path).model, plan, path };
}

function textEstimateUsd(prompt: string, path: DirectOpenAIImagePath): number {
  const tokens = Math.max(1, Math.ceil(prompt.length / 4));
  const usd = (tokens * path.renderer.pricing.textInPerM) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

function remember(requestId: string, body: unknown) {
  finished.set(requestId, { at: Date.now(), body });
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [key, row] of finished) {
    if (row.at < cutoff) finished.delete(key);
  }
}

async function once<T>(requestId: string, shop: string, run: () => Promise<T>): Promise<T> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new Error("The request id is not valid.");
  }
  const done = finished.get(requestId);
  if (done) return done.body as T;
  const pending = inflight.get(requestId);
  if (pending) return pending as Promise<T>;
  const held = shopLock.get(shop);
  if (held && held !== requestId) throw new Error("A design is already generating. Wait for it to finish.");
  shopLock.set(shop, requestId);
  const job = run()
    .then((body) => {
      remember(requestId, body);
      return body;
    })
    .finally(() => {
      inflight.delete(requestId);
      if (shopLock.get(shop) === requestId) shopLock.delete(shop);
    });
  inflight.set(requestId, job);
  return job;
}

async function renderOne(
  shop: string,
  input: CatalogueConceptInput,
  generationModel: string | null,
): Promise<{ draw: CatalogueConceptDraw; model: string; plan: GenerationPlan }> {
  const assembled = assembleCatalogueConceptPrompt(input, generationModel);
  const started = Date.now();
  let result: Awaited<ReturnType<typeof generateImageBase64>>;
  try {
    result = await generateImageBase64({
      prompt: assembled.wrapped,
      aspectRatio: input.aspect,
      isApparel: true,
      generationModel: styleGenForPlan(
        resolveStyleGenerationForProduct({ generationModel, generationQuality: "medium" }, "apparel", { isApparel: true }),
        assembled.plan,
      ).model,
      generationQuality: "medium",
      nativeTransparent: true,
      layered: true,
      packLayered: true,
      transparencyCheck: "enforce",
      generationPlan: assembled.plan,
    });
  } catch (err) {
    void recordGenerationEvent(
      {
        kind: "image",
        route: "catalogue-concept",
        shopDomain: shop,
        experienceProfile: PETPOSTEROUS_PROFILE_KEY,
        stylePack: PETPOSTEROUS_PACK_SLUG,
        productFamily: "apparel",
        visualSystem: input.look,
        plan: assembled.plan,
      },
      { success: false, durationMs: Date.now() - started, error: err },
    );
    throw err;
  }
  if (!result.data) throw new Error("The model returned no image.");
  if (result.meta?.provider !== "openai" || result.meta.model !== assembled.model) {
    throw new Error("The draw did not stay on the Petposterous OpenAI model.");
  }
  const png = Buffer.from(result.data, "base64");
  if (png.length < 8 || png[0] !== 0x89 || png[1] !== 0x50) throw new Error("The model did not return a PNG.");
  const id = randomUUID();
  const artworkPath = `catalogue-concept/${id}.png`;
  await writeLibraryObject(artworkPath, png, "image/png");
  const actual = result.meta.estimatedCostUsd;
  const draw: CatalogueConceptDraw = {
    id,
    artworkPath,
    prompt: assembled.prompt,
    model: assembled.model,
    estimatedCostUsd: textEstimateUsd(assembled.prompt, assembled.path),
    actualCostUsd: actual,
    createdAt: new Date().toISOString(),
  };
  return { draw, model: assembled.model, plan: assembled.plan };
}

async function recordDrawSpend(shop: string, candidateId: string, draw: CatalogueConceptDraw, plan: GenerationPlan, durationMs: number) {
  const billed = draw.actualCostUsd != null;
  await recordGenerationEvent(
    {
      kind: "image",
      route: "catalogue-concept",
      jobId: candidateId,
      shopDomain: shop,
      experienceProfile: PETPOSTEROUS_PROFILE_KEY,
      stylePack: PETPOSTEROUS_PACK_SLUG,
      productFamily: "apparel",
      plan,
    },
    {
      success: true,
      durationMs,
      meta: {
        provider: "openai",
        credentialRefId: "openai:petposterous",
        credentialScope: "dedicated",
        model: draw.model,
        quality: "medium",
        size: billed ? "billed" : "estimated",
        attempts: 1,
        durationMs,
        transparent: true,
        transparentFraction: null,
        usage: null,
        estimatedCostUsd: billed ? draw.actualCostUsd : draw.estimatedCostUsd,
        providerRequestId: null,
        providerMime: "image/png",
      },
    },
  );
}

function generationFrom(input: CatalogueConceptInput, draw: CatalogueConceptDraw): CatalogueConceptGeneration {
  return {
    concept: input.concept,
    species: input.species,
    humor: input.humor,
    look: input.look,
    wordsMode: input.wordsMode,
    exactWords: input.exactWords,
    garment: input.garment,
    aspect: input.aspect,
    draws: [draw],
  };
}

export async function createCatalogueConcepts(args: {
  shop: string | null | undefined;
  requestId: string;
  body: unknown;
}): Promise<{ created: CatalogueConceptCreated[]; model: string; studioPath: string; error: string }> {
  if (process.env.RAILWAY_ENVIRONMENT_NAME === "production") {
    throw new Error("Catalogue concept generation is staging only.");
  }
  if (!catalogueConceptShopAllowed(args.shop)) throw new Error("Concept generation is only available on Petposterous.");
  const shop = catalogueShopDomain(args.shop);
  const input = parseCatalogueConceptInput(args.body);
  return once(args.requestId, shop, async () => {
    const generationModel = await liveApparelGenerationModel();
    const { model } = catalogueApparelPlan(generationModel);
    const created: CatalogueConceptCreated[] = [];
    let error = "";
    for (let index = 0; index < input.draws; index++) {
      const started = Date.now();
      try {
        const rendered = await renderOne(shop, input, generationModel);
        const id = randomUUID();
        const now = new Date();
        const generation = generationFrom(input, rendered.draw);
        await db.transaction(async (tx) => {
          await tx.insert(designCandidates).values({
            id,
            shopDomain: shop,
            status: "pending",
            source: "generated",
            humourOperator: "",
            darknessLevel: 0,
            species: input.species,
            deviceStructure: "",
            deviceText: "",
            funnyTruth: "",
            punchline: input.exactWords,
            artStyle: "",
            behaviour: "",
            productFamily: "apparel",
            credentialRef: "openai:petposterous",
            artworkPath: rendered.draw.artworkPath,
            generation,
            updatedAt: now,
            createdAt: now,
          });
          await tx.insert(catalogueCandidateChoices).values({
            candidateId: id,
            artworkPath: rendered.draw.artworkPath,
            selectedColors: [],
            updatedAt: now,
          });
        });
        await recordDrawSpend(shop, id, rendered.draw, rendered.plan, Date.now() - started);
        created.push({
          id,
          studioPath: `/admin/catalogue-studio?candidate=${id}`,
          model: rendered.model,
          prompt: rendered.draw.prompt,
          estimatedCostUsd: rendered.draw.estimatedCostUsd,
          actualCostUsd: rendered.draw.actualCostUsd,
        });
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        break;
      }
    }
    if (!created.length) throw new Error(error || "No draw was stored.");
    return {
      created,
      model,
      studioPath: created[created.length - 1]?.studioPath || "",
      error,
    };
  });
}

export async function redrawCatalogueConcept(args: {
  shop: string | null | undefined;
  requestId: string;
  candidateId: string;
  body: unknown;
}): Promise<{ draws: CatalogueConceptDraw[]; model: string; error: string }> {
  if (process.env.RAILWAY_ENVIRONMENT_NAME === "production") {
    throw new Error("Catalogue concept generation is staging only.");
  }
  if (!catalogueConceptShopAllowed(args.shop)) throw new Error("Concept generation is only available on Petposterous.");
  const shop = catalogueShopDomain(args.shop);
  return once(args.requestId, shop, async () => {
    const [row] = await db.select().from(designCandidates).where(eq(designCandidates.id, args.candidateId)).limit(1);
    if (!row || row.shopDomain !== shop) throw new Error("That candidate is not stored.");
    const saved = parseCatalogueConceptGeneration(row.generation);
    if (!saved) throw new Error("This candidate has no saved concept.");
    const body = (args.body && typeof args.body === "object" ? args.body : {}) as Record<string, unknown>;
    const input = parseCatalogueConceptInput({
      concept: body.concept ?? saved.concept,
      species: body.species ?? saved.species,
      humor: body.humor ?? saved.humor,
      look: body.look ?? saved.look,
      wordsMode: body.wordsMode ?? saved.wordsMode,
      exactWords: body.exactWords ?? saved.exactWords,
      garment: saved.garment,
      aspect: saved.aspect,
      draws: body.draws ?? 1,
    });
    const generationModel = await liveApparelGenerationModel();
    const { model } = catalogueApparelPlan(generationModel);
    const added: CatalogueConceptDraw[] = [];
    let error = "";
    for (let index = 0; index < input.draws; index++) {
      const started = Date.now();
      try {
        const rendered = await renderOne(shop, input, generationModel);
        added.push(rendered.draw);
        const next = parseCatalogueConceptGeneration(row.generation) || saved;
        next.concept = input.concept;
        next.species = input.species;
        next.humor = input.humor;
        next.look = input.look;
        next.wordsMode = input.wordsMode;
        next.exactWords = input.exactWords;
        next.draws = [...next.draws, rendered.draw];
        row.generation = next;
        await db
          .update(designCandidates)
          .set({
            generation: next,
            species: input.species,
            punchline: input.exactWords,
            updatedAt: new Date(),
          })
          .where(and(eq(designCandidates.id, row.id), eq(designCandidates.shopDomain, shop)));
        await recordDrawSpend(shop, row.id, rendered.draw, rendered.plan, Date.now() - started);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        break;
      }
    }
    if (!added.length) throw new Error(error || "No draw was stored.");
    return { draws: parseCatalogueConceptGeneration(row.generation)?.draws || added, model, error };
  });
}

export function catalogueConceptOptions(generationModel: string | null) {
  const { path } = catalogueApparelPlan(generationModel);
  const renderer = selectRenderer(path);
  return {
    enabled: true,
    model: renderer.model,
    rendererId: renderer.id,
    credential: path.credential.id,
    escalationModel: path.escalation?.model ?? null,
    humors: PETPOSTEROUS_PROMPT_PROFILE.humorOptions.map((option) => ({ id: option.id, label: option.label })),
    looks: ["editorial-deadpan", "academic-institutional", "vintage-print", "illustrated-character", "fine-art", "cinematic-domestic"]
      .map((id) => petposterousLook(id))
      .filter((look): look is NonNullable<typeof look> => !!look && look.compatibility.apparel !== "hidden")
      .map((look) => ({ id: look.id, label: look.label })),
    aspects: [...CATALOGUE_CONCEPT_ASPECTS],
  };
}
