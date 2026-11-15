/**
 * Operator Design Studio.
 * Preview is free. Publish is the button that builds the print file and lists the product.
 */
import type { Express, RequestHandler, Response } from "express";
import { and, asc, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { abortCatalogueImport, commitCatalogueImport, decodeCataloguePng, stageCataloguePng } from "../catalogue-bulk-import";
import { draftCatalogueImage } from "../catalogue-draft";
import { planCatalogueImport, type CatalogueImportRow } from "@shared/catalogueBulkImport";
import { catalogueCandidateChoices, customizerPages, designCandidates, designProducts, mockupLibraryColours, productTypes } from "@shared/schema";
import { catalogueSpend } from "../catalogue-publish";
import { shopifyAdminProductUrl } from "@shared/cataloguePublish";
import { candidateCanBeDeleted, nextQueueId, sortOperatorQueue } from "../catalogue-queue";
import { resolveVariantFromMap, type VariantMap } from "@shared/variantMapResolve";
import { formatSizeRange, printableSizeNames, sortCatalogueColours } from "@shared/flywheelPromote";
import {
  candidateVisibleToShop,
  catalogueShopDomain,
  operatorCatalogueForShop,
  PETPOSTEROUS_CATALOGUE_SHOP,
  PETPOSTEROUS_PRODUCT_TYPE_ID,
  STAGING_CATALOGUE_SHOP,
} from "@shared/operatorCatalogue";
import { applySoftstyleCataloguePrices } from "@shared/softstyleCataloguePrices";
import { filterCatalogByPrintSides } from "@shared/shopifyVariantMatch";
import { requirePlatformAdmin } from "../platformAdmin";
import { parseMockupImport } from "@shared/mockupBundle";
import { PENDING_CANDIDATE } from "../catalogue-studio-preview";
import { registerColourBlankRoutes } from "./colour-blanks";
import { mountDesignColourRoutes } from "./design-colours";
import { findPublishedDesign } from "../design-colour-edit";
import { getProductRestCompat } from "../shopify-product-graphql";
import { storage } from "../storage";
import {
  confirmPanelUpload,
  listScenes,
  preparePanelUpload,
  candidatePrintifyArtwork,
  readChoice,
  readLibraryObject,
  recentSceneLabels,
  renderCandidateOnPanel,
  reviewStoredScene,
  saveArtwork,
  saveChoice,
  softstyleType,
  stageImportFile,
  commitStagedImport,
} from "../mockup-library-store";

/** Front Shopify variant prices for the Softstyle page. Same read promote uses. */
function parseSizes(raw: unknown): Array<{ id: string; name: string }> {
  const list = typeof raw === "string" ? JSON.parse(raw || "[]") : raw;
  if (!Array.isArray(list)) return [];
  return list
    .map((row) => ({ id: String(row?.id || "").trim(), name: String(row?.name || "").trim() }))
    .filter((row) => row.id && row.name);
}

function parseIdList(raw: string | null | undefined): string[] {
  try {
    const list = JSON.parse(raw || "[]");
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

export async function shippingPricesBySize(productTypeId?: number): Promise<{
  sizes: string[];
  pricesBySize: Record<string, string>;
  compareAtBySize: Record<string, string>;
}> {
  const empty = { sizes: [], pricesBySize: {}, compareAtBySize: {} };
  if (Number(productTypeId) === PETPOSTEROUS_PRODUCT_TYPE_ID) {
    return shopCataloguePrices(PETPOSTEROUS_CATALOGUE_SHOP, PETPOSTEROUS_PRODUCT_TYPE_ID);
  }
  const { db } = await import("../db");
  const [row] = await db
    .select({
      sizes: productTypes.sizes,
      shop: customizerPages.shop,
      baseProductId: customizerPages.baseProductId,
    })
    .from(customizerPages)
    .innerJoin(productTypes, eq(customizerPages.productTypeId, productTypes.id))
    .where(and(eq(customizerPages.handle, "softstyle-t-shirt"), eq(customizerPages.status, "active")))
    .limit(1);
  if (!row?.shop || !row.baseProductId) return empty;
  const installation = await storage.getShopifyInstallationByShop(row.shop);
  if (!installation?.accessToken) return empty;
  let parsed: Array<{ name?: string }> = [];
  try {
    const raw = JSON.parse(row.sizes || "[]");
    parsed = Array.isArray(raw) ? raw : [];
  } catch {
    parsed = [];
  }
  const prodRes = await getProductRestCompat(row.shop, installation.accessToken, row.baseProductId);
  const variants = filterCatalogByPrintSides(prodRes.data?.product?.variants || [], "front");
  const pricesBySize: Record<string, string> = {};
  const sizes: string[] = [];
  for (const size of parsed) {
    const name = String(size?.name || "").trim();
    if (!name || pricesBySize[name]) continue;
    const prices = [...new Set(
      variants
        .filter((v) => v.option1 === name && v.price)
        .map((v) => Number(v.price).toFixed(2)),
    )];
    if (prices.length !== 1) continue;
    pricesBySize[name] = prices[0];
    sizes.push(name);
  }
  const applied = applySoftstyleCataloguePrices(pricesBySize);
  return { sizes, pricesBySize: applied.pricesBySize, compareAtBySize: applied.compareAtBySize };
}

/** Prices already on this shop's studio product. The Softstyle table is not applied. */
async function shopCataloguePrices(shop: string, productTypeId: number): Promise<{
  sizes: string[];
  pricesBySize: Record<string, string>;
  compareAtBySize: Record<string, string>;
}> {
  const empty = { sizes: [], pricesBySize: {}, compareAtBySize: {} };
  const { db } = await import("../db");
  const [row] = await db
    .select({
      sizes: productTypes.sizes,
      shop: customizerPages.shop,
      baseProductId: customizerPages.baseProductId,
    })
    .from(customizerPages)
    .innerJoin(productTypes, eq(customizerPages.productTypeId, productTypes.id))
    .where(and(
      eq(customizerPages.shop, shop),
      eq(customizerPages.productTypeId, productTypeId),
      eq(customizerPages.status, "active"),
    ))
    .limit(1);
  if (!row?.shop || !row.baseProductId) return empty;
  const installation = await storage.getShopifyInstallationByShop(row.shop);
  if (!installation?.accessToken) return empty;
  let parsed: Array<{ name?: string }> = [];
  try {
    const raw = JSON.parse(row.sizes || "[]");
    parsed = Array.isArray(raw) ? raw : [];
  } catch {
    parsed = [];
  }
  const prodRes = await getProductRestCompat(row.shop, installation.accessToken, row.baseProductId);
  const variants = filterCatalogByPrintSides(prodRes.data?.product?.variants || [], "front");
  const pricesBySize: Record<string, string> = {};
  const sizes: string[] = [];
  for (const size of parsed) {
    const name = String(size?.name || "").trim();
    if (!name || pricesBySize[name]) continue;
    const prices = [...new Set(
      variants
        .filter((v) => v.option1 === name && v.price)
        .map((v) => Number(v.price).toFixed(2)),
    )];
    if (prices.length !== 1) continue;
    pricesBySize[name] = prices[0];
    sizes.push(name);
  }
  return { sizes, pricesBySize, compareAtBySize: {} };
}

const STAGING_SHOP = STAGING_CATALOGUE_SHOP;

function parseCandidateId(value: unknown): { id: string } | { error: string } {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id) return { id: "" };
  if (id === PENDING_CANDIDATE.id) return { id };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return { id };
  return { error: "Unknown candidate." };
}

async function readCandidateRow(id: string) {
  const { db } = await import("../db");
  const [row] = await db.select().from(designCandidates).where(eq(designCandidates.id, id)).limit(1);
  return row ?? null;
}

async function listedCandidateIds(shop: string): Promise<string[]> {
  const { db } = await import("../db");
  const rows = await db
    .select({ jobId: designProducts.jobId })
    .from(designProducts)
    .where(and(eq(designProducts.shop, shop), isNotNull(designProducts.jobId)));
  return rows.map((row) => String(row.jobId || "")).filter(Boolean);
}

/** Petposterous can open a design that was published onto its shop. */
async function candidateOwnedOrListed(
  requestShop: string | null | undefined,
  row: { id: string; shopDomain: string | null },
): Promise<boolean> {
  if (candidateVisibleToShop(requestShop, row.shopDomain)) return true;
  const profile = operatorCatalogueForShop(requestShop);
  if (profile.shop !== PETPOSTEROUS_CATALOGUE_SHOP) return false;
  return (await listedCandidateIds(profile.shop)).includes(row.id);
}

async function operatorQueue(requestShop: string | null | undefined): Promise<Array<{ id: string; title: string }>> {
  const profile = operatorCatalogueForShop(requestShop);
  const { db } = await import("../db");
  const listed = profile.shop === PETPOSTEROUS_CATALOGUE_SHOP ? await listedCandidateIds(profile.shop) : [];
  const ownWork = and(
    eq(designCandidates.shopDomain, profile.shop),
    isNotNull(designCandidates.artworkPath),
    ne(designCandidates.artworkPath, ""),
    or(
      eq(designCandidates.status, "pending"),
      and(eq(designCandidates.status, "approved"), isNull(designCandidates.shopifyProductId)),
    ),
  );
  const rows = await db
    .select({
      id: designCandidates.id,
      status: designCandidates.status,
      createdAt: designCandidates.createdAt,
      title: designCandidates.title,
      punchline: designCandidates.punchline,
    })
    .from(designCandidates)
    .where(listed.length ? or(ownWork, inArray(designCandidates.id, listed)) : ownWork);
  return sortOperatorQueue(rows).map((row) => ({
    id: row.id,
    title: String(row.title || row.punchline || "").trim(),
  }));
}

async function resolveStudioCandidateId(value: unknown, requestShop: string | null | undefined): Promise<{ id: string } | { error: string }> {
  const parsed = parseCandidateId(value);
  if ("error" in parsed || parsed.id) return parsed;
  const queue = await operatorQueue(requestShop);
  return { id: queue[0]?.id || PENDING_CANDIDATE.id };
}

async function candidateIdFor(res: Response, value: unknown, requestShop: string | null | undefined): Promise<string | null> {
  const resolved = await resolveStudioCandidateId(value, requestShop);
  if ("error" in resolved) {
    res.status(400).json({ error: resolved.error });
    return null;
  }
  if (resolved.id !== PENDING_CANDIDATE.id) {
    const row = await readCandidateRow(resolved.id);
    if (!row || !(await candidateOwnedOrListed(requestShop, row))) {
      res.status(404).json({ error: "That candidate is not stored." });
      return null;
    }
  }
  return resolved.id;
}

/** Softstyle unless the operator picked another product type. Petposterous stays on its own types. */
async function studioGarment(raw: unknown, requestShop: string | null | undefined): Promise<{ id: number; name: string }> {
  const profile = operatorCatalogueForShop(requestShop);
  const id = Number(raw);
  const { db } = await import("../db");
  if (Number.isInteger(id) && id > 0) {
    const [row] = await db
      .select({ id: productTypes.id, name: productTypes.name, shop: productTypes.shopifyShopDomain })
      .from(productTypes)
      .where(eq(productTypes.id, id))
      .limit(1);
    if (row && (profile.shop !== PETPOSTEROUS_CATALOGUE_SHOP || catalogueShopDomain(row.shop) === profile.shop)) {
      return { id: row.id, name: row.name };
    }
  }
  if (profile.shop === PETPOSTEROUS_CATALOGUE_SHOP) {
    const [row] = await db
      .select({ id: productTypes.id, name: productTypes.name })
      .from(productTypes)
      .where(eq(productTypes.id, profile.defaultProductTypeId))
      .limit(1);
    return { id: row?.id ?? profile.defaultProductTypeId, name: row?.name || "Softstyle" };
  }
  return softstyleType();
}

function frameColourList(raw: unknown): Array<{ name: string; hex: string }> {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw || "[]");
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const colours: Array<{ name: string; hex: string }> = [];
  for (const row of list) {
    const name = String((row as { name?: string })?.name || "").trim();
    const hex = String((row as { hex?: string })?.hex || "").replace(/^#/, "").trim();
    if (!name || !hex) continue;
    colours.push({ name, hex });
  }
  return colours;
}

async function libraryColoursFor(productTypeId: number): Promise<Array<{ name: string; hex: string }>> {
  const { blankLibraryTypeId, ensureColourBlankTable } = await import("../colour-blanks");
  const libraryId = await blankLibraryTypeId(productTypeId);
  if (libraryId === 54) return [];
  const { db } = await import("../db");
  await ensureColourBlankTable();
  productTypeId = libraryId;
  const rows = await db
    .select({ name: mockupLibraryColours.name, hex: mockupLibraryColours.hex })
    .from(mockupLibraryColours)
    .where(and(
      eq(mockupLibraryColours.productTypeId, productTypeId),
      eq(mockupLibraryColours.active, true),
    ))
    .orderBy(asc(mockupLibraryColours.sortOrder), asc(mockupLibraryColours.name));
  return rows.map((row) => ({ name: row.name, hex: row.hex }));
}

async function studioScenes(productTypeId: number) {
  const { colourMatchKeys } = await import("@shared/colourBlanks");
  const { blankLibraryTypeId, inactiveColourKeys } = await import("../colour-blanks");
  const libraryId = await blankLibraryTypeId(productTypeId);
  const [scenes, hidden] = await Promise.all([listScenes(libraryId), inactiveColourKeys(libraryId)]);
  if (!hidden.size) return scenes;
  return scenes.map((scene) => ({
    ...scene,
    colours: scene.colours.filter((colour) => !colourMatchKeys(colour.name).some((key) => hidden.has(key))),
  }));
}

export function registerCatalogueStudioRoutes(app: Express, deps: { isAuthenticated: RequestHandler }) {
  const { isAuthenticated } = deps;
  registerColourBlankRoutes(app, deps);

  app.get("/api/platform/catalogue-studio/panels", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const garment = await studioGarment(req.query.productTypeId, req.shopDomain);
      res.json({ scenes: await studioScenes(garment.id), productTypeId: garment.id, productTypeName: garment.name });
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get("/api/platform/catalogue-studio/pending", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const resolved = await resolveStudioCandidateId(req.query.candidate, req.shopDomain);
      if ("error" in resolved) {
        res.status(400).json({ error: resolved.error });
        return;
      }
      const id = resolved.id;
      const { db } = await import("../db");
      const { prepareColourBlanks } = await import("../colour-blanks");
      const profile = operatorCatalogueForShop(req.shopDomain);
      const garment = await studioGarment(req.query.productTypeId, req.shopDomain);
      await prepareColourBlanks(garment.id);
      const [prices, scenes, choice, recentScenes, stored, queue, blankColours, typeList] = await Promise.all([
        shippingPricesBySize(garment.id),
        studioScenes(garment.id),
        readChoice(id),
        recentSceneLabels(),
        readCandidateRow(id),
        operatorQueue(req.shopDomain),
        libraryColoursFor(garment.id),
        db.select({ id: productTypes.id, name: productTypes.name, shop: productTypes.shopifyShopDomain }).from(productTypes).orderBy(asc(productTypes.id)),
      ]);
      if (id !== PENDING_CANDIDATE.id && (!stored || !(await candidateOwnedOrListed(req.shopDomain, stored)))) {
        res.status(404).json({ error: "That candidate is not stored." });
        return;
      }
      const visibleTypes = profile.shop === PETPOSTEROUS_CATALOGUE_SHOP
        ? typeList.filter((row) => catalogueShopDomain(row.shop) === profile.shop)
        : typeList;
      const nextCandidateId = nextQueueId(queue.map((row) => row.id), id);
      const fixture = id === PENDING_CANDIDATE.id;
      const [typeRow] = await db
        .select({
          sizes: productTypes.sizes,
          selectedSizeIds: productTypes.selectedSizeIds,
          variantMap: productTypes.variantMap,
          frameColors: productTypes.frameColors,
          shop: productTypes.shopifyShopDomain,
          merchantId: productTypes.merchantId,
        })
        .from(productTypes)
        .where(eq(productTypes.id, garment.id))
        .limit(1);
      const sizeRows = parseSizes(typeRow?.sizes);
      const selectedIds = parseIdList(typeRow?.selectedSizeIds);
      const offered = selectedIds.length ? sizeRows.filter((size) => selectedIds.includes(size.id)) : sizeRows;
      let variantMap = {};
      try {
        variantMap = JSON.parse(typeRow?.variantMap || "{}");
      } catch {
        variantMap = {};
      }
      const colourByName = new Map<string, { name: string; hex: string }>();
      for (const scene of scenes) {
        for (const color of scene.colours) colourByName.set(color.name, { name: color.name, hex: color.hex });
      }
      const sceneColours = sortCatalogueColours([...colourByName.values()]);
      const studioColours = fixture && garment.id === 54
        ? PENDING_CANDIDATE.colors
        : blankColours.length ? sortCatalogueColours(blankColours) : sceneColours;
      const colourTickMode = String(typeRow?.shop || "") === PETPOSTEROUS_CATALOGUE_SHOP ? "all" : "stored";
      const frameColours = colourTickMode === "all" ? frameColourList(typeRow?.frameColors) : [];
      const coloursForStudio = frameColours.length ? frameColours : studioColours;
      const colourSizes: Record<string, string> = {};
      const offeredNames = offered.map((size) => size.name);
      for (const color of coloursForStudio) {
        colourSizes[color.name] = formatSizeRange(offeredNames, printableSizeNames(variantMap, color, offered));
      }
      let eligibility = null;
      if (choice.artworkPath && coloursForStudio.length) {
        try {
          const artwork = await readLibraryObject(choice.artworkPath);
          const { measureColourEligibility } = await import("../catalogue-studio-eligibility");
          eligibility = await measureColourEligibility(artwork, coloursForStudio);
        } catch (err) {
          console.error("[catalogue-studio] eligibility:", (err as Error).message);
        }
      }
      const filename = (stored?.artworkPath || choice.artworkPath || "").split("/").pop() || "";
      const { cataloguePrintifyMerchant } = await import("../operatorCatalogue");
      const printifyMerchant = await cataloguePrintifyMerchant(typeRow?.merchantId, typeRow?.shop || profile.shop);
      const spend = await catalogueSpend(id);
      const productUrl = stored?.shopifyProductId
        ? shopifyAdminProductUrl(stored.shopDomain || STAGING_SHOP, stored.shopifyProductId)
        : null;
      res.json({
        id,
        status: stored?.status || PENDING_CANDIDATE.status,
        dropReason: stored?.dropReason || "",
        canDelete: candidateCanBeDeleted({
          status: stored?.status,
          artworkPath: stored?.artworkPath,
          choiceArtworkPath: choice.artworkPath,
          printFilePath: stored?.printFilePath,
          shopifyProductId: stored?.shopifyProductId,
          printifyProductId: stored?.printifyProductId,
        }),
        title: fixture ? stored?.title || PENDING_CANDIDATE.title : stored?.title || "",
        description: stored?.description || "",
        shopifyProductId: stored?.shopifyProductId || null,
        productUrl,
        spendUsd: spend.totalUsd,
        spendLines: spend.lines,
        colors: coloursForStudio,
        colourTickMode,
        selectedColor: fixture && garment.id === 54 ? PENDING_CANDIDATE.selectedColor : coloursForStudio[0]?.name || "White",
        productTypes: visibleTypes.map((row) => ({ id: row.id, name: row.name })),
        catalogueShop: profile.shop,
        printifyShopId: printifyMerchant?.printifyShopId || null,
        selectedSize: "L",
        ...prices,
        eligibility,
        colourSizes,
        productTypeId: garment.id,
        productTypeName: garment.name,
        scenes,
        choice,
        recentScenes,
        pendingCount: queue.length,
        nextCandidateId,
        recipe: fixture || !stored ? null : {
          artStyle: stored.artStyle,
          species: stored.species,
          humourOperator: stored.humourOperator,
          funnyTruth: stored.funnyTruth,
          deviceText: stored.deviceText,
          punchline: stored.punchline || "",
          behaviour: stored.behaviour,
          deviceStructure: stored.deviceStructure,
          darknessLevel: stored.darknessLevel,
          filename,
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get("/api/platform/catalogue-studio/pending-preview", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const requested = typeof req.query.color === "string" ? req.query.color : PENDING_CANDIDATE.selectedColor;
      const panelId = typeof req.query.panelId === "string" ? req.query.panelId : "";
      if (!panelId) {
        res.status(400).json({ error: "Choose a scene." });
        return;
      }
      const id = await candidateIdFor(res, req.query.candidate, req.shopDomain);
      if (!id) return;
      const garment = await studioGarment(req.query.productTypeId, req.shopDomain);
      const library = await libraryColoursFor(garment.id);
      const known = library.find((c) => c.name.toLowerCase() === requested.toLowerCase())
        ?? PENDING_CANDIDATE.colors.find((c) => c.name === requested)
        ?? { name: requested, hex: "FFFFFF" };
      const choice = await readChoice(id);
      if (!String(choice.artworkPath || "").trim()) {
        res.status(204).end();
        return;
      }
      const { png, source } = await renderCandidateOnPanel({
        productTypeId: garment.id,
        typeName: garment.name,
        panelId,
        colorName: known.name,
        colorHex: known.hex,
        artworkPath: choice.artworkPath,
      });
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Mockup-Source", source);
      res.send(png);
    } catch (e: any) {
      const message = String(e?.message || e);
      if (/artwork is not stored/i.test(message)) {
        res.status(204).end();
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/platform/catalogue-studio/printify-preview", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const panelId = String(req.body?.panelId || "");
      const colorName = String(req.body?.color || "");
      const size = String(req.body?.size || "L");
      if (!panelId) {
        res.status(400).json({ error: "Choose a scene." });
        return;
      }
      const { db } = await import("../db");
      const garment = await studioGarment(req.body?.productTypeId, req.shopDomain);
      const [typeRow] = await db.select().from(productTypes).where(eq(productTypes.id, garment.id)).limit(1);
      if (!typeRow?.printifyBlueprintId || !typeRow.printifyProviderId || !typeRow.merchantId) {
        res.status(400).json({ error: "This product type has no Printify blueprint." });
        return;
      }
      const { cataloguePrintifyMerchant } = await import("../operatorCatalogue");
      const { operatorCatalogueForShop: printifyProfileFor } = await import("@shared/operatorCatalogue");
      const merchant = await cataloguePrintifyMerchant(typeRow.merchantId, typeRow.shopifyShopDomain);
      const expectedPrintifyShop = printifyProfileFor(typeRow.shopifyShopDomain).printifyShopId;
      if (!merchant?.printifyApiToken || !merchant.printifyShopId) {
        res.status(400).json({ error: "Printify is not connected on this product type." });
        return;
      }
      if (expectedPrintifyShop && String(merchant.printifyShopId) !== expectedPrintifyShop) {
        res.status(400).json({ error: `Printify shop ${expectedPrintifyShop} is not connected for this store.` });
        return;
      }
      const id = await candidateIdFor(res, req.body?.candidateId, req.shopDomain);
      if (!id) return;
      const library = await libraryColoursFor(garment.id);
      const known = library.find((c) => c.name.toLowerCase() === colorName.toLowerCase())
        ?? PENDING_CANDIDATE.colors.find((c) => c.name === colorName)
        ?? { name: colorName, hex: "FFFFFF" };
      const choice = await readChoice(id);
      const artwork = await candidatePrintifyArtwork({
        productTypeId: garment.id,
        typeName: garment.name,
        panelId,
        colorName: known.name,
        colorHex: known.hex,
        artworkPath: choice.artworkPath,
      });
      let variantMap: VariantMap = {};
      try {
        variantMap = JSON.parse(typeRow.variantMap || "{}");
      } catch {
        variantMap = {};
      }
      const colorId = known.name.toLowerCase().replace(/\s+/g, "-");
      const resolved = resolveVariantFromMap(variantMap, size, colorId, { allowSizeFallbackForColor: true });
      if (!resolved?.entry.printifyVariantId) {
        res.status(400).json({ error: `${known.name} has no Printify variant on ${garment.name}.` });
        return;
      }
      const { generatePrintifyMockup } = await import("../printify-mockups");
      const result = await generatePrintifyMockup({
        blueprintId: typeRow.printifyBlueprintId,
        providerId: typeRow.printifyProviderId,
        variantId: Number(resolved.entry.printifyVariantId),
        imageUrl: `data:image/png;base64,${artwork.png.toString("base64")}`,
        printifyApiToken: merchant.printifyApiToken,
        printifyShopId: merchant.printifyShopId,
        x: artwork.x,
        y: artwork.y,
        scale: artwork.scale,
        printPlacement: "front",
        internalProductTitle: `Mockup Preview - ${Date.now()}`,
        internalProductDescription: "Temporary product for mockup generation - will be deleted immediately",
      });
      if (!result.success || !result.mockupImages.length) {
        res.status(502).json({ error: result.error || "Printify did not return a mockup." });
        return;
      }
      const front = result.mockupImages.find((image) => /front/i.test(image.label)) ?? result.mockupImages[0];
      res.json({
        mockupUrl: front.url,
        label: front.label,
        note: "placement preview, not print resolution",
      });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.get("/api/platform/catalogue-studio/panels/review", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const panelId = typeof req.query.panelId === "string" ? req.query.panelId : "";
      if (!panelId.trim()) {
        res.status(400).json({ error: "Name the scene." });
        return;
      }
      const garment = await studioGarment(req.query.productTypeId, req.shopDomain);
      const cells = await reviewStoredScene(garment.id, panelId);
      res.json({ productTypeId: garment.id, productTypeName: garment.name, panelId, cells });
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/panels/import/plan", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    const paths = Array.isArray(req.body?.paths) ? req.body.paths.map((path: unknown) => String(path)) : [];
    const garment = await studioGarment(req.body?.productTypeId, req.shopDomain);
    res.json({ ...parseMockupImport(paths), productTypeId: garment.id, productTypeName: garment.name });
  });

  app.post("/api/platform/catalogue-studio/panels/import/file", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const body = req.body ?? {};
      const garment = await studioGarment(body.productTypeId, req.shopDomain);
      const result = await stageImportFile({
        label: String(body.label || ""),
        panelId: body.panelId ? String(body.panelId) : null,
        garmentColor: String(body.garmentColor || ""),
        garmentHex: String(body.garmentHex || ""),
        kind: body.kind === "white-master" ? "white-master" : "produced",
        isDefault: body.isDefault === true,
        imageBase64: String(body.imageBase64 || ""),
      });
      res.json({ ...result, productTypeId: garment.id, productTypeName: garment.name });
    } catch (e: any) {
      const message = String(e?.message || e);
      const failed = req.body ?? {};
      console.error(`[mockup-import] ${String(failed.panelId || "")} ${String(failed.garmentHex || "")} failed: ${message}`);
      res.status(400).json({
        error: message,
        areaFraction: e?.areaFraction,
        touchesEdge: e?.touchesEdge,
        disconnected: e?.disconnected,
        outlineJpegBase64: e?.outlineJpegBase64,
      });
    }
  });

  app.post("/api/platform/catalogue-studio/panels/import/commit", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const garment = await studioGarment(req.body?.productTypeId, req.shopDomain);
      const stageIds = Array.isArray(req.body?.stageIds) ? req.body.stageIds.map((id: unknown) => String(id)) : [];
      const result = await commitStagedImport(garment.id, stageIds, req.user?.id ? String(req.user.id) : null);
      res.json({ ...result, productTypeId: garment.id, productTypeName: garment.name });
    } catch (e: any) {
      const message = String(e?.message || e);
      console.error(`[mockup-import] commit failed: ${message}`);
      res.status(400).json({ error: message });
    }
  });

  app.post("/api/platform/catalogue-studio/panels/prepare", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const body = req.body ?? {};
      const garment = await studioGarment(body.productTypeId, req.shopDomain);
      const result = await preparePanelUpload({
        productTypeId: garment.id,
        label: String(body.label || ""),
        panelId: body.panelId ? String(body.panelId) : null,
        garmentColor: String(body.garmentColor || ""),
        garmentHex: String(body.garmentHex || ""),
        kind: body.kind === "white-master" ? "white-master" : "produced",
        isDefault: body.isDefault === true,
        imageBase64: String(body.imageBase64 || ""),
        uploadedBy: req.user?.id ? String(req.user.id) : null,
        forceConfirm: body.forceConfirm === true,
      });
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/panels/confirm", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const result = await confirmPanelUpload(String(req.body?.uploadId || ""), String(req.body?.maskPngBase64 || ""));
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/choice", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const id = await candidateIdFor(res, req.body?.candidateId, req.shopDomain);
      if (!id) return;
      const colors = Array.isArray(req.body?.selectedColors) ? req.body.selectedColors : [];
      await saveChoice(
        id,
        req.body?.panelId ? String(req.body.panelId) : null,
        colors.map((c: { name?: string; hex?: string }) => ({ name: String(c?.name || ""), hex: String(c?.hex || "").replace(/^#/, "") })),
      );
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/artwork", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const id = await candidateIdFor(res, req.body?.candidateId, req.shopDomain);
      if (!id) return;
      await saveArtwork(id, String(req.body?.imageBase64 || ""));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/drop", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    if (process.env.RAILWAY_ENVIRONMENT_NAME === "production") {
      res.status(400).json({ error: "Catalogue studio changes are staging only." });
      return;
    }
    try {
      const reason = String(req.body?.dropReason || "").trim();
      if (!reason) {
        res.status(400).json({ error: "Write a reason." });
        return;
      }
      const id = await candidateIdFor(res, req.body?.candidateId, req.shopDomain);
      if (!id) return;
      const row = await readCandidateRow(id);
      const profile = operatorCatalogueForShop(req.shopDomain);
      if (!row || catalogueShopDomain(row.shopDomain) !== profile.shop) {
        res.status(404).json({ error: "That candidate is not stored." });
        return;
      }
      if (row.status !== "pending" && row.status !== "dropped") {
        res.status(400).json({ error: "Only a pending candidate can be dropped." });
        return;
      }
      const queue = await operatorQueue(req.shopDomain);
      const nextCandidateId = nextQueueId(queue.map((item) => item.id), id);
      if (row.status !== "dropped") {
        const { db } = await import("../db");
        await db
          .update(designCandidates)
          .set({ status: "dropped", dropReason: reason, updatedAt: new Date() })
          .where(and(eq(designCandidates.id, id), eq(designCandidates.shopDomain, profile.shop)));
      }
      res.json({ ok: true, status: "dropped", nextCandidateId });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/delete", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    if (process.env.RAILWAY_ENVIRONMENT_NAME === "production") {
      res.status(400).json({ error: "Catalogue studio changes are staging only." });
      return;
    }
    try {
      const id = await candidateIdFor(res, req.body?.candidateId, req.shopDomain);
      if (!id) return;
      if (id === PENDING_CANDIDATE.id) {
        res.status(400).json({ error: "This candidate is not deleted from the studio." });
        return;
      }
      const [row, choice] = await Promise.all([readCandidateRow(id), readChoice(id)]);
      const profile = operatorCatalogueForShop(req.shopDomain);
      if (!row || catalogueShopDomain(row.shopDomain) !== profile.shop) {
        res.status(404).json({ error: "That candidate is not stored." });
        return;
      }
      if (!candidateCanBeDeleted({
        status: row.status,
        artworkPath: row.artworkPath,
        choiceArtworkPath: choice.artworkPath,
        printFilePath: row.printFilePath,
        shopifyProductId: row.shopifyProductId,
        printifyProductId: row.printifyProductId,
      })) {
        res.status(400).json({ error: "Only a pending candidate with no artwork can be deleted." });
        return;
      }
      const queue = await operatorQueue(req.shopDomain);
      const nextCandidateId = nextQueueId(queue.map((item) => item.id), id);
      const { db } = await import("../db");
      await db.transaction(async (tx) => {
        await tx.delete(catalogueCandidateChoices).where(eq(catalogueCandidateChoices.candidateId, id));
        await tx.delete(designCandidates).where(and(eq(designCandidates.id, id), eq(designCandidates.shopDomain, profile.shop)));
      });
      res.json({ ok: true, nextCandidateId });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/approve", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { approveCatalogueCandidate } = await import("../flywheel-approve");
      const id = await candidateIdFor(res, req.body?.candidateId, req.shopDomain);
      if (!id) return;
      const colors = Array.isArray(req.body?.selectedColors) ? req.body.selectedColors : [];
      const result = await approveCatalogueCandidate({
        candidateId: id,
        panelId: String(req.body?.panelId || ""),
        selectedColors: colors.map((c: { name?: string; hex?: string }) => ({ name: String(c?.name || ""), hex: String(c?.hex || "").replace(/^#/, "") })),
        artStyle: String(req.body?.artStyle || ""),
        species: String(req.body?.species || ""),
        humourOperator: String(req.body?.humourOperator || ""),
        punchline: String(req.body?.punchline || req.body?.wording || ""),
        behaviour: String(req.body?.behaviour || ""),
        funnyTruth: String(req.body?.funnyTruth || ""),
        deviceText: String(req.body?.deviceText || ""),
        deviceStructure: String(req.body?.deviceStructure || ""),
        darknessLevel: Number(req.body?.darknessLevel),
        title: String(req.body?.title || (id === PENDING_CANDIDATE.id ? PENDING_CANDIDATE.title : "")),
        productTypeId: Number(req.body?.productTypeId) || undefined,
      });
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.get("/api/platform/catalogue-studio/products", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { db } = await import("../db");
      const { asc } = await import("drizzle-orm");
      const rows = await db
        .select({
          id: designProducts.id,
          title: designProducts.title,
          shopifyProductId: designProducts.shopifyProductId,
          myPetEnabled: designProducts.myPetEnabled,
        })
        .from(designProducts)
        .where(eq(designProducts.shop, operatorCatalogueForShop(req.shopDomain).shop))
        .orderBy(asc(designProducts.title));
      res.json({ products: rows });
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/my-pet", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    if (process.env.RAILWAY_ENVIRONMENT_NAME === "production") {
      res.status(400).json({ error: "Catalogue studio changes are staging only." });
      return;
    }
    const enabled = req.body?.enabled;
    const designProductId = String(req.body?.designProductId || "");
    if (typeof enabled !== "boolean" || !designProductId) {
      res.status(400).json({ error: "designProductId and enabled are required." });
      return;
    }
    try {
      const { db } = await import("../db");
      const shop = operatorCatalogueForShop(req.shopDomain).shop;
      const [row] = await db
        .select()
        .from(designProducts)
        .where(and(eq(designProducts.id, designProductId), eq(designProducts.shop, shop)))
        .limit(1);
      if (!row?.shopifyProductId) {
        res.status(404).json({ error: "That catalogue product is not listed." });
        return;
      }
      const installation = await storage.getShopifyInstallationByShop(shop);
      if (!installation?.accessToken) {
        res.status(409).json({ error: "Shopify token is not stored for this store." });
        return;
      }
      const { setProductMyPetEnabled } = await import("../my-pet-metafields");
      await setProductMyPetEnabled(shop, installation.accessToken, row.shopifyProductId, enabled);
      await db.update(designProducts).set({
        myPetEnabled: enabled,
        updatedAt: new Date(),
      }).where(eq(designProducts.id, row.id));
      res.json({ ok: true, id: row.id, myPetEnabled: enabled });
    } catch (e: any) {
      res.status(502).json({ error: String(e?.message || e) });
    }
  });

  app.get("/api/platform/catalogue-studio/jobs", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { listCatalogueJobQueue } = await import("../catalogue-publish-jobs");
      const queue = await listCatalogueJobQueue(await operatorQueue(req.shopDomain));
      res.json({ queue });
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/publish", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    if (process.env.RAILWAY_ENVIRONMENT_NAME === "production") {
      res.status(400).json({ error: "Catalogue publish is staging only.", reasons: ["Catalogue publish is staging only."] });
      return;
    }
    const id = await candidateIdFor(res, req.body?.candidateId, req.shopDomain);
    if (!id) return;
    try {
      const stored = await readCandidateRow(id);
      if (stored?.shopifyProductId) {
        res.json({ id, phase: "done", label: "Done", error: "" });
        return;
      }
      const { enqueueCataloguePublish } = await import("../catalogue-publish-jobs");
      const colors = Array.isArray(req.body?.selectedColors) ? req.body.selectedColors : [];
      const job = await enqueueCataloguePublish({
        candidateId: id,
        panelId: String(req.body?.panelId || ""),
        selectedColors: sortCatalogueColours(colors.map((c: { name?: string; hex?: string }) => ({
          name: String(c?.name || ""),
          hex: String(c?.hex || "").replace(/^#/, ""),
        }))).filter((color) => color.name),
        artStyle: String(req.body?.artStyle || ""),
        species: String(req.body?.species || ""),
        humourOperator: String(req.body?.humourOperator || ""),
        punchline: String(req.body?.punchline || req.body?.wording || ""),
        behaviour: String(req.body?.behaviour || ""),
        funnyTruth: String(req.body?.funnyTruth || ""),
        deviceText: String(req.body?.deviceText || ""),
        deviceStructure: String(req.body?.deviceStructure || ""),
        darknessLevel: Number(req.body?.darknessLevel),
        title: String(req.body?.title || (id === PENDING_CANDIDATE.id ? PENDING_CANDIDATE.title : "")),
        productTypeId: Number(req.body?.productTypeId) || undefined,
      });
      res.json(job);
    } catch (e: any) {
      const { PublishRefusal } = await import("../catalogue-publish");
      const reasons = e instanceof PublishRefusal && e.reasons.length
        ? e.reasons
        : [String(e?.message || e)];
      res.status(400).json({ error: reasons.join("\n"), reasons });
    }
  });

  app.post("/api/platform/catalogue-studio/reorder-colours", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    if (process.env.RAILWAY_ENVIRONMENT_NAME === "production") {
      res.status(400).json({ error: "Catalogue colour order is staging only." });
      return;
    }
    try {
      if (operatorCatalogueForShop(req.shopDomain).shop !== STAGING_SHOP) {
        res.status(400).json({ error: "Colour reorder stays on the staging catalogue." });
        return;
      }
      const { reorderStagingCatalogueColours } = await import("../catalogue-colour-order");
      const products = await reorderStagingCatalogueColours();
      res.json({ products });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/promote", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { promoteCatalogueCandidate } = await import("../flywheel-promote");
      const garment = await studioGarment(req.body?.productTypeId, req.shopDomain);
      const prices = await shippingPricesBySize(garment.id);
      const id = await candidateIdFor(res, req.body?.candidateId, req.shopDomain);
      if (!id) return;
      const result = await promoteCatalogueCandidate({
        candidateId: id,
        publishNow: req.body?.publishNow !== false,
        productTypeId: garment.id,
        pricesBySize: prices.pricesBySize,
        compareAtBySize: prices.compareAtBySize,
      });
      res.json(result);
    } catch (e: any) {
      const status = e?.status === 409 || e?.name === "PromoteRefusal" ? 409 : 400;
      const reasons = Array.isArray(e?.reasons) && e.reasons.length
        ? e.reasons.map((reason: unknown) => String(reason || "").trim()).filter(Boolean)
        : [String(e?.message || e)];
      res.status(status).json({ error: reasons.join("\n"), reasons });
    }
  });

  app.post("/api/platform/catalogue-studio/candidates/import/plan", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    const csv = typeof req.body?.csv === "string" ? req.body.csv : "";
    const filenames = Array.isArray(req.body?.filenames) ? req.body.filenames.map((name: unknown) => String(name)) : [];
    res.json(planCatalogueImport({ csv, filenames }));
  });

  app.post("/api/platform/catalogue-studio/candidates/import/draft", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    if (process.env.RAILWAY_ENVIRONMENT_NAME === "production") {
      res.status(400).json({ error: "Catalogue import is staging only." });
      return;
    }
    try {
      const filename = String(req.body?.filename || "image.png");
      const png = decodeCataloguePng(filename, String(req.body?.imageBase64 || ""));
      const draft = await draftCatalogueImage(png);
      res.json(draft);
    } catch (e: any) {
      res.status(e?.status || 400).json({
        error: String(e?.message || e),
        costUsd: typeof e?.costUsd === "number" ? e.costUsd : null,
        inputTokens: Number(e?.inputTokens) || 0,
        outputTokens: Number(e?.outputTokens) || 0,
        model: String(e?.model || ""),
      });
    }
  });

  app.post("/api/platform/catalogue-studio/candidates/import/file", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      await stageCataloguePng(String(req.body?.batchId || ""), String(req.body?.filename || ""), String(req.body?.imageBase64 || ""), req.shopDomain);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/candidates/import/commit", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const filenames = Array.isArray(req.body?.filenames) ? req.body.filenames.map((name: unknown) => String(name)) : [];
      const rows = Array.isArray(req.body?.rows)
        ? req.body.rows.map((row: Partial<CatalogueImportRow>, index: number): CatalogueImportRow => ({
          rowNumber: Number(row?.rowNumber) || index + 1,
          filename: String(row?.filename || ""),
          style: String(row?.style || ""),
          species: String(row?.species || ""),
          humourOperator: String(row?.humourOperator || ""),
          truth: String(row?.truth || ""),
          device: String(row?.device || ""),
          exactWording: String(row?.exactWording || ""),
          source: row?.source === "csv" ? "csv" : "draft",
          lowConfidence: { style: false, humourOperator: false },
        }))
        : [];
      const result = await commitCatalogueImport({
        batchId: String(req.body?.batchId || ""),
        filenames,
        rows,
        shop: req.shopDomain,
      });
      if (result.failures.length) {
        res.status(400).json(result);
        return;
      }
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ created: 0, firstId: "", studioPath: "", failures: [String(e?.message || e)] });
    }
  });

  app.post("/api/platform/catalogue-studio/candidates/import/abort", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    const filenames = Array.isArray(req.body?.filenames) ? req.body.filenames.map((name: unknown) => String(name)) : [];
    await abortCatalogueImport(String(req.body?.batchId || ""), filenames);
    res.json({ ok: true });
  });

  app.get("/api/platform/catalogue-studio/design-colours", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const candidateId = String(req.query.candidateId || "");
      const productTypeId = Number(req.query.productTypeId);
      if (!candidateId || !Number.isInteger(productTypeId)) {
        res.status(400).json({ error: "candidateId and productTypeId are required." });
        return;
      }
      const designProductId = await findPublishedDesign(candidateId, productTypeId);
      res.json({ designProductId });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  mountDesignColourRoutes(app, "/api/platform/catalogue-studio/design-products", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return null;
    const profile = operatorCatalogueForShop(req.shopDomain);
    return profile.shop === PETPOSTEROUS_CATALOGUE_SHOP ? profile.shop : undefined;
  }, [isAuthenticated]);
}
