/**
 * Shopify title and description, written at approval.
 * The picture, the truth, and any lettering decide what the design is.
 * The humour operator is only the voice.
 * Promote reads the stored strings and does not write new copy.
 */
import { and, eq } from "drizzle-orm";
import { catalogueDraftCostUsd } from "@shared/catalogueBulkImport";
import { catalogueTruthIsSentence, parseCatalogueListing, type CatalogueListing } from "@shared/catalogueListing";
import { PETPOSTEROUS_CONCEPT_FRAMEWORKS } from "@shared/petposterousCreative";
import { generationEvents } from "@shared/schema";
import { catalogueVisionImage } from "./catalogue-draft";
import { runConceptEngine, takeConceptEngineUsage } from "./concept-engine";
import { db } from "./db";

export type { CatalogueListing };
export { catalogueTruthIsSentence, parseCatalogueListing };

const LISTING_TIMEOUT_MS = 45_000;

export async function catalogueListingIsFresh(candidateId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: generationEvents.id })
    .from(generationEvents)
    .where(and(
      eq(generationEvents.jobId, candidateId),
      eq(generationEvents.route, "catalogue-listing"),
      eq(generationEvents.success, true),
    ))
    .limit(1);
  return Boolean(row);
}

export async function rememberCatalogueListingSpend(
  candidateId: string,
  shop: string,
  success: boolean,
  durationMs: number,
) {
  const usage = takeConceptEngineUsage();
  if (!usage) return;
  const costUsd = catalogueDraftCostUsd(usage.usage, usage.model);
  if (!(costUsd && costUsd > 0)) return;
  try {
    await db.insert(generationEvents).values({
      kind: "concepts",
      route: "catalogue-listing",
      jobId: candidateId,
      shopDomain: shop,
      provider: "anthropic",
      model: usage.model,
      size: "billed",
      attempts: 1,
      durationMs: Math.round(durationMs),
      estimatedCostUsd: costUsd.toFixed(6),
      success,
    });
  } catch (err) {
    console.warn("[catalogue-listing] spend was not recorded:", (err as Error).message);
  }
}

export async function writeCatalogueListing(input: {
  /** Lettering on the design. When this is set, the title stays this text. */
  title: string;
  species: string;
  artStyle: string;
  humourOperator: string;
  punchline: string;
  funnyTruth: string;
  deviceText: string;
  artwork: Buffer;
}): Promise<CatalogueListing> {
  const lettering = (input.punchline || input.title).replace(/\s+/g, " ").trim();
  const truth = input.funnyTruth.replace(/\s+/g, " ").trim();
  const truthAnchors = catalogueTruthIsSentence(truth);
  const device = input.deviceText.replace(/\s+/g, " ").trim();
  const framework = PETPOSTEROUS_CONCEPT_FRAMEWORKS[input.humourOperator] || input.humourOperator;
  const image = await catalogueVisionImage(input.artwork);
  const mediaType = image[0] === 0xff && image[1] === 0xd8 ? "image/jpeg" : "image/png";
  const lines = [
    `Species: ${input.species}`,
    `Style: ${input.artStyle}`,
    `Voice: ${framework}`,
    truthAnchors
      ? `Truth: ${truth}`
      : "Truth: missing. The picture shows what the design is. Do not invent a different scene from the voice.",
    lettering ? `Lettering: ${lettering}` : "Lettering: none.",
    device ? `Device: ${device}` : "Device: none.",
    lettering
      ? "The title is the lettering, unchanged."
      : "Write a short title for what the picture shows.",
  ];
  let listing: CatalogueListing;
  try {
    [listing] = await runConceptEngine<CatalogueListing>(
      {
        id: "catalogue-listing",
        logTag: "[catalogue-listing]",
        noun: "Listing writer",
        maxTokens: 400,
        system: [
          "You write the Shopify title and description for one Petposterous shirt.",
          "The picture is the design. Truth, when it is a sentence, is what that design is.",
          "The title names that scene. Do not substitute a different joke for the species.",
          "Lettering on the design is the title, unchanged, when it is supplied.",
          "The voice is how the description sounds. It is not a different joke and not a different scene.",
          "The description is two sentences a customer reads on the product page.",
          "No price, no sizes, no colour list, no hashtags.",
          'Return ONLY JSON: {"title": string, "description": string}',
        ].join(" "),
        parse: (raw) => parseCatalogueListing(raw, lettering),
      },
      [
        { type: "image", source: { type: "base64", media_type: mediaType, data: image.toString("base64") } },
        { type: "text", text: lines.join("\n") },
      ],
      LISTING_TIMEOUT_MS,
    );
  } catch (err) {
    const extra = err as { quoteDetail?: string; anthropicMessage?: string; message?: string };
    const detail = extra.quoteDetail || extra.anthropicMessage || extra.message || "unavailable";
    throw new Error(`Listing writer failed: ${detail}`);
  }
  return listing;
}
