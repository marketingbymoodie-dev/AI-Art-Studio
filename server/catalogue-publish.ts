/**
 * One Studio action: check, then build whatever is still missing, then publish.
 * A failed paid step leaves that step's output stored so the next click skips it.
 * Shopify and Printify are rolled back inside promote when the product create fails.
 */
import { and, eq } from "drizzle-orm";
import { catalogueTruthIsSentence, catalogueListingIsFresh, rememberCatalogueListingSpend, writeCatalogueListing } from "./catalogue-listing";
import { publishPreflightMessages, shopifyAdminProductUrl, type PublishWorkPhase } from "@shared/cataloguePublish";
import { comparePublishTiming, listingBody, listingHandle, listingTitle } from "@shared/listingCopy";
import { catalogueShopAllowed, catalogueShopDomain } from "@shared/operatorCatalogue";
import { catalogueCandidateChoices, customizerPages, designCandidates, designProducts, generationEvents, mockupLibraryColours, productTypes } from "@shared/schema";
import { recipeGaps, requireRecipe, type ApprovalRecipe } from "./catalogue-approval";
import { db } from "./db";
import { placementForProductType } from "@shared/printPlacement";
import { buildFlywheelPrintFile, lastPrintFileBilling, printCanvasFromStoredPlaceholders } from "./flywheel-print-file";
import { promoteCatalogueCandidate, PromoteRefusal } from "./flywheel-promote";
import {
  approveCandidateChoice,
  panelsForType,
  readChoice,
  readLibraryObject,
  saveChoice,
  softstyleType,
  writeLibraryObject,
  type StoredMockupImage,
} from "./mockup-library-store";

export function cataloguePublishShopAllowed(shop: string): boolean {
  return catalogueShopAllowed(shop);
}

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

type CataloguePublishResult = {
  shopifyProductId: string;
  productUrl: string;
  status: string;
  spendUsd: number;
  lines: SpendLine[];
  printMs: number;
  mockupMs: number;
  listingMs: number;
  storeMs: number;
  printFilePath: string;
  mockups: StoredMockupImage[];
};

function publishResult(partial: Partial<CataloguePublishResult>): CataloguePublishResult {
  return {
    shopifyProductId: "",
    productUrl: "",
    status: "",
    spendUsd: 0,
    lines: [],
    printMs: 0,
    mockupMs: 0,
    listingMs: 0,
    storeMs: 0,
    printFilePath: "",
    mockups: [],
    ...partial,
  };
}

function mockupsCover(images: StoredMockupImage[], colors: Array<{ name: string }>, productTypeId: number): boolean {
  return colors.length > 0 && colors.every((color) =>
    images.some((image) => image.productTypeId === productTypeId && image.name.toLowerCase() === color.name.toLowerCase()),
  );
}

export type CataloguePublishWork = "all" | "check" | "print" | "listing" | "mockups" | "store";

