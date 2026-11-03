/**
 * One staging run of the Bed Etiquette print file, then the draft promote.
 * Staging only. A successful print is not repeated. Promote runs once.
 */
import sharp from "sharp";
import { and, eq, inArray } from "drizzle-orm";
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
    const size = `shopify ${result.shopifyProductId}; printify ${result.printifyProductId}; status ${result.status}`;
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

/** Attach each existing variant to its colour mockup. Does not create a product. */
async function linkBedEtiquetteVariantMedia(): Promise<void> {
  const [done] = await db
    .select({ success: generationEvents.success })
    .from(generationEvents)
    .where(and(eq(generationEvents.route, "flywheel-variant-media"), eq(generationEvents.jobId, CANDIDATE_ID), eq(generationEvents.success, true)))
    .limit(1);
  if (done) return;
  const [candidate] = await db
    .select({
      shopDomain: designCandidates.shopDomain,
      shopifyProductId: designCandidates.shopifyProductId,
    })
    .from(designCandidates)
    .where(eq(designCandidates.id, CANDIDATE_ID))
    .limit(1);
  if (!candidate?.shopifyProductId) return;
  const { storage } = await import("./storage");
  const { ensureValidOfflineAccessToken } = await import("./shopify-offline-token");
  const { linkCatalogueVariantMockups } = await import("./flywheel-promote");
  const installation = await storage.getShopifyInstallationByShop(candidate.shopDomain);
  if (!installation?.accessToken) throw new Error("Shopify is not connected for this shop.");
  const ready = await ensureValidOfflineAccessToken(installation);
  if (!ready.ok) throw new Error(ready.error);
  const linked = await linkCatalogueVariantMockups({
    shop: candidate.shopDomain,
    token: ready.accessToken,
    shopifyProductId: candidate.shopifyProductId,
  });
  await recordGenerationEvent(
    { kind: "image", route: "flywheel-variant-media", jobId: CANDIDATE_ID },
    {
      success: true,
      durationMs: 0,
      meta: meta({
        size: `${linked.colours} colours, ${linked.variants} variants`,
        durationMs: 0,
        estimatedCostUsd: null,
        providerRequestId: candidate.shopifyProductId,
        model: "variant-media",
      }),
    },
  );
}

/** Link swatches on the draft that already exists. Does not create another product. */
async function linkBedEtiquetteSwatches(): Promise<void> {
  const [done] = await db
    .select({ success: generationEvents.success })
    .from(generationEvents)
    .where(and(eq(generationEvents.route, "flywheel-swatches"), eq(generationEvents.jobId, CANDIDATE_ID), eq(generationEvents.success, true)))
    .limit(1);
  if (done) return;
  const [candidate] = await db
    .select({
      shopDomain: designCandidates.shopDomain,
      shopifyProductId: designCandidates.shopifyProductId,
    })
    .from(designCandidates)
    .where(eq(designCandidates.id, CANDIDATE_ID))
    .limit(1);
  if (!candidate?.shopifyProductId) return;
  const choice = await readChoice(CANDIDATE_ID);
  const { storage } = await import("./storage");
  const { linkCatalogueProductSwatches } = await import("./flywheel-promote");
  const installation = await storage.getShopifyInstallationByShop(candidate.shopDomain);
  if (!installation?.accessToken) throw new Error("Shopify is not connected for this shop.");
  await linkCatalogueProductSwatches({
    shop: candidate.shopDomain,
    token: installation.accessToken,
    shopifyProductId: candidate.shopifyProductId,
    colours: choice.selectedColors,
  });
  await recordGenerationEvent(
    { kind: "image", route: "flywheel-swatches", jobId: CANDIDATE_ID },
    {
      success: true,
      durationMs: 0,
      meta: meta({ size: candidate.shopifyProductId, durationMs: 0, estimatedCostUsd: null, providerRequestId: candidate.shopifyProductId, model: "swatches" }),
    },
  );
}

