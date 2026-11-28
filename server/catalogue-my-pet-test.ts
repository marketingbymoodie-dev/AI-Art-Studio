/**
 * Operator My Pet test inside Design Studio.
 * Same Sunburst edit as the storefront (design artwork, then the pet photo)
 * on the same shared Replicate credential. The edited artwork is stored only
 * so the studio mockup can show it. No shopper photo row, render row, job,
 * cart, order, listing, or customer credit.
 */
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { PETPOSTEROUS_CATALOGUE_SHOP } from "@shared/operatorCatalogue";
import { MY_PET_SUNBURST_ESTIMATED_COST_USD, buildMyPetPrompt } from "@shared/myPetSettings";
import { MyPetPoseRejectedError, myPetQualityRetryAllowed } from "@shared/myPetQuality";
import { parseCatalogueConceptGeneration } from "@shared/catalogueConcept";
import { designCandidates } from "@shared/schema";
import { catalogueConceptShopAllowed } from "./catalogue-concept";
import { db } from "./db";
import { recordGenerationEvent } from "./generation-events";
import { CREDENTIALS } from "./generation-providers";
import { readChoice, readLibraryObject, removeLibraryObject, signedLibraryUrl, writeLibraryObject } from "./mockup-library-store";
import { getMyPetSettings, MY_PET_REPLICATE_MODEL, runMyPetImageEdit } from "./my-pet";
import { checkMyPetEdit, describeShopperPet } from "./my-pet-quality";
import { decodeDataUrlOrBase64Image } from "./my-pet-storage";

const REMEMBER_MS = 15 * 60 * 1000;
const inflight = new Map<string, Promise<unknown>>();
const finished = new Map<string, { at: number; body: unknown }>();
const shopLock = new Map<string, string>();

export type CatalogueMyPetTestResult = {
  artworkPath: string;
  prompt: string;
  model: string;
  estimatedCostUsd: number;
  actualCostUsd: number | null;
};

export function catalogueMyPetTestArtworkPath(value: string): boolean {
  return /^catalogue-my-pet-test\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/i.test(value);
}

/** Image 1 is the finished design. Image 2 is the pet. Same order as the storefront edit. */
export function catalogueMyPetEditReferences(designUrl: string, petUrl: string): [string, string] {
  return [designUrl, petUrl];
}

function remember(id: string, body: unknown) {
  const now = Date.now();
  finished.set(id, { at: now, body });
  for (const [key, row] of finished) {
    if (now - row.at > REMEMBER_MS) finished.delete(key);
  }
}

async function once<T>(requestId: string, run: () => Promise<T>): Promise<T> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new Error("The request id is not valid.");
  }
  const done = finished.get(requestId);
  if (done) return done.body as T;
  const pending = inflight.get(requestId);
  if (pending) return pending as Promise<T>;
  const shop = PETPOSTEROUS_CATALOGUE_SHOP;
  const held = shopLock.get(shop);
  if (held && held !== requestId) throw new Error("A pet test is already running. Wait for it to finish.");
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

function photoContentType(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  throw new Error("Use a PNG, JPEG, or WebP photo.");
}

export async function runCatalogueMyPetTest(args: {
  shop: string | null | undefined;
  requestId: string;
  candidateId: string;
  drawId: string;
  imageData: string;
}): Promise<CatalogueMyPetTestResult> {
  if (!catalogueConceptShopAllowed(args.shop)) {
    throw new Error("My Pet tests are only available on Petposterous.");
  }
  if (process.env.RAILWAY_ENVIRONMENT_NAME === "production") {
    throw new Error("My Pet tests are staging only.");
  }
  return once(args.requestId, () => runOne(args));
}

