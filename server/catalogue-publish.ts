/**
 * One Studio action: check, then build whatever is still missing, then publish.
 * A failed paid step leaves that step's output stored so the next click skips it.
 * Shopify and Printify are rolled back inside promote when the product create fails.
 */
import { eq } from "drizzle-orm";
import { catalogueDraftCostUsd } from "@shared/catalogueBulkImport";
import { publishPreflightMessages, shopifyAdminProductUrl, type PublishWorkPhase } from "@shared/cataloguePublish";
import { designCandidates, generationEvents, productTypes } from "@shared/schema";
import { recipeGaps, requireRecipe, type ApprovalRecipe } from "./catalogue-approval";
import { writeCatalogueListing } from "./catalogue-listing";
import { takeConceptEngineUsage } from "./concept-engine";
import { db } from "./db";
import { buildFlywheelPrintFile, lastPrintFileBilling, printCanvasFromStoredPlaceholders } from "./flywheel-print-file";
import { promoteCatalogueCandidate, PromoteRefusal } from "./flywheel-promote";
import {
  approveCandidateChoice,
  readChoice,
  readLibraryObject,
  saveChoice,
  softstyleType,
  writeLibraryObject,
} from "./mockup-library-store";

const STAGING_SHOP = "ai-art-studio-staging.myshopify.com";

export class PublishRefusal extends Error {
  readonly reasons: string[];
  constructor(reasons: string[]) {
    const list = reasons.map((reason) => String(reason || "").trim()).filter(Boolean);
    super(list.join("\n") || "Publish stopped");
    this.name = "PublishRefusal";
    this.reasons = list.length ? list : ["Publish stopped"];
  }
}

export type SpendLine = { label: string; usd: number; estimated: boolean };

export type PublishPhaseEvent = {
  phase: PublishWorkPhase | "done";
  spendUsd: number;
  lines: SpendLine[];
  productUrl?: string;
  shopifyProductId?: string;
};

const SPEND_LABEL: Record<string, string> = {
  "catalogue-print": "Print file",
  "flywheel-print-file": "Print file",
  "catalogue-listing": "Listing",
};

