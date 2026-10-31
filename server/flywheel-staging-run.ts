/**
 * One staging run of the Bed Etiquette print file, then the draft promote.
 * Staging only. A successful print is not repeated. Promote runs once.
 */
import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { designCandidates, generationEvents, productTypes } from "@shared/schema";
import { db } from "./db";
import { recordGenerationEvent } from "./generation-events";
import type { GenerationMeta } from "./replit_integrations/image/client";
import { buildFlywheelPrintFile, placedArtworkBounds, printCanvasFromStoredPlaceholders } from "./flywheel-print-file";
import { lastRecraftCallBilling } from "./replicate-vectorizer";
import { readChoice, readLibraryObject, softstyleType, writeLibraryObject } from "./mockup-library-store";

const CANDIDATE_ID = "pending-bed-etiquette";

function stagingProcess(): boolean {
  return process.env.NODE_ENV === "production"
    && String(process.env.RAILWAY_ENVIRONMENT_NAME || "").toLowerCase() === "staging";
}

function meta(partial: Partial<GenerationMeta> & { size: string; estimatedCostUsd: number | null; providerRequestId: string | null }): GenerationMeta {
  return {
    provider: "replicate",
    credentialRefId: "replicate:shared",
    credentialScope: "shared",
    model: partial.model || "recraft-ai/recraft-vectorize",
    quality: null,
    size: partial.size,
    attempts: 1,
    durationMs: partial.durationMs || 0,
    transparent: null,
    transparentFraction: null,
    usage: null,
    estimatedCostUsd: partial.estimatedCostUsd,
    providerRequestId: partial.providerRequestId,
    providerMime: partial.providerMime || null,
  };
}