/** Replace the fallback description once the listing writer can run. Does not create a product. */
async function rewriteBedEtiquetteListing(): Promise<void> {
  const [done] = await db
    .select({ success: generationEvents.success })
    .from(generationEvents)
    .where(and(eq(generationEvents.route, "flywheel-listing"), eq(generationEvents.jobId, CANDIDATE_ID), eq(generationEvents.success, true)))
    .limit(1);
  if (done) return;
  const [candidate] = await db.select().from(designCandidates).where(eq(designCandidates.id, CANDIDATE_ID)).limit(1);
  if (!candidate?.title || !candidate.shopifyProductId || !candidate.printifyProductId) return;
  const { writeCatalogueListing } = await import("./catalogue-listing");
  const choice = await readChoice(CANDIDATE_ID);
  if (!choice.artworkPath) throw new Error("Candidate artwork is not stored");
  const listing = await writeCatalogueListing({
    title: candidate.punchline || candidate.title,
    species: candidate.species,
    artStyle: candidate.artStyle,
    humourOperator: candidate.humourOperator,
    punchline: candidate.punchline || "",
    funnyTruth: candidate.funnyTruth || "",
    deviceText: candidate.deviceText || "",
    artwork: await readLibraryObject(choice.artworkPath),
  });
  const garment = await softstyleType();
  const [typeRow] = await db
    .select({ merchantId: productTypes.merchantId, shop: productTypes.shopifyShopDomain })
    .from(productTypes)
    .where(eq(productTypes.id, garment.id))
    .limit(1);
  const { storage } = await import("./storage");
  const shop = String(typeRow?.shop || candidate.shopDomain);
  const installation = shop ? await storage.getShopifyInstallationByShop(shop) : null;
  const merchant = typeRow?.merchantId ? await storage.getMerchant(typeRow.merchantId) : null;
  if (!installation?.accessToken || !merchant?.printifyApiToken || !merchant.printifyShopId) {
    throw new Error("Shopify or Printify is not connected.");
  }
  const shopify = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": installation.accessToken },
    body: JSON.stringify({
      query: `mutation($product: ProductUpdateInput!) {
        productUpdate(product: $product) { product { id } userErrors { message } }
      }`,
      variables: {
        product: {
          id: `gid://shopify/Product/${candidate.shopifyProductId}`,
          descriptionHtml: listing.description,
        },
      },
    }),
  });
  const shopifyBody = await shopify.json();
  const shopifyErrors = shopifyBody?.data?.productUpdate?.userErrors || shopifyBody?.errors || [];
  if (!shopify.ok || shopifyErrors.length) {
    throw new Error(shopifyErrors.map((err: { message?: string }) => err.message).filter(Boolean).join("; ") || "Shopify description update failed");
  }
  const printify = await fetch(`https://api.printify.com/v1/shops/${merchant.printifyShopId}/products/${candidate.printifyProductId}.json`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${merchant.printifyApiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ description: listing.description }),
  });
  if (!printify.ok) {
    throw new Error(`Printify description update failed (${printify.status})`);
  }
  await db.update(designCandidates).set({
    description: listing.description,
    title: listing.title || candidate.title,
    updatedAt: new Date(),
  }).where(eq(designCandidates.id, CANDIDATE_ID));
  await recordGenerationEvent(
    { kind: "image", route: "flywheel-listing", jobId: CANDIDATE_ID },
    {
      success: true,
      durationMs: 0,
      meta: meta({ size: listing.description.slice(0, 500), durationMs: 0, estimatedCostUsd: null, providerRequestId: candidate.shopifyProductId, model: "listing" }),
    },
  );
}

const SIZE_ORDER_IDS = [
  "pending-bed-etiquette",
  "a53d9964-a554-4f08-80a4-5d3b92c502a9",
  "aa1b262b-68ad-4762-82dc-e539cf6b08bf",
];

type SizeVariantNode = {
  id: string;
  position: number;
  selectedOptions: Array<{ name: string; value: string }>;
};