export async function publishCatalogueCandidate(args: {
  recipe: ApprovalRecipe;
  pricesBySize: Record<string, string>;
  compareAtBySize?: Record<string, string>;
  onPhase?: (event: PublishPhaseEvent) => void;
  /** check stops before any paid work. The other phases build one step. */
  work?: CataloguePublishWork;
  /** The batch already refused every ticked type, so this step does not ask Shopify again. */
  prechecked?: boolean;
  preparedMockups?: StoredMockupImage[];
  /** False writes My Pet off. Omitted stays on. */
  myPetEnabled?: boolean;
}): Promise<CataloguePublishResult> {
  if (process.env.RAILWAY_ENVIRONMENT_NAME === "production") {
    throw new PublishRefusal(["Catalogue publish is staging only."]);
  }
  const recipe = args.recipe;
  const [stored] = await db.select().from(designCandidates).where(eq(designCandidates.id, recipe.candidateId)).limit(1);
  if (!stored || !cataloguePublishShopAllowed(String(stored.shopDomain || ""))) throw new PublishRefusal(["That candidate is not stored."]);
  if (stored.status === "dropped") throw new PublishRefusal(["This candidate was dropped."]);
  const requestedType = Number(recipe.productTypeId);
  const garment = Number.isInteger(requestedType) && requestedType > 0
    ? { id: requestedType, name: "" }
    : await softstyleType();
  const [typeRow] = await db
    .select({
      name: productTypes.name,
      shop: productTypes.shopifyShopDomain,
      placeholderPositions: productTypes.placeholderPositions,
      description: productTypes.description,
      listingGarmentWord: productTypes.listingGarmentWord,
      listingHandleSuffix: productTypes.listingHandleSuffix,
      listingStyleLabel: productTypes.listingStyleLabel,
    })
    .from(productTypes)
    .where(eq(productTypes.id, garment.id))
    .limit(1);
  if (!typeRow) throw new PublishRefusal(["That product type was not found."]);
  const shop = String(typeRow.shop || "");
  if (!cataloguePublishShopAllowed(shop)) throw new PublishRefusal(["Publishing this candidate is staging only."]);
  const work = args.work || "all";
  const listed = await db
    .select({
      shopifyProductId: designProducts.shopifyProductId,
      shop: designProducts.shop,
      productTypeId: designProducts.productTypeId,
    })
    .from(designProducts)
    .where(eq(designProducts.jobId, recipe.candidateId));
  const already = listed.find((row) =>
    row.productTypeId === garment.id
    && catalogueShopDomain(String(row.shop || "")) === catalogueShopDomain(shop)
    && String(row.shopifyProductId || "").trim(),
  );
  if (already?.shopifyProductId) {
    const spend = await snapshot(recipe.candidateId);
    return publishResult({
      shopifyProductId: already.shopifyProductId,
      productUrl: shopifyAdminProductUrl(shop, already.shopifyProductId),
      status: "promoted",
      spendUsd: spend.totalUsd,
      lines: spend.lines,
    });
  }

  const crossShop = shop !== String(stored.shopDomain || "");
  let choice = await readChoice(recipe.candidateId);
  const gaps = recipeGaps(recipe, stored.source);
  if (!String(choice.artworkPath || stored.artworkPath || "").trim()) gaps.push("Candidate artwork is not stored.");
  if ((work === "all" || work === "store") && recipe.panelId && recipe.selectedColors.length && !crossShop) {
    await saveChoice(recipe.candidateId, recipe.panelId, recipe.selectedColors);
    choice = await readChoice(recipe.candidateId);
  }
  const plannedStyle = String(recipe.artStyle || stored.artStyle || "").trim();
  const typePrintPath = `print-files/${recipe.candidateId}-${plannedStyle}-t${garment.id}.png`;
  const hasPrint = await readable(typePrintPath);
  const hasListing = Boolean(
    String(stored.title || "").trim()
    && String(stored.description || "").trim()
    && await catalogueListingIsFresh(recipe.candidateId),
  );
  const preparedMockups = args.preparedMockups || [];
  const hasMockups = mockupsCover(preparedMockups, recipe.selectedColors, garment.id)
    || mockupsCover(choice.mockupImages, recipe.selectedColors, garment.id);
  if (!args.prechecked) {
    const blockers: string[] = [];
    if (!String(typeRow.listingGarmentWord || "").trim()) {
      blockers.push(`${typeRow.name} has no garment word. Set it on the product type before publishing.`);
    }
    if (!(await typeHasRetail(garment.id))) {
      blockers.push("Retail is $0.00 for this type. Set the price table before publishing a design.");
    }
    blockers.push(...await missingApprovedBlanks(garment.id, typeRow.name, recipe.selectedColors));
    try {
      await promoteCatalogueCandidate({
        candidateId: recipe.candidateId,
        publishNow: true,
        productTypeId: garment.id,
        pricesBySize: args.pricesBySize,
        compareAtBySize: args.compareAtBySize,
        checkOnly: true,
        deferApprovalArtifacts: !hasPrint || !hasListing || !hasMockups,
        selectedColors: recipe.selectedColors,
        panelId: recipe.panelId,
      });
    } catch (err) {
      if (err instanceof PromoteRefusal) blockers.push(...err.reasons);
      else throw err;
    }
    const reasons = publishPreflightMessages(gaps, blockers);
    if (reasons.length) throw new PublishRefusal(reasons);
  }
  if (work === "check") {
    const spend = await snapshot(recipe.candidateId);
    return publishResult({ status: "checked", spendUsd: spend.totalUsd, lines: spend.lines });
  }
  const checked = requireRecipe(recipe, stored.source);
  const emit = async (phase: PublishPhaseEvent["phase"], extra?: { productUrl?: string; shopifyProductId?: string }) => {
    const spend = await snapshot(recipe.candidateId);
    args.onPhase?.({ phase, spendUsd: spend.totalUsd, lines: spend.lines, ...extra });
  };

  let printFilePath = hasPrint ? typePrintPath : "";
  let printMs = 0;
  if ((work === "all" || work === "print") && !printFilePath) {
    await emit("print");
    const started = Date.now();
    try {
      const canvas = printCanvasFromStoredPlaceholders(typeRow.placeholderPositions, typeRow.name);
      const source = await readLibraryObject(String(choice.artworkPath || stored.artworkPath));
      const { chestFitForProductType } = await import("./colour-blanks");
      const print = await buildFlywheelPrintFile(
        checked.artStyle,
        source,
        canvas,
        placementForProductType(garment.id).anchor,
        (await chestFitForProductType(garment.id)) ?? undefined,
      );
      printFilePath = typePrintPath;
      await writeLibraryObject(printFilePath, print.buffer, "image/png");
      printMs = Date.now() - started;
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
  if (work === "print") {
    const spend = await snapshot(recipe.candidateId);
    return publishResult({
      status: "printed",
      printMs,
      printFilePath,
      spendUsd: spend.totalUsd,
      lines: spend.lines,
    });
  }

  let title = String(stored.title || "").trim();
  let description = String(stored.description || "").trim();
  let listingMs = 0;
  if ((work === "all" || work === "listing") && !hasListing) {
    await emit("listing");
    const started = Date.now();
    const lettering = clip(recipe.punchline, 120);
    const truth = clip(recipe.funnyTruth, 600);
    try {
      const artwork = await readLibraryObject(String(choice.artworkPath || stored.artworkPath));
      const written = await writeCatalogueListing({
        title: lettering,
        species: checked.species,
        artStyle: checked.artStyle,
        humourOperator: checked.humourOperator,
        punchline: lettering,
        funnyTruth: clip(recipe.funnyTruth, 400),
        deviceText: clip(recipe.deviceText, 400),
        artwork,
      });
      title = written.title;
      description = written.description;
      await rememberCatalogueListingSpend(recipe.candidateId, shop, true, Date.now() - started);
    } catch (err) {
      await rememberCatalogueListingSpend(recipe.candidateId, shop, false, Date.now() - started);
      if (!lettering || !catalogueTruthIsSentence(truth)) {
        throw err instanceof PublishRefusal ? err : new PublishRefusal([err instanceof Error ? err.message : String(err)]);
      }
      title = lettering;
      description = truth;
    }
    listingMs = Date.now() - started;
    await db.update(designCandidates).set({ title, description, updatedAt: new Date() }).where(eq(designCandidates.id, recipe.candidateId));
    await emit("listing");
  }
  if (work === "listing") {
    const spend = await snapshot(recipe.candidateId);
    return publishResult({
      status: "listed",
      listingMs,
      spendUsd: spend.totalUsd,
      lines: spend.lines,
    });
  }

  let renderedMockups: StoredMockupImage[] | undefined = preparedMockups.length ? preparedMockups : undefined;
  let mockupMs = 0;
  if ((work === "all" || work === "mockups") && !hasMockups) {
    await emit("mockups");
    const mockupStarted = Date.now();
    renderedMockups = await approveCandidateChoice({
      candidateId: recipe.candidateId,
      productTypeId: garment.id,
      typeName: typeRow.name,
      panelId: recipe.panelId,
      selectedColors: recipe.selectedColors,
      preserveStoredColours: crossShop || work === "mockups",
    });
    mockupMs = Date.now() - mockupStarted;
    await emit("mockups");
  }
  if (work === "mockups") {
    const spend = await snapshot(recipe.candidateId);
    return publishResult({
      status: "mocked",
      mockupMs,
      mockups: renderedMockups || [],
      spendUsd: spend.totalUsd,
      lines: spend.lines,
    });
  }

  if (!printFilePath) throw new PublishRefusal(["Print file was not built."]);
  const garmentWord = String(typeRow.listingGarmentWord || "").trim();
  if (!garmentWord) {
    throw new PublishRefusal([`${typeRow.name} has no garment word. Set it on the product type before publishing.`]);
  }
  const composedTitle = listingTitle(title, garmentWord);
  const composedHandle = listingHandle(composedTitle, typeRow.listingHandleSuffix);
  const composedBody = listingBody({
    styleLabel: typeRow.listingStyleLabel,
    designDescription: description,
    garmentDetails: typeRow.description,
  });
  const storeMockups = (renderedMockups?.length ? renderedMockups : choice.mockupImages)
    .filter((image) => image.productTypeId === garment.id);

  const now = new Date();
  await db.update(designCandidates).set({
    ...(crossShop ? {} : {
      shopDomain: shop,
      panelId: recipe.panelId,
      selectedColors: recipe.selectedColors,
    }),
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
    title,
    description,
    updatedAt: now,
  }).where(eq(designCandidates.id, recipe.candidateId));

  await emit("shopify");
  const storeStarted = Date.now();
  try {
    const created = await promoteCatalogueCandidate({
      candidateId: recipe.candidateId,
      publishNow: true,
      productTypeId: garment.id,
      pricesBySize: args.pricesBySize,
      compareAtBySize: args.compareAtBySize,
      selectedColors: recipe.selectedColors,
      panelId: recipe.panelId,
      mockupImages: storeMockups,
      listingTitle: composedTitle,
      listingHandle: composedHandle,
      listingDescription: composedBody,
      myPetEnabled: args.myPetEnabled,
      printFilePath,
    });
    const storeMs = Date.now() - storeStarted;
    const spend = await snapshot(recipe.candidateId);
    const productUrl = shopifyAdminProductUrl(shop, created.shopifyProductId);
    args.onPhase?.({
      phase: "done",
      spendUsd: spend.totalUsd,
      lines: spend.lines,
      productUrl,
      shopifyProductId: created.shopifyProductId,
    });
    return publishResult({
      shopifyProductId: created.shopifyProductId,
      productUrl,
      status: "promoted",
      spendUsd: spend.totalUsd,
      lines: spend.lines,
      printMs,
      mockupMs,
      listingMs,
      storeMs,
      printFilePath,
      mockups: storeMockups,
    });
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

async function typeHasRetail(productTypeId: number): Promise<boolean> {
  const { isNonPositiveRetailPrice } = await import("@shared/productIntelligence");
  const pages = await db
    .select({ price: customizerPages.baseProductPrice, status: customizerPages.status })
    .from(customizerPages)
    .where(eq(customizerPages.productTypeId, productTypeId));
  return pages.some((page) => page.status === "active" && !isNonPositiveRetailPrice(page.price));
}

async function missingApprovedBlanks(
  productTypeId: number,
  typeName: string,
  colors: Array<{ name: string }>,
): Promise<string[]> {
  const { blankLibraryTypeId } = await import("./colour-blanks");
  const { inUseBlankKind } = await import("@shared/colourBlanks");
  const libraryId = await blankLibraryTypeId(productTypeId);
  const [rows, panels] = await Promise.all([
    db
      .select({ name: mockupLibraryColours.name, linkStoredName: mockupLibraryColours.linkStoredName })
      .from(mockupLibraryColours)
      .where(and(eq(mockupLibraryColours.productTypeId, libraryId), eq(mockupLibraryColours.active, true))),
    panelsForType(libraryId),
  ]);
  const scene = panels.map((panel) => ({
    panelId: panel.panelId,
    name: panel.garmentColor || "",
    kind: panel.kind,
  }));
  const approved = new Set<string>();
  for (const row of rows) {
    const linked = String(row.linkStoredName || "").trim();
    const kind = inUseBlankKind(scene, row.name) || (linked ? inUseBlankKind(scene, linked) : null);
    if (kind) approved.add(row.name.toLowerCase());
  }
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const color of colors) {
    const key = color.name.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (!approved.has(key)) missing.push(`${color.name} has no approved blank on ${typeName}.`);
  }
  return missing;
}

export async function sceneForType(productTypeId: number, requested: string): Promise<string> {
  const { blankLibraryTypeId } = await import("./colour-blanks");
  const libraryId = await blankLibraryTypeId(productTypeId);
  const panels = await panelsForType(libraryId);
  if (requested && panels.some((panel) => panel.panelId === requested)) return requested;
  const fallback = panels.find((panel) => panel.isDefault) || panels[0];
  return fallback?.panelId || "";
}

function reasonText(err: unknown): string {
  if (err instanceof PublishRefusal && err.reasons.length) return err.reasons.join("\n");
  return err instanceof Error ? err.message : String(err);
}

export type CatalogueTypeResult = {
  productTypeId: number;
  name: string;
  status: "done" | "failed";
  error: string;
  shopifyProductId: string;
  printMs: number;
  mockupMs: number;
  storeMs: number;
};

export type CatalogueBatchResult = {
  listingWriteMs: number;
  parallelMs: number;
  togetherMs: number;
  separateMs: number;
  types: CatalogueTypeResult[];
};

/** Print files and mockups for every ticked type together, then one listing at a time. */
export async function publishCatalogueTargets(args: {
  recipe: ApprovalRecipe;
  onPhase?: (event: PublishPhaseEvent) => void;
}): Promise<CatalogueBatchResult> {
  const requested = args.recipe.targets?.length
    ? args.recipe.targets
    : [{ productTypeId: Number(args.recipe.productTypeId), selectedColors: args.recipe.selectedColors }];
  const open: Array<{
    productTypeId: number;
    name: string;
    selectedColors: ApprovalRecipe["selectedColors"];
    panelId: string;
  }> = [];
  const precheck: string[] = [];
  for (const target of requested) {
    const [typeRow] = await db
      .select({ name: productTypes.name, shop: productTypes.shopifyShopDomain })
      .from(productTypes)
      .where(eq(productTypes.id, target.productTypeId))
      .limit(1);
    const name = typeRow?.name || `Type ${target.productTypeId}`;
    const shop = String(typeRow?.shop || "");
    const listed = await db
      .select({
        shopifyProductId: designProducts.shopifyProductId,
        shop: designProducts.shop,
        productTypeId: designProducts.productTypeId,
      })
      .from(designProducts)
      .where(eq(designProducts.jobId, args.recipe.candidateId));
    const published = listed.find((row) =>
      row.productTypeId === target.productTypeId
      && catalogueShopDomain(String(row.shop || "")) === catalogueShopDomain(shop)
      && String(row.shopifyProductId || "").trim(),
    );
    if (published) continue;
    const panelId = await sceneForType(target.productTypeId, args.recipe.panelId);
    const recipe: ApprovalRecipe = {
      ...args.recipe,
      productTypeId: target.productTypeId,
      selectedColors: target.selectedColors,
      panelId,
    };
    try {
      const { shippingPricesBySize } = await import("./routes/catalogue-studio");
      const prices = await shippingPricesBySize(target.productTypeId);
      await publishCatalogueCandidate({
        recipe,
        pricesBySize: prices.pricesBySize,
        compareAtBySize: prices.compareAtBySize,
        work: "check",
      });
      open.push({ productTypeId: target.productTypeId, name, selectedColors: target.selectedColors, panelId });
    } catch (err) {
      for (const line of reasonText(err).split("\n")) {
        if (line.trim()) precheck.push(`${name}: ${line.trim()}`);
      }
    }
  }
  if (!open.length && !precheck.length) throw new PublishRefusal(["Every selected type is already published."]);
  if (precheck.length) throw new PublishRefusal(precheck);

  const first = open[0];
  const parallelStarted = Date.now();
  let listingWriteMs = 0;
  const listingTask = (async () => {
    const { shippingPricesBySize } = await import("./routes/catalogue-studio");
    const prices = await shippingPricesBySize(first.productTypeId);
    const written = await publishCatalogueCandidate({
      recipe: {
        ...args.recipe,
        productTypeId: first.productTypeId,
        selectedColors: first.selectedColors,
        panelId: first.panelId,
      },
      pricesBySize: prices.pricesBySize,
      compareAtBySize: prices.compareAtBySize,
      work: "listing",
      prechecked: true,
      onPhase: args.onPhase,
    });
    listingWriteMs = written.listingMs;
  })();
  const built = await Promise.all(open.map(async (target) => {
    const { shippingPricesBySize } = await import("./routes/catalogue-studio");
    const recipe: ApprovalRecipe = {
      ...args.recipe,
      productTypeId: target.productTypeId,
      selectedColors: target.selectedColors,
      panelId: target.panelId,
    };
    let prices: { pricesBySize: Record<string, string>; compareAtBySize: Record<string, string> } = {
      pricesBySize: {},
      compareAtBySize: {},
    };
    try {
      prices = await shippingPricesBySize(target.productTypeId);
      const [print, mockups] = await Promise.all([
        publishCatalogueCandidate({
          recipe,
          pricesBySize: prices.pricesBySize,
          compareAtBySize: prices.compareAtBySize,
          work: "print",
          prechecked: true,
          onPhase: args.onPhase,
        }),
        publishCatalogueCandidate({
          recipe,
          pricesBySize: prices.pricesBySize,
          compareAtBySize: prices.compareAtBySize,
          work: "mockups",
          prechecked: true,
          onPhase: args.onPhase,
        }),
      ]);
      return { target, prices, printMs: print.printMs, mockupMs: mockups.mockupMs, mockups: mockups.mockups, error: "" };
    } catch (err) {
      return { target, prices, printMs: 0, mockupMs: 0, mockups: [] as StoredMockupImage[], error: reasonText(err) };
    }
  }));
  await listingTask;
  const parallelMs = Date.now() - parallelStarted;

  const incoming = built.flatMap((item) => item.mockups);
  if (incoming.length) {
    const choice = await readChoice(args.recipe.candidateId);
    const kept = choice.mockupImages.filter((image) => !incoming.some((next) => next.productTypeId === image.productTypeId));
    await db.update(catalogueCandidateChoices).set({
      mockupImages: [...kept, ...incoming],
      updatedAt: new Date(),
    }).where(eq(catalogueCandidateChoices.candidateId, args.recipe.candidateId));
  }

  const types: CatalogueTypeResult[] = [];
  for (const item of built) {
    if (item.error) {
      types.push({
        productTypeId: item.target.productTypeId,
        name: item.target.name,
        status: "failed",
        error: item.error,
        shopifyProductId: "",
        printMs: item.printMs,
        mockupMs: item.mockupMs,
        storeMs: 0,
      });
      continue;
    }
    const started = Date.now();
    try {
      const created = await publishCatalogueCandidate({
        recipe: {
          ...args.recipe,
          productTypeId: item.target.productTypeId,
          selectedColors: item.target.selectedColors,
          panelId: item.target.panelId,
        },
        pricesBySize: item.prices.pricesBySize,
        compareAtBySize: item.prices.compareAtBySize,
        work: "store",
        prechecked: true,
        preparedMockups: item.mockups,
        myPetEnabled: args.recipe.myPetEnabled,
        onPhase: args.onPhase,
      });
      types.push({
        productTypeId: item.target.productTypeId,
        name: item.target.name,
        status: "done",
        error: "",
        shopifyProductId: created.shopifyProductId,
        printMs: item.printMs,
        mockupMs: item.mockupMs,
        storeMs: Date.now() - started,
      });
    } catch (err) {
      types.push({
        productTypeId: item.target.productTypeId,
        name: item.target.name,
        status: "failed",
        error: reasonText(err),
        shopifyProductId: "",
        printMs: item.printMs,
        mockupMs: item.mockupMs,
        storeMs: Date.now() - started,
      });
    }
  }
  const timing = comparePublishTiming({
    listingWriteMs,
    types: types.map((row) => ({ printMs: row.printMs, mockupMs: row.mockupMs, storeMs: row.storeMs })),
  });
  console.log(
    `[catalogue-publish] listingMs=${listingWriteMs} parallelMs=${parallelMs} togetherMs=${timing.togetherMs} separateMs=${timing.separateMs}`,
  );
  return {
    listingWriteMs,
    parallelMs,
    togetherMs: timing.togetherMs,
    separateMs: timing.separateMs,
    types,
  };
}