export async function runBedEtiquettePrint(): Promise<Record<string, unknown>> {
  const started = Date.now();
  const [done] = await db
    .select({ size: generationEvents.size, estimatedCostUsd: generationEvents.estimatedCostUsd, providerRequestId: generationEvents.providerRequestId })
    .from(generationEvents)
    .where(and(eq(generationEvents.route, "flywheel-print-file"), eq(generationEvents.jobId, CANDIDATE_ID), eq(generationEvents.success, true)))
    .limit(1);
  if (done) {
    return { already: true, size: done.size, costUsd: done.estimatedCostUsd, predictionId: done.providerRequestId };
  }
  try {
    const garment = await softstyleType();
    const [typeRow] = await db
      .select({ placeholderPositions: productTypes.placeholderPositions })
      .from(productTypes)
      .where(eq(productTypes.id, garment.id))
      .limit(1);
    const canvas = printCanvasFromStoredPlaceholders(typeRow?.placeholderPositions, garment.name);
    const choice = await readChoice(CANDIDATE_ID);
    if (!choice.artworkPath) throw new Error("Candidate artwork is not stored");
    const source = await readLibraryObject(choice.artworkPath);
    const sourceMeta = await sharp(source).metadata();
    const [candidate] = await db
      .select({ artStyle: designCandidates.artStyle })
      .from(designCandidates)
      .where(eq(designCandidates.id, CANDIDATE_ID))
      .limit(1);
    const styleId = candidate?.artStyle || "woodcut";
    const print = await buildFlywheelPrintFile(styleId, source, canvas);
    const fitted = await placedArtworkBounds(print.buffer);
    const billing = lastRecraftCallBilling();
    const printFilePath = `print-files/${CANDIDATE_ID}-${styleId}.png`;
    const sourceSize = { width: sourceMeta.width ?? 0, height: sourceMeta.height ?? 0 };
    const size = `canvas ${canvas.width}x${canvas.height}; source ${sourceSize.width}x${sourceSize.height}; fitted ${fitted.width}x${fitted.height}; cost ${billing?.costUsd ?? "unknown"} ${billing?.costSource ?? ""}`.trim();
    await recordGenerationEvent(
      { kind: "image", route: "flywheel-print-file", jobId: CANDIDATE_ID, styleSlug: styleId, legacyModel: "recraft-ai/recraft-vectorize" },
      {
        success: true,
        durationMs: Date.now() - started,
        meta: meta({
          size,
          durationMs: Date.now() - started,
          estimatedCostUsd: billing?.costUsd ?? null,
          providerRequestId: billing?.predictionId ?? null,
          providerMime: "image/svg+xml",
        }),
      },
    );
    await writeLibraryObject(printFilePath, print.buffer, "image/png");
    if (candidate) {
      await db.update(designCandidates).set({ printFilePath, updatedAt: new Date() }).where(eq(designCandidates.id, CANDIDATE_ID));
    }
    return {
      candidateId: CANDIDATE_ID,
      styleId,
      credentialRef: "replicate:shared",
      canvas,
      source: sourceSize,
      fitted,
      costUsd: billing?.costUsd ?? null,
      costSource: billing?.costSource ?? null,
      predictionId: billing?.predictionId ?? null,
      predictTimeSec: billing?.predictTimeSec ?? null,
      printFilePath,
      candidateRow: !!candidate,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const [ok] = await db
      .select({ id: generationEvents.id })
      .from(generationEvents)
      .where(and(eq(generationEvents.route, "flywheel-print-file"), eq(generationEvents.jobId, CANDIDATE_ID), eq(generationEvents.success, true)))
      .limit(1);
    if (ok) throw err;
    await recordGenerationEvent(
      { kind: "image", route: "flywheel-print-file", jobId: CANDIDATE_ID, legacyModel: "recraft-ai/recraft-vectorize" },
      {
        success: false,
        durationMs: Date.now() - started,
        error: err,
        meta: meta({ size: message.slice(0, 500), durationMs: Date.now() - started, estimatedCostUsd: null, providerRequestId: null }),
      },
    );
    throw err;
  }
}

export async function runBedEtiquettePromote(): Promise<Record<string, unknown>> {
  const started = Date.now();
  const [done] = await db
    .select({ size: generationEvents.size, success: generationEvents.success })
    .from(generationEvents)
    .where(and(
      eq(generationEvents.route, "flywheel-promote"),
      eq(generationEvents.jobId, CANDIDATE_ID),
      eq(generationEvents.success, true),
    ))
    .limit(1);
  if (done) return { already: true, success: done.success, size: done.size };
  try {
    const { promoteCatalogueCandidate } = await import("./flywheel-promote");
    const { shippingPricesBySize } = await import("./routes/catalogue-studio");
    const garment = await softstyleType();
    const prices = await shippingPricesBySize();
    const result = await promoteCatalogueCandidate({
      candidateId: CANDIDATE_ID,
      publishNow: false,
      productTypeId: garment.id,
      pricesBySize: prices.pricesBySize,
    });
    const size = `shopify ${result.shopifyProductId}; printify ${result.printifyProductId}; status ${result.status}${result.swatchWarning ? `; swatches: ${result.swatchWarning}` : ""}`;
    await recordGenerationEvent(
      { kind: "image", route: "flywheel-promote", jobId: CANDIDATE_ID },
      { success: true, durationMs: Date.now() - started, meta: meta({ size, durationMs: Date.now() - started, estimatedCostUsd: null, providerRequestId: result.printifyProductId, model: "promote" }) },
    );
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordGenerationEvent(
      { kind: "image", route: "flywheel-promote", jobId: CANDIDATE_ID },
      {
        success: false,
        durationMs: Date.now() - started,
        error: err,
        meta: meta({ size: message.slice(0, 1500), durationMs: Date.now() - started, estimatedCostUsd: null, providerRequestId: null, model: "promote" }),
      },
    );
    throw err;
  }
}

/** The artwork is a dog across the bed. Style is the woodcut that was vectorized. */
async function approveBedEtiquette(): Promise<void> {
  const [row] = await db
    .select({
      title: designCandidates.title,
      description: designCandidates.description,
      printFilePath: designCandidates.printFilePath,
      artStyle: designCandidates.artStyle,
      species: designCandidates.species,
      humourOperator: designCandidates.humourOperator,
    })
    .from(designCandidates)
    .where(eq(designCandidates.id, CANDIDATE_ID))
    .limit(1);
  const choice = await readChoice(CANDIDATE_ID);
  const complete = !!row?.title && !!row.description && !!row.printFilePath && !!row.artStyle && !!row.species && !!row.humourOperator
    && choice.selectedColors.length > 0
    && choice.selectedColors.every((color) => choice.mockupImages.some((image) => image.name.toLowerCase() === color.name.toLowerCase()));
  if (complete) return;
  const { approveCatalogueCandidate } = await import("./flywheel-approve");
  const approved = await approveCatalogueCandidate({
    candidateId: CANDIDATE_ID,
    panelId: String(choice.panelId || ""),
    selectedColors: choice.selectedColors,
    artStyle: "woodcut",
    species: "dog",
    humourOperator: "pp-sleep-warfare",
    punchline: "Bed Etiquette",
    title: "Bed Etiquette",
    behaviour: "The dog takes the bed and leaves the person at the edge.",
    funnyTruth: "The dog takes the bed and leaves the person at the edge.",
    deviceText: "A dog sprawled across the bed, one hand and one foot at the edge.",
    deviceStructure: "occupied_territory",
    darknessLevel: 2,
  });
  await recordGenerationEvent(
    { kind: "image", route: "flywheel-approve", jobId: CANDIDATE_ID },
    {
      success: true,
      durationMs: 0,
      meta: meta({
        size: approved.writerError
          ? `${approved.title} | ${approved.printFilePath} | ${approved.writerError}`
          : `${approved.title} | ${approved.printFilePath}`,
        durationMs: 0,
        estimatedCostUsd: null,
        providerRequestId: approved.printFilePath,
        model: "approve",
      }),
    },
  );
}

/** Runs inside the staging server after listen. Production never enters. */
export async function runStagingFlywheelOnce(): Promise<void> {
  if (!stagingProcess()) return;
  try {
    const { ensureSoftstyleProductCategory } = await import("./flywheel-category");
    const category = await ensureSoftstyleProductCategory();
    await recordGenerationEvent(
      { kind: "image", route: "flywheel-category", jobId: CANDIDATE_ID },
      {
        success: true,
        durationMs: 0,
        meta: meta({ size: `${category.fullName} ${category.categoryId}`, durationMs: 0, estimatedCostUsd: null, providerRequestId: category.categoryId, model: "category" }),
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[flywheel] category:", message);
    await recordGenerationEvent(
      { kind: "image", route: "flywheel-category", jobId: CANDIDATE_ID },
      { success: false, durationMs: 0, error: err, meta: meta({ size: message.slice(0, 500), durationMs: 0, estimatedCostUsd: null, providerRequestId: null, model: "category" }) },
    );
  }
  try {
    await approveBedEtiquette();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[flywheel] approve:", message);
    await recordGenerationEvent(
      { kind: "image", route: "flywheel-approve", jobId: CANDIDATE_ID },
      { success: false, durationMs: 0, error: err, meta: meta({ size: message.slice(0, 800), durationMs: 0, estimatedCostUsd: null, providerRequestId: null, model: "approve" }) },
    );
    return;
  }
  try {
    await runBedEtiquettePromote();
  } catch (err) {
    console.warn("[flywheel] promote:", err instanceof Error ? err.message : String(err));
  }
}