/** One reorder of the three live staging products. Removed after it has run. */
async function reorderLiveCatalogueSizesOnce(): Promise<void> {
  const [done] = await db
    .select({ success: generationEvents.success })
    .from(generationEvents)
    .where(and(eq(generationEvents.route, "catalogue-size-order"), eq(generationEvents.success, true)))
    .limit(1);
  if (done) return;
  await recordGenerationEvent(
    { kind: "image", route: "catalogue-size-order", jobId: "catalogue-size-order" },
    {
      success: false,
      durationMs: 0,
      meta: meta({ size: "started", durationMs: 0, estimatedCostUsd: null, providerRequestId: null, model: "size-order" }),
    },
  );
  const rows = await db
    .select({
      id: designCandidates.id,
      shopDomain: designCandidates.shopDomain,
      shopifyProductId: designCandidates.shopifyProductId,
    })
    .from(designCandidates)
    .where(inArray(designCandidates.id, SIZE_ORDER_IDS));
  if (rows.length !== SIZE_ORDER_IDS.length || rows.some((row) => !row.shopifyProductId)) {
    throw new Error("A live catalogue product is missing its Shopify id.");
  }
  if (rows.some((row) => row.shopDomain !== "ai-art-studio-staging.myshopify.com")) {
    throw new Error("Size reorder refused outside the staging shop.");
  }
  const { storage } = await import("./storage");
  const { ensureValidOfflineAccessToken } = await import("./shopify-offline-token");
  const { compareColourThenSize, sortApparelSizeNames } = await import("@shared/flywheelPromote");
  const installation = await storage.getShopifyInstallationByShop(rows[0].shopDomain);
  if (!installation?.accessToken) throw new Error("Shopify is not connected for this shop.");
  const ready = await ensureValidOfflineAccessToken(installation);
  if (!ready.ok) throw new Error(ready.error);
  const shop = rows[0].shopDomain;
  const gql = async (query: string, variables: Record<string, unknown>) => {
    const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": ready.accessToken },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    if (!res.ok || json.errors?.length) {
      throw new Error(JSON.stringify(json.errors || res.status).slice(0, 400));
    }
    return json.data;
  };
  const lines: string[] = [];
  for (const row of rows) {
    const productId = `gid://shopify/Product/${String(row.shopifyProductId).replace(/\D/g, "")}`;
    const data = await gql(
      `query($id: ID!) {
        product(id: $id) {
          options { id name optionValues { name } }
          variants(first: 100) { pageInfo { hasNextPage } nodes { id position selectedOptions { name value } } }
        }
      }`,
      { id: productId },
    );
    if (data.product.variants.pageInfo.hasNextPage) throw new Error(`${row.id} has more than 100 variants.`);
    const sizeOption = (data.product.options || []).find((option: { name: string }) => option.name === "Size");
    const colourOption = (data.product.options || []).find((option: { name: string }) => option.name === "Color" || option.name === "Colour");
    const colourOrder = (colourOption?.optionValues || []).map((value: { name: string }) => value.name);
    const nodes = data.product.variants.nodes as SizeVariantNode[];
    const sizeOf = (node: SizeVariantNode) => node.selectedOptions.find((option) => option.name === "Size")?.value || "";
    const colourOf = (node: SizeVariantNode) => node.selectedOptions.find((option) => option.name === "Color" || option.name === "Colour")?.value || "";
    const sorted = [...nodes].sort((a, b) => compareColourThenSize(
      { colour: colourOf(a), size: sizeOf(a) },
      { colour: colourOf(b), size: sizeOf(b) },
      colourOrder,
    ));
    const reordered = await gql(
      `mutation($productId: ID!, $positions: [ProductVariantPositionInput!]!) {
        productVariantsBulkReorder(productId: $productId, positions: $positions) {
          userErrors { field message }
        }
      }`,
      { productId, positions: sorted.map((node, index) => ({ id: node.id, position: index + 1 })) },
    );
    const variantErrors = reordered.productVariantsBulkReorder?.userErrors || [];
    if (variantErrors.length) throw new Error(variantErrors.map((err: { message?: string }) => err.message).join("; "));
    const beforeSizes = (sizeOption?.optionValues || []).map((value: { name: string }) => value.name);
    const wanted = sortApparelSizeNames(beforeSizes);
    if (sizeOption && beforeSizes.join("|") !== wanted.join("|")) {
      const optionResult = await gql(
        `mutation($productId: ID!, $options: [OptionReorderInput!]!) {
          productOptionsReorder(productId: $productId, options: $options) {
            userErrors { field message }
          }
        }`,
        { productId, options: [{ id: sizeOption.id, values: wanted.map((name) => ({ name })) }] },
      );
      const optionErrors = optionResult.productOptionsReorder?.userErrors || [];
      if (optionErrors.length) throw new Error(optionErrors.map((err: { message?: string }) => err.message).join("; "));
    }
    lines.push(`${row.id} ${wanted.join(",")}`);
  }
  await recordGenerationEvent(
    { kind: "image", route: "catalogue-size-order", jobId: "catalogue-size-order" },
    {
      success: true,
      durationMs: 0,
      meta: meta({ size: lines.join(" | ").slice(0, 500), durationMs: 0, estimatedCostUsd: null, providerRequestId: null, model: "size-order" }),
    },
  );
}

/** Runs inside the staging server after listen. Production never enters. */
export async function runStagingFlywheelOnce(): Promise<void> {
  if (!stagingProcess()) return;
  try {
    await reorderLiveCatalogueSizesOnce();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[flywheel] size order:", message);
    await recordGenerationEvent(
      { kind: "image", route: "catalogue-size-order", jobId: "catalogue-size-order" },
      {
        success: false,
        durationMs: 0,
        error: err,
        meta: meta({ size: message.slice(0, 500), durationMs: 0, estimatedCostUsd: null, providerRequestId: null, model: "size-order" }),
      },
    );
  }
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
    await linkBedEtiquetteVariantMedia();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[flywheel] variant media:", message);
    await recordGenerationEvent(
      { kind: "image", route: "flywheel-variant-media", jobId: CANDIDATE_ID },
      { success: false, durationMs: 0, error: err, meta: meta({ size: message.slice(0, 1500), durationMs: 0, estimatedCostUsd: null, providerRequestId: null, model: "variant-media" }) },
    );
  }
  try {
    await linkBedEtiquetteSwatches();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[flywheel] swatches:", message);
    await recordGenerationEvent(
      { kind: "image", route: "flywheel-swatches", jobId: CANDIDATE_ID },
      { success: false, durationMs: 0, error: err, meta: meta({ size: message.slice(0, 500), durationMs: 0, estimatedCostUsd: null, providerRequestId: null, model: "swatches" }) },
    );
  }
  try {
    await rewriteBedEtiquetteListing();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[flywheel] listing:", message);
    await recordGenerationEvent(
      { kind: "image", route: "flywheel-listing", jobId: CANDIDATE_ID },
      { success: false, durationMs: 0, error: err, meta: meta({ size: message.slice(0, 500), durationMs: 0, estimatedCostUsd: null, providerRequestId: null, model: "listing" }) },
    );
  }
  try {
    await runBedEtiquettePromote();
  } catch (err) {
    console.warn("[flywheel] promote:", err instanceof Error ? err.message : String(err));
  }
}