async function runOne(args: {
  candidateId: string;
  drawId: string;
  imageData: string;
}): Promise<CatalogueMyPetTestResult> {
  const [row] = await db.select().from(designCandidates).where(eq(designCandidates.id, args.candidateId)).limit(1);
  if (!row || row.shopDomain !== PETPOSTEROUS_CATALOGUE_SHOP) {
    throw new Error("That candidate is not on Petposterous.");
  }
  const choice = await readChoice(args.candidateId);
  let artworkPath = String(choice.artworkPath || row.artworkPath || "");
  if (args.drawId) {
    const draw = parseCatalogueConceptGeneration(row.generation)?.draws.find((item) => item.id === args.drawId);
    if (!draw) throw new Error("That draw is not on this candidate.");
    artworkPath = draw.artworkPath;
  }
  if (!artworkPath.trim()) throw new Error("This candidate has no stored artwork.");

  const photo = decodeDataUrlOrBase64Image(args.imageData);
  if (photo.length > 15 * 1024 * 1024) throw new Error("Photo is too large");
  const contentType = photoContentType(photo);
  const photoPath = `catalogue-my-pet-test/photos/${randomUUID()}.png`;
  const settings = await getMyPetSettings(PETPOSTEROUS_CATALOGUE_SHOP);
  let petDescription = "";
  let visionCostUsd = 0;
  try {
    const described = await describeShopperPet(photo);
    petDescription = described.description;
    visionCostUsd += described.costUsd;
  } catch (err) {
    console.warn(`[my-pet] studio pet description skipped: ${(err as Error)?.message}`);
  }
  const prompt = buildMyPetPrompt(settings, {
    species: row.species || "",
    artStyle: row.artStyle || "",
    punchline: row.punchline || "",
  }, {
    petDescription,
    poseNote: row.poseNote || "",
  });
  const started = Date.now();
  let edited = "";
  let startedModel = false;
  try {
    await writeLibraryObject(photoPath, photo, contentType);
    const [designUrl, petUrl] = await Promise.all([
      signedLibraryUrl(artworkPath),
      signedLibraryUrl(photoPath),
    ]);
    const [referenceDesign, referencePet] = catalogueMyPetEditReferences(designUrl, petUrl);
    startedModel = true;
    const result = await runMyPetImageEdit({
      prompt,
      designUrl: referenceDesign,
      petUrl: referencePet,
      renderParams: settings.renderParams,
    });
    let png = Buffer.from(result.data, "base64");
    let sunburstCalls = 1;
    const originalArt = await readLibraryObject(artworkPath);
    let qa = await checkMyPetEdit(originalArt, png, row.poseNote || "");
    visionCostUsd += qa.costUsd;
    if (myPetQualityRetryAllowed(qa.checked && !qa.pass, false)) {
      const retry = await runMyPetImageEdit({
        prompt: `${prompt} The previous attempt failed this check: ${qa.reason}. Correct only that.`,
        designUrl: referenceDesign,
        petUrl: referencePet,
        renderParams: settings.renderParams,
      });
      sunburstCalls = 2;
      png = Buffer.from(retry.data, "base64");
      qa = await checkMyPetEdit(originalArt, png, row.poseNote || "");
      visionCostUsd += qa.costUsd;
      if (qa.checked && !qa.pass) throw new MyPetPoseRejectedError();
    }
    if (png.length < 8 || png[0] !== 0x89 || png[1] !== 0x50) throw new Error("The model did not return a PNG.");
    edited = `catalogue-my-pet-test/${randomUUID()}.png`;
    await writeLibraryObject(edited, png, "image/png");
    await recordGenerationEvent(
      {
        kind: "image",
        route: "catalogue-my-pet-test",
        jobId: args.candidateId,
        shopDomain: PETPOSTEROUS_CATALOGUE_SHOP,
        experienceProfile: "petposterous",
        productFamily: "apparel",
        legacyModel: MY_PET_REPLICATE_MODEL,
        legacyQuality: settings.renderParams.quality,
      },
      {
        success: true,
        durationMs: result.durationMs,
        meta: {
          provider: "replicate",
          credentialRefId: CREDENTIALS["replicate:shared"].id,
          credentialScope: "shared",
          model: MY_PET_REPLICATE_MODEL,
          quality: settings.renderParams.quality,
          size: "estimated",
          attempts: sunburstCalls,
          durationMs: result.durationMs,
          transparent: result.transparent,
          transparentFraction: result.transparentFraction,
          usage: null,
          estimatedCostUsd: sunburstCalls * MY_PET_SUNBURST_ESTIMATED_COST_USD + visionCostUsd,
          providerRequestId: result.providerRequestId,
          providerMime: "image/png",
        },
      },
    );
    return {
      artworkPath: edited,
      prompt,
      model: MY_PET_REPLICATE_MODEL,
      estimatedCostUsd: sunburstCalls * MY_PET_SUNBURST_ESTIMATED_COST_USD + visionCostUsd,
      actualCostUsd: null,
    };
  } catch (err) {
    if (edited) await removeLibraryObject(edited).catch(() => undefined);
    if (!startedModel) throw err;
    await recordGenerationEvent(
      {
        kind: "image",
        route: "catalogue-my-pet-test",
        jobId: args.candidateId,
        shopDomain: PETPOSTEROUS_CATALOGUE_SHOP,
        experienceProfile: "petposterous",
        productFamily: "apparel",
        legacyModel: MY_PET_REPLICATE_MODEL,
        legacyQuality: settings.renderParams.quality,
      },
      { success: false, durationMs: Date.now() - started, error: err },
    );
    throw err;
  } finally {
    await removeLibraryObject(photoPath).catch(() => undefined);
  }
}