function clip(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export async function catalogueSpend(candidateId: string): Promise<{ totalUsd: number; lines: SpendLine[] }> {
  const rows = await db
    .select({
      route: generationEvents.route,
      cost: generationEvents.estimatedCostUsd,
      size: generationEvents.size,
    })
    .from(generationEvents)
    .where(eq(generationEvents.jobId, candidateId));
  const grouped = new Map<string, SpendLine>();
  for (const row of rows) {
    const label = SPEND_LABEL[String(row.route || "")];
    const usd = Number(row.cost);
    if (!label || !(usd > 0)) continue;
    const current = grouped.get(label) || { label, usd: 0, estimated: false };
    current.usd += usd;
    if (row.size === "estimated") current.estimated = true;
    grouped.set(label, current);
  }
  const lines = [...grouped.values()];
  return { totalUsd: lines.reduce((sum, line) => sum + line.usd, 0), lines };
}

async function recordSpend(args: {
  candidateId: string;
  shop: string;
  route: "catalogue-print" | "catalogue-listing";
  provider: "replicate" | "anthropic";
  model: string;
  costUsd: number;
  estimated: boolean;
  success: boolean;
  durationMs: number;
}) {
  try {
    await db.insert(generationEvents).values({
      kind: args.provider === "anthropic" ? "concepts" : "image",
      route: args.route,
      jobId: args.candidateId,
      shopDomain: args.shop,
      provider: args.provider,
      credentialRef: args.provider === "replicate" ? "replicate:shared" : null,
      model: args.model,
      size: args.estimated ? "estimated" : "billed",
      attempts: 1,
      durationMs: Math.round(args.durationMs),
      estimatedCostUsd: args.costUsd.toFixed(6),
      success: args.success,
    });
  } catch (err) {
    console.warn("[catalogue-publish] spend was not recorded:", (err as Error).message);
  }
}

async function snapshot(candidateId: string): Promise<{ totalUsd: number; lines: SpendLine[] }> {
  return catalogueSpend(candidateId);
}

export async function publishCatalogueCandidate(args: {
  recipe: ApprovalRecipe;
  pricesBySize: Record<string, string>;
  onPhase?: (event: PublishPhaseEvent) => void;
}): Promise<{ shopifyProductId: string; productUrl: string; status: string; spendUsd: number; lines: SpendLine[] }> {
  if (process.env.RAILWAY_ENVIRONMENT_NAME === "production") {
    throw new PublishRefusal(["Catalogue publish is staging only."]);
  }
  const recipe = args.recipe;
  const [stored] = await db.select().from(designCandidates).where(eq(designCandidates.id, recipe.candidateId)).limit(1);
  if (!stored || stored.shopDomain !== STAGING_SHOP) throw new PublishRefusal(["That candidate is not stored."]);
  if (stored.status === "dropped") throw new PublishRefusal(["This candidate was dropped."]);
  if (stored.shopifyProductId) {
    const spend = await snapshot(recipe.candidateId);
    return {
      shopifyProductId: stored.shopifyProductId,
      productUrl: shopifyAdminProductUrl(stored.shopDomain, stored.shopifyProductId),
      status: stored.status,
      spendUsd: spend.totalUsd,
      lines: spend.lines,
    };
  }

  const garment = await softstyleType();
  const [typeRow] = await db
    .select({
      name: productTypes.name,
      shop: productTypes.shopifyShopDomain,
      placeholderPositions: productTypes.placeholderPositions,
    })
    .from(productTypes)
    .where(eq(productTypes.id, garment.id))
    .limit(1);
  if (!typeRow) throw new PublishRefusal(["Unisex Softstyle T-Shirt was not found."]);
  const shop = String(typeRow.shop || "");
  if (shop !== STAGING_SHOP) throw new PublishRefusal(["Publishing this candidate is staging only."]);

  let choice = await readChoice(recipe.candidateId);
  const gaps = recipeGaps(recipe, stored.source);
  if (!String(choice.artworkPath || stored.artworkPath || "").trim()) gaps.push("Candidate artwork is not stored.");
  if (recipe.panelId && recipe.selectedColors.length) {
    await saveChoice(recipe.candidateId, recipe.panelId, recipe.selectedColors);
    choice = await readChoice(recipe.candidateId);
  }
  let blockers: string[] = [];
  const hasPrint = await readable(stored.printFilePath);
  const hasListing = Boolean(String(stored.title || "").trim() && String(stored.description || "").trim());
  const hasMockups = recipe.selectedColors.length > 0 && recipe.selectedColors.every((color) =>
    choice.mockupImages.some((image) => image.name.toLowerCase() === color.name.toLowerCase()),
  );
  try {
    await promoteCatalogueCandidate({
      candidateId: recipe.candidateId,
      publishNow: true,
      productTypeId: garment.id,
      pricesBySize: args.pricesBySize,
      checkOnly: true,
      deferApprovalArtifacts: !hasPrint || !hasListing || !hasMockups,
    });
  } catch (err) {
    if (err instanceof PromoteRefusal) blockers = err.reasons;
    else throw err;
  }
  const reasons = publishPreflightMessages(gaps, blockers);
  if (reasons.length) throw new PublishRefusal(reasons);
  const checked = requireRecipe(recipe, stored.source);
  const emit = async (phase: PublishPhaseEvent["phase"], extra?: { productUrl?: string; shopifyProductId?: string }) => {
    const spend = await snapshot(recipe.candidateId);
    args.onPhase?.({ phase, spendUsd: spend.totalUsd, lines: spend.lines, ...extra });
  };

  let printFilePath = hasPrint ? String(stored.printFilePath) : "";
  if (!printFilePath) {
    await emit("print");
    const started = Date.now();
    try {
      const canvas = printCanvasFromStoredPlaceholders(typeRow.placeholderPositions, typeRow.name);
      const source = await readLibraryObject(String(choice.artworkPath || stored.artworkPath));
      const print = await buildFlywheelPrintFile(checked.artStyle, source, canvas);
      printFilePath = `print-files/${recipe.candidateId}-${checked.artStyle}.png`;
      await writeLibraryObject(printFilePath, print.buffer, "image/png");
      await db.update(designCandidates).set({ printFilePath, updatedAt: new Date() }).where(eq(designCandidates.id, recipe.candidateId));
      const billing = lastPrintFileBilling();
      if (billing && billing.costUsd > 0) {
        await recordSpend({
          candidateId: recipe.candidateId,
          shop,
          route: "catalogue-print",
          provider: "replicate",
          model: print.path === "vectorize" ? "recraft-ai/recraft-vectorize" : "nightmareai/real-esrgan",
          costUsd: billing.costUsd,
          estimated: billing.estimated,
          success: true,
          durationMs: Date.now() - started,
        });
      }
    } catch (err) {
      const billing = lastPrintFileBilling();
      if (billing && billing.costUsd > 0) {
        await recordSpend({
          candidateId: recipe.candidateId,
          shop,
          route: "catalogue-print",
          provider: "replicate",
          model: "replicate",
          costUsd: billing.costUsd,
          estimated: billing.estimated,
          success: false,
          durationMs: Date.now() - started,
        });
      }
      throw err instanceof PublishRefusal ? err : new PublishRefusal([err instanceof Error ? err.message : String(err)]);
    }
    await emit("print");
  }

  let title = String(stored.title || "").trim();
  let description = String(stored.description || "").trim();
  if (!title || !description) {
    await emit("listing");
    const started = Date.now();
    const givenTitle = clip(recipe.title, 120) || clip(recipe.punchline, 120);
    try {
      const written = await writeCatalogueListing({
        title: givenTitle,
        species: checked.species,
        artStyle: checked.artStyle,
        humourOperator: checked.humourOperator,
        punchline: clip(recipe.punchline, 120),
      });
      title = written.title;
      description = written.description;
      await rememberListingCost(recipe.candidateId, shop, true, Date.now() - started);
    } catch (err) {
      await rememberListingCost(recipe.candidateId, shop, false, Date.now() - started);
      const fallback = clip(recipe.funnyTruth, 600);
      if (!givenTitle || !fallback) {
        throw err instanceof PublishRefusal ? err : new PublishRefusal([err instanceof Error ? err.message : String(err)]);
      }
      title = givenTitle;
      description = fallback;
    }
    await db.update(designCandidates).set({ title, description, updatedAt: new Date() }).where(eq(designCandidates.id, recipe.candidateId));
    await emit("listing");
  }

  if (!hasMockups) {
    await emit("mockups");
    await approveCandidateChoice({
      candidateId: recipe.candidateId,
      productTypeId: garment.id,
      typeName: typeRow.name,
      panelId: recipe.panelId,
      selectedColors: recipe.selectedColors,
    });
    await emit("mockups");
  }

  const now = new Date();
  await db.update(designCandidates).set({
    shopDomain: shop,
    status: "approved",
    source: stored.source === "generated" ? "generated" : "manual",
    humourOperator: checked.humourOperator,
    darknessLevel: checked.darkness || stored.darknessLevel || 0,
    species: checked.species,
    deviceStructure: checked.structure || stored.deviceStructure || "",
    deviceText: clip(recipe.deviceText, 400),
    funnyTruth: clip(recipe.funnyTruth, 400),
    punchline: clip(recipe.punchline, 120),
    artStyle: checked.artStyle,
    behaviour: checked.behaviour || stored.behaviour || "",
    productFamily: "apparel",
    credentialRef: "replicate:shared",
    printFilePath,
    panelId: recipe.panelId,
    selectedColors: recipe.selectedColors,
    title,
    description,
    updatedAt: now,
  }).where(eq(designCandidates.id, recipe.candidateId));

  await emit("shopify");
  try {
    const created = await promoteCatalogueCandidate({
      candidateId: recipe.candidateId,
      publishNow: true,
      productTypeId: garment.id,
      pricesBySize: args.pricesBySize,
    });
    const spend = await snapshot(recipe.candidateId);
    const productUrl = shopifyAdminProductUrl(shop, created.shopifyProductId);
    args.onPhase?.({
      phase: "done",
      spendUsd: spend.totalUsd,
      lines: spend.lines,
      productUrl,
      shopifyProductId: created.shopifyProductId,
    });
    return {
      shopifyProductId: created.shopifyProductId,
      productUrl,
      status: "promoted",
      spendUsd: spend.totalUsd,
      lines: spend.lines,
    };
  } catch (err) {
    if (err instanceof PromoteRefusal) throw new PublishRefusal(err.reasons);
    throw err instanceof PublishRefusal ? err : new PublishRefusal([err instanceof Error ? err.message : String(err)]);
  }
}

async function readable(path: string | null | undefined): Promise<boolean> {
  if (!String(path || "").trim()) return false;
  try {
    await readLibraryObject(String(path));
    return true;
  } catch {
    return false;
  }
}

async function rememberListingCost(candidateId: string, shop: string, success: boolean, durationMs: number) {
  const usage = takeConceptEngineUsage();
  if (!usage) return;
  const costUsd = catalogueDraftCostUsd(usage.usage, usage.model);
  if (!(costUsd && costUsd > 0)) return;
  await recordSpend({
    candidateId,
    shop,
    route: "catalogue-listing",
    provider: "anthropic",
    model: usage.model,
    costUsd,
    estimated: false,
    success,
    durationMs,
  });
}

