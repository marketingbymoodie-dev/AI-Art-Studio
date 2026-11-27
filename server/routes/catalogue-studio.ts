/**
 * Operator Design Studio.
 * Preview is free. Publish is the button that builds the print file and lists the product.
 */
import type { Express, RequestHandler, Response } from "express";
import { and, asc, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { abortCatalogueImport, assertCatalogueImportShop, clearCreatedCatalogueImportRows, commitCatalogueImport, decodeCataloguePng, ensureCatalogueImportBatch, readOpenCatalogueImport, stageCataloguePng, upsertCatalogueImportRow } from "../catalogue-bulk-import";
import {
  catalogueConceptOptions,
  catalogueConceptShopAllowed,
  createCatalogueConcepts,
  liveApparelGenerationModel,
  redrawCatalogueConcept,
} from "../catalogue-concept";
import { catalogueMyPetTestArtworkPath, runCatalogueMyPetTest } from "../catalogue-my-pet-test";
import { parseCatalogueConceptGeneration } from "@shared/catalogueConcept";
import { draftCatalogueImage } from "../catalogue-draft";
import { redactAnthropicSecrets } from "../concept-engine";
import { planCatalogueImport, type CatalogueImportRow } from "@shared/catalogueBulkImport";
import { catalogueCandidateChoices, customizerPages, designCandidates, designProducts, mockupLibraryColours, productTypes } from "@shared/schema";
import { catalogueSpend } from "../catalogue-publish";
import { publishColorTickPatch, readPublishColorTicks, shopifyAdminProductUrl } from "@shared/cataloguePublish";
import { catalogueDesignCanBeEdited } from "@shared/catalogueQueue";
import { candidateCanBeDeleted, nextQueueId, sortOperatorQueue } from "../catalogue-queue";
import { resolveVariantFromMap, type VariantMap } from "@shared/variantMapResolve";
import { formatSizeRange, printableSizeNames, sortCatalogueColours } from "@shared/flywheelPromote";
import {
  candidateVisibleToShop,
  catalogueShopAllowed,
  catalogueShopDomain,
  operatorCatalogueForShop,
  isolatedCatalogueShop,
  STAGING_CATALOGUE_SHOP,
} from "@shared/operatorCatalogue";
import { CATALOGUE_SHIRT_PROVIDER_ID, SOFTSTYLE_BLUEPRINT_ID } from "@shared/printPlacement";
import {
  cataloguePublishAllowedForShop,
  cataloguePublishBlockMessage,
  cataloguePublishLocked,
  catalogueStudioBlockMessage,
  CATALOGUE_PUBLISH_LOCKED_MESSAGE,
  CATALOGUE_STUDIO_SHOP_MESSAGE,
} from "@shared/cataloguePublishAccess";
import { parseCompareAtBySize } from "@shared/compareAtBySize";
import { coloursStillOffered, filterPricesToSizes, offeredAxes } from "@shared/variantSelection";
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
  const omitted = productTypeId == null;
  const explicit = Number(productTypeId);
  const { stagingSoftstyleType } = await import("../operatorCatalogue");
  const typeId = omitted ? (await stagingSoftstyleType())?.id ?? 0 : explicit;
  if (!Number.isInteger(typeId) || typeId <= 0) return empty;
  const { db } = await import("../db");
  const [typeRow] = await db
    .select({
      shop: productTypes.shopifyShopDomain,
      sizes: productTypes.sizes,
      selectedSizeIds: productTypes.selectedSizeIds,
      compareAtBySize: productTypes.compareAtBySize,
    })
    .from(productTypes)
    .where(eq(productTypes.id, typeId))
    .limit(1);
  const shop = catalogueShopDomain(typeRow?.shop || "");
  if (!shop) return empty;
  const prices = await shopCataloguePrices(shop, typeId);
  const offeredNames = offeredAxes(parseSizes(typeRow?.sizes), parseIdList(typeRow?.selectedSizeIds)).map((size) => size.name);
  const selected = offeredNames.length ? filterPricesToSizes(prices, offeredNames) : prices;
  return filterPricesToSizes(
    {
      sizes: selected.sizes,
      pricesBySize: selected.pricesBySize,
      compareAtBySize: parseCompareAtBySize(typeRow?.compareAtBySize),
    },
    offeredNames.length ? offeredNames : selected.sizes,
  );
}

/** Retail prices already on this shop's studio product. Compare-at comes from the product type. */
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

async function catalogueProductLinks(shop: string): Promise<Array<{ jobId: string; shopifyProductId: string }>> {
  const { db } = await import("../db");
  const rows = await db
    .select({ jobId: designProducts.jobId, shopifyProductId: designProducts.shopifyProductId })
    .from(designProducts)
    .where(and(eq(designProducts.shop, shop), isNotNull(designProducts.jobId)));
  return rows.map((row) => ({
    jobId: String(row.jobId || ""),
    shopifyProductId: String(row.shopifyProductId || "").trim(),
  })).filter((row) => row.jobId);
}

async function listedCandidateIds(shop: string): Promise<string[]> {
  return (await catalogueProductLinks(shop)).map((row) => row.jobId);
}

async function shopifyListedCandidateIds(shop: string): Promise<string[]> {
  return (await catalogueProductLinks(shop))
    .filter((row) => row.shopifyProductId)
    .map((row) => row.jobId);
}

/** Petposterous can open a design that was published onto its shop. */
async function candidateOwnedOrListed(
  requestShop: string | null | undefined,
  row: { id: string; shopDomain: string | null },
): Promise<boolean> {
  if (candidateVisibleToShop(requestShop, row.shopDomain)) return true;
  const profile = operatorCatalogueForShop(requestShop);
  if (!isolatedCatalogueShop(profile.shop)) return false;
  return (await listedCandidateIds(profile.shop)).includes(row.id);
}

async function operatorQueue(requestShop: string | null | undefined): Promise<Array<{ id: string; title: string; punchline: string }>> {
  const profile = operatorCatalogueForShop(requestShop);
  const { db } = await import("../db");
  const listed = isolatedCatalogueShop(profile.shop) ? await listedCandidateIds(profile.shop) : [];
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
  return sortOperatorQueue(rows).map((row) => {
    const punchline = String(row.punchline || "").trim();
    return {
      id: row.id,
      title: String(row.title || punchline).trim(),
      punchline,
    };
  });
}

async function resolveStudioCandidateId(value: unknown, requestShop: string | null | undefined): Promise<{ id: string } | { error: string }> {
  const parsed = parseCandidateId(value);
  if ("error" in parsed || parsed.id) return parsed;
  const queue = await operatorQueue(requestShop);
  return { id: queue[0]?.id || PENDING_CANDIDATE.id };
}

function refuseStudioChange(res: Response, shop: string | null | undefined): boolean {
  const block = catalogueStudioBlockMessage(shop);
  if (!block) return false;
  res.status(400).json({ error: block });
  return true;
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

/** The selected type when this shop owns it. Staging with no selection uses the demo Softstyle row. */
async function studioGarment(raw: unknown, requestShop: string | null | undefined): Promise<{ id: number; name: string }> {
  const profile = operatorCatalogueForShop(requestShop);
  const id = Number(raw);
  const { db } = await import("../db");
  const { defaultCatalogueTypeId } = await import("../operatorCatalogue");
  if (Number.isInteger(id) && id > 0) {
    const [row] = await db
      .select({
        id: productTypes.id,
        name: productTypes.name,
        shop: productTypes.shopifyShopDomain,
        platformRef: productTypes.isPlatformCatalogRef,
      })
      .from(productTypes)
      .where(eq(productTypes.id, id))
      .limit(1);
    const owned = Boolean(row && !row.platformRef && catalogueShopDomain(row.shop) === profile.shop);
    if (row && owned) return { id: row.id, name: row.name };
  }
  const fallbackId = await defaultCatalogueTypeId(requestShop);
  if (!fallbackId) return { id: 0, name: "" };
  const [row] = await db
    .select({ id: productTypes.id, name: productTypes.name })
    .from(productTypes)
    .where(eq(productTypes.id, fallbackId))
    .limit(1);
  return { id: row?.id ?? fallbackId, name: row?.name || "" };
}

/** The type id when this shop owns it. No fallback — a miss must not be stored as another type. */
async function ownedStudioTypeId(raw: unknown, requestShop: string | null | undefined): Promise<number | null> {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  const profile = operatorCatalogueForShop(requestShop);
  const { db } = await import("../db");
  const [row] = await db
    .select({
      id: productTypes.id,
      shop: productTypes.shopifyShopDomain,
      platformRef: productTypes.isPlatformCatalogRef,
    })
    .from(productTypes)
    .where(eq(productTypes.id, id))
    .limit(1);
  if (!row || row.platformRef) return null;
  return catalogueShopDomain(row.shop) === profile.shop ? row.id : null;
}

type StudioLibraryColour = {
  name: string;
  hex: string;
  missingHex: boolean;
  /** True when this colour has a produced photo or its own in-use white master. */
  hasProducedBlank: boolean;
  inUseBlank: "produced" | "white-master" | null;
};

/** Active Colour blanks rows, in list order, with that row's hex. Inactive rows are omitted. */
async function libraryColoursFor(productTypeId: number): Promise<StudioLibraryColour[]> {
  const { blankLibraryTypeId, ensureColourBlankTable } = await import("../colour-blanks");
  const { inUseBlankKind } = await import("@shared/colourBlanks");
  const { panelsForType } = await import("../mockup-library-store");
  const libraryId = await blankLibraryTypeId(productTypeId);
  const { db } = await import("../db");
  await ensureColourBlankTable();
  const rows = await db
    .select({
      name: mockupLibraryColours.name,
      hex: mockupLibraryColours.hex,
      linkStoredName: mockupLibraryColours.linkStoredName,
    })
    .from(mockupLibraryColours)
    .where(and(
      eq(mockupLibraryColours.productTypeId, libraryId),
      eq(mockupLibraryColours.active, true),
    ))
    .orderBy(asc(mockupLibraryColours.sortOrder), asc(mockupLibraryColours.name));
  if (!rows.length) return [];
  const panels = (await panelsForType(libraryId)).map((panel) => ({
    panelId: panel.panelId,
    name: panel.garmentColor || "",
    kind: panel.kind,
  }));
  return rows.map((row) => {
    const raw = String(row.hex || "").replace(/^#/, "").trim();
    const ok = /^[0-9A-Fa-f]{6}$/.test(raw);
    const linked = String(row.linkStoredName || "").trim();
    const inUseBlank = inUseBlankKind(panels, row.name) || (linked ? inUseBlankKind(panels, linked) : null);
    return {
      name: row.name,
      hex: ok ? raw.toUpperCase() : "",
      missingHex: !ok,
      hasProducedBlank: inUseBlank != null,
      inUseBlank,
    };
  });
}

async function publishTargetsFor(
  candidateId: string,
  shop: string,
  types: Array<{ id: number; name: string }>,
) {
  const { db } = await import("../db");
  const rows = candidateId
    ? await db
      .select({
        productTypeId: designProducts.productTypeId,
        shopifyProductId: designProducts.shopifyProductId,
        shop: designProducts.shop,
      })
      .from(designProducts)
      .where(eq(designProducts.jobId, candidateId))
    : [];
  const shopKey = catalogueShopDomain(shop);
  return Promise.all(types.map(async (type) => {
    const listed = rows.find((row) =>
      row.productTypeId === type.id
      && catalogueShopDomain(String(row.shop || "")) === shopKey
      && String(row.shopifyProductId || "").trim(),
    );
    const colors = await libraryColoursFor(type.id);
    const { blankLibraryTypeId } = await import("../colour-blanks");
    const { blankNameKey } = await import("@shared/colourBlanks");
    const { blankScenesForLibrary, panelsForType } = await import("../mockup-library-store");
    const { newestUploadedBlank } = await import("@shared/colourBlanks");
    const libraryId = await blankLibraryTypeId(type.id);
    const [links, scenes, panelRows] = await Promise.all([
      db.select({ name: mockupLibraryColours.name, linkStoredName: mockupLibraryColours.linkStoredName })
        .from(mockupLibraryColours)
        .where(eq(mockupLibraryColours.productTypeId, libraryId)),
      blankScenesForLibrary(libraryId),
      panelsForType(libraryId),
    ]);
    return {
      id: type.id,
      name: type.name,
      published: Boolean(listed),
      productUrl: listed?.shopifyProductId ? shopifyAdminProductUrl(shop, listed.shopifyProductId) : null,
      panelRows: panelRows.map((row) => ({ panelId: row.panelId, isDefault: row.isDefault })),
      colors: colors.map((color) => {
        const link = links.find((row) => blankNameKey(row.name) === blankNameKey(color.name))?.linkStoredName || "";
        const photographs = scenes
          .filter((scene) => newestUploadedBlank(scene.rows, color.name, link))
          .map((scene) => ({ panelId: scene.panelId, label: scene.label || scene.panelId }));
        return {
          name: color.name,
          hex: color.hex,
          hasProducedBlank: photographs.length > 0,
          photographs,
        };
      }),
    };
  }));
}

async function retailIsPositive(productTypeId: number): Promise<boolean> {
  if (!Number.isInteger(productTypeId) || productTypeId <= 0) return false;
  const { db } = await import("../db");
  const { isNonPositiveRetailPrice } = await import("@shared/productIntelligence");
  const pages = await db
    .select({ price: customizerPages.baseProductPrice, status: customizerPages.status })
    .from(customizerPages)
    .where(eq(customizerPages.productTypeId, productTypeId));
  return pages.some((page) => page.status === "active" && !isNonPositiveRetailPrice(page.price));
}

async function studioScenes(productTypeId: number) {
  const { colourMatchKeys, listedSceneColours } = await import("@shared/colourBlanks");
  const { activeColourBlankSwatches, blankLibraryTypeId, inactiveColourKeys } = await import("../colour-blanks");
  const libraryId = await blankLibraryTypeId(productTypeId);
  const [scenes, hidden, active] = await Promise.all([
    listScenes(libraryId),
    inactiveColourKeys(libraryId),
    activeColourBlankSwatches(productTypeId),
  ]);
  return scenes.map((scene) => ({
    ...scene,
    colours: listedSceneColours(
      scene.colours.filter((colour) => !colourMatchKeys(colour.name).some((key) => hidden.has(key))),
      active.map((colour) => colour.name),
    ),
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
        db.select({
          id: productTypes.id,
          name: productTypes.name,
          shop: productTypes.shopifyShopDomain,
          platformRef: productTypes.isPlatformCatalogRef,
        }).from(productTypes).orderBy(asc(productTypes.id)),
      ]);
      if (id !== PENDING_CANDIDATE.id && (!stored || !(await candidateOwnedOrListed(req.shopDomain, stored)))) {
        res.status(404).json({ error: "That candidate is not stored." });
        return;
      }
      const profile = operatorCatalogueForShop(req.shopDomain);
      const sessionShop = catalogueShopDomain(req.shopDomain);
      const visibleTypes = catalogueShopAllowed(sessionShop)
        ? typeList.filter((row) => !row.platformRef && catalogueShopDomain(row.shop) === sessionShop)
        : typeList;
      const nextCandidateId = nextQueueId(queue.map((row) => row.id), id);
      const fixture = id === PENDING_CANDIDATE.id;
      const [typeRow] = await db
        .select({
          sizes: productTypes.sizes,
          selectedSizeIds: productTypes.selectedSizeIds,
          selectedColorIds: productTypes.selectedColorIds,
          variantMap: productTypes.variantMap,
          frameColors: productTypes.frameColors,
          shop: productTypes.shopifyShopDomain,
          blueprint: productTypes.printifyBlueprintId,
          provider: productTypes.printifyProviderId,
          merchantId: productTypes.merchantId,
        })
        .from(productTypes)
        .where(eq(productTypes.id, garment.id))
        .limit(1);
      const sizeRows = parseSizes(typeRow?.sizes);
      const selectedIds = parseIdList(typeRow?.selectedSizeIds);
      const offered = offeredAxes(sizeRows, selectedIds);
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
      const fixtureSoftstyle = fixture
        && catalogueShopDomain(typeRow?.shop) === STAGING_CATALOGUE_SHOP
        && Number(typeRow?.blueprint) === SOFTSTYLE_BLUEPRINT_ID
        && Number(typeRow?.provider) === CATALOGUE_SHIRT_PROVIDER_ID;
      const usingBlanks = blankColours.length > 0 && !fixtureSoftstyle;
      const rawColours = fixtureSoftstyle
        ? PENDING_CANDIDATE.colors
        : usingBlanks ? blankColours : sceneColours;
      const coloursForStudio = coloursStillOffered(rawColours, parseSizes(typeRow?.frameColors), parseIdList(typeRow?.selectedColorIds));
      const colourTickMode = usingBlanks ? "blanks" : "stored";
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
      const publishTypes = await publishTargetsFor(
        fixture ? "" : id,
        profile.shop,
        visibleTypes.map((row) => ({ id: row.id, name: row.name })),
      );
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
        selectedColor: fixtureSoftstyle ? PENDING_CANDIDATE.selectedColor : coloursForStudio[0]?.name || "White",
        sceneRecolourFromLibrary: !(
          catalogueShopDomain(typeRow?.shop) === STAGING_CATALOGUE_SHOP
          && Number(typeRow?.blueprint) === SOFTSTYLE_BLUEPRINT_ID
          && Number(typeRow?.provider) === CATALOGUE_SHIRT_PROVIDER_ID
        ),
        productTypes: visibleTypes.map((row) => ({ id: row.id, name: row.name })),
        publishTypes,
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
          poseNote: stored.poseNote || "",
          petMask: stored.petMask || null,
          behaviour: stored.behaviour,
          deviceStructure: stored.deviceStructure,
          darknessLevel: stored.darknessLevel,
          filename,
        },
        generation: fixture || !stored ? null : parseCatalogueConceptGeneration(stored.generation),
        conceptEnabled: catalogueConceptShopAllowed(req.shopDomain),
        myPetTestEnabled: catalogueConceptShopAllowed(req.shopDomain),
        publishPrefs: fixture || !stored ? null : {
          myPetEnabled: stored.publishMyPetEnabled ?? null,
          colors: readPublishColorTicks(stored.publishColorTicks),
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
      const drawId = typeof req.query.draw === "string" ? req.query.draw : "";
      let artworkPath = String(choice.artworkPath || "");
      if (drawId) {
        const stored = await readCandidateRow(id);
        const draw = parseCatalogueConceptGeneration(stored?.generation)?.draws.find((item) => item.id === drawId);
        if (!draw) {
          res.status(404).json({ error: "That draw is not on this candidate." });
          return;
        }
        artworkPath = draw.artworkPath;
      }
      const petArtwork = typeof req.query.petArtwork === "string" ? req.query.petArtwork : "";
      if (catalogueMyPetTestArtworkPath(petArtwork) && catalogueConceptShopAllowed(req.shopDomain)) {
        artworkPath = petArtwork;
      }
      if (!artworkPath.trim()) {
        res.status(204).end();
        return;
      }
      const { png, source } = await renderCandidateOnPanel({
        productTypeId: garment.id,
        typeName: garment.name,
        panelId,
        colorName: known.name,
        colorHex: known.hex,
        artworkPath,
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
      const merchant = await cataloguePrintifyMerchant(typeRow.merchantId, typeRow.shopifyShopDomain);
      if (!merchant?.printifyApiToken || !merchant.printifyShopId) {
        res.status(400).json({ error: "Printify is not connected on this product type." });
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

  app.get("/api/platform/catalogue-studio/concept", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    if (!catalogueConceptShopAllowed(req.shopDomain)) {
      res.json({ enabled: false });
      return;
    }
    try {
      const model = await liveApparelGenerationModel();
      res.json(catalogueConceptOptions(model));
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/concept", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const result = await createCatalogueConcepts({
        shop: req.shopDomain,
        requestId: String(req.body?.requestId || ""),
        body: req.body,
      });
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/my-pet-test", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const id = await candidateIdFor(res, req.body?.candidateId, req.shopDomain);
      if (!id || id === PENDING_CANDIDATE.id) {
        if (id === PENDING_CANDIDATE.id) res.status(400).json({ error: "This candidate has no stored artwork." });
        return;
      }
      const result = await runCatalogueMyPetTest({
        shop: req.shopDomain,
        requestId: String(req.body?.requestId || ""),
        candidateId: id,
        drawId: String(req.body?.drawId || ""),
        imageData: String(req.body?.imageData || ""),
      });
      const spend = await catalogueSpend(id);
      res.json({ ...result, spendUsd: spend.totalUsd, spendLines: spend.lines });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/concept/redraw", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const result = await redrawCatalogueConcept({
        shop: req.shopDomain,
        requestId: String(req.body?.requestId || ""),
        candidateId: String(req.body?.candidateId || ""),
        body: req.body,
      });
      res.json(result);
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
    if (refuseStudioChange(res, req.shopDomain)) return;
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
    if (refuseStudioChange(res, req.shopDomain)) return;
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
    if (refuseStudioChange(res, req.shopDomain)) return;
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
      const profile = operatorCatalogueForShop(req.shopDomain);
      const [open, listed] = await Promise.all([
        operatorQueue(req.shopDomain),
        profile.shop ? shopifyListedCandidateIds(profile.shop) : Promise.resolve([]),
      ]);
      const queue = await listCatalogueJobQueue(open, new Set(listed));
      res.json({ queue });
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/punchline", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    if (refuseStudioChange(res, req.shopDomain)) return;
    const id = await candidateIdFor(res, req.body?.candidateId, req.shopDomain);
    if (!id) return;
    if (id === PENDING_CANDIDATE.id) {
      res.status(400).json({ error: "That design is not stored." });
      return;
    }
    try {
      const row = await readCandidateRow(id);
      if (!row || !catalogueDesignCanBeEdited(row.status)) {
        res.status(400).json({ error: "Wording can be saved on a pending or published design." });
        return;
      }
      const punchline = String(req.body?.punchline ?? "");
      const { db } = await import("../db");
      await db.update(designCandidates).set({ punchline, updatedAt: new Date() }).where(and(
        eq(designCandidates.id, id),
        eq(designCandidates.shopDomain, row.shopDomain),
        or(
          eq(designCandidates.status, "pending"),
          eq(designCandidates.status, "approved"),
          eq(designCandidates.status, "promoted"),
        ),
      ));
      res.json({ ok: true, punchline });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/pet-pose", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    if (refuseStudioChange(res, req.shopDomain)) return;
    const id = await candidateIdFor(res, req.body?.candidateId, req.shopDomain);
    if (!id) return;
    if (id === PENDING_CANDIDATE.id) {
      res.status(400).json({ error: "That design is not stored." });
      return;
    }
    try {
      const row = await readCandidateRow(id);
      if (!row || row.status === "dropped") {
        res.status(400).json({ error: "That design cannot be edited." });
        return;
      }
      const poseNote = String(req.body?.poseNote ?? row.poseNote ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
      const { parsePetMask, withPetMaskNudge } = await import("@shared/myPetQuality");
      const current = parsePetMask(row.petMask);
      const petMask = current
        ? withPetMaskNudge(current, {
            nudgeX: Number(req.body?.nudgeX),
            nudgeY: Number(req.body?.nudgeY),
            nudgeW: Number(req.body?.nudgeW),
            nudgeH: Number(req.body?.nudgeH),
          })
        : null;
      const { db } = await import("../db");
      await db.update(designCandidates).set({ poseNote, petMask, updatedAt: new Date() }).where(eq(designCandidates.id, id));
      res.json({ ok: true, poseNote, petMask });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  // Saved ticks for the next publish. A job already running keeps the recipe it started with.
  app.post("/api/platform/catalogue-studio/publish-setup", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    if (refuseStudioChange(res, req.shopDomain)) return;
    const id = await candidateIdFor(res, req.body?.candidateId, req.shopDomain);
    if (!id) return;
    if (id === PENDING_CANDIDATE.id) {
      res.status(400).json({ error: "That design is not stored." });
      return;
    }
    try {
      const row = await readCandidateRow(id);
      if (!row || !catalogueDesignCanBeEdited(row.status)) {
        res.status(400).json({ error: "Publish choices can be saved on a pending or published design." });
        return;
      }
      const hasColours = Array.isArray(req.body?.colorNames);
      const hasPet = typeof req.body?.myPetEnabled === "boolean";
      if (!hasColours && !hasPet) {
        res.status(400).json({ error: "Nothing to save." });
        return;
      }
      let typeId: number | null = null;
      if (hasColours) {
        typeId = await ownedStudioTypeId(req.body?.productTypeId, req.shopDomain);
        if (!typeId) {
          res.status(400).json({ error: "That product type is not on this shop." });
          return;
        }
      }
      const { pool } = await import("../db");
      const sets: string[] = [];
      const values: unknown[] = [];
      if (hasColours && typeId) {
        values.push(JSON.stringify(publishColorTickPatch(typeId, req.body.colorNames)));
        sets.push(`publish_color_ticks = COALESCE(publish_color_ticks, '{}'::jsonb) || $${values.length}::jsonb`);
      }
      if (hasPet) {
        values.push(req.body.myPetEnabled);
        sets.push(`publish_my_pet_enabled = $${values.length}`);
      }
      values.push(id, row.shopDomain);
      const updated = await pool.query(
        `UPDATE design_candidates
         SET ${sets.join(", ")}, updated_at = now()
         WHERE id = $${values.length - 1} AND shop_domain = $${values.length} AND status IN ('pending', 'approved', 'promoted')`,
        values,
      );
      if (!updated.rowCount) {
        res.status(400).json({ error: "Publish choices can be saved on a pending or published design." });
        return;
      }
      const saved = await readCandidateRow(id);
      res.json({
        ok: true,
        publishPrefs: {
          myPetEnabled: saved?.publishMyPetEnabled ?? null,
          colors: readPublishColorTicks(saved?.publishColorTicks),
        },
      });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/publish", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    if (cataloguePublishLocked()) {
      res.status(400).json({ error: CATALOGUE_PUBLISH_LOCKED_MESSAGE, reasons: [CATALOGUE_PUBLISH_LOCKED_MESSAGE] });
      return;
    }
    const publishBlock = cataloguePublishBlockMessage(req.shopDomain);
    if (publishBlock) {
      res.status(400).json({ error: publishBlock, reasons: [publishBlock] });
      return;
    }
    const id = await candidateIdFor(res, req.body?.candidateId, req.shopDomain);
    if (!id) return;
    try {
      const { publishCatalogueCandidate, PublishRefusal, sceneForType } = await import("../catalogue-publish");
      const { enqueueCataloguePublish } = await import("../catalogue-publish-jobs");
      const { db } = await import("../db");
      const rawTargets = Array.isArray(req.body?.targets) && req.body.targets.length
        ? req.body.targets
        : [{ productTypeId: req.body?.productTypeId, selectedColors: req.body?.selectedColors }];
      const seen = new Set<number>();
      const targets: Array<{ productTypeId: number; name: string; selectedColors: Array<{ name: string; hex: string }> }> = [];
      for (const row of rawTargets) {
        const garment = await studioGarment(row?.productTypeId, req.shopDomain);
        if (!garment.id || seen.has(garment.id)) continue;
        seen.add(garment.id);
        const colors = sortCatalogueColours((Array.isArray(row?.selectedColors) ? row.selectedColors : []).map((c: { name?: string; hex?: string }) => ({
          name: String(c?.name || ""),
          hex: String(c?.hex || "").replace(/^#/, ""),
        }))).filter((color) => color.name);
        targets.push({ productTypeId: garment.id, name: garment.name, selectedColors: colors });
      }
      if (!targets.length) {
        res.status(400).json({ error: "Choose a product type.", reasons: ["Choose a product type."] });
        return;
      }
      const profile = operatorCatalogueForShop(req.shopDomain);
      const listed = await db
        .select({
          productTypeId: designProducts.productTypeId,
          shopifyProductId: designProducts.shopifyProductId,
          shop: designProducts.shop,
        })
        .from(designProducts)
        .where(eq(designProducts.jobId, id));
      const open = targets.filter((target) => !listed.some((row) =>
        row.productTypeId === target.productTypeId
        && catalogueShopDomain(String(row.shop || "")) === catalogueShopDomain(profile.shop)
        && String(row.shopifyProductId || "").trim(),
      ));
      if (!open.length) {
        const reason = "Every selected type is already published.";
        res.status(400).json({ error: reason, reasons: [reason] });
        return;
      }
      const recipeBase = {
        candidateId: id,
        panelId: String(req.body?.panelId || ""),
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
        myPetEnabled: req.body?.myPetEnabled !== false,
      };
      const reasons: string[] = [];
      for (const target of open) {
        try {
          const prices = await shippingPricesBySize(target.productTypeId);
          const panelId = await sceneForType(target.productTypeId, recipeBase.panelId);
          await publishCatalogueCandidate({
            recipe: { ...recipeBase, panelId, productTypeId: target.productTypeId, selectedColors: target.selectedColors },
            pricesBySize: prices.pricesBySize,
            compareAtBySize: prices.compareAtBySize,
            work: "check",
          });
        } catch (err) {
          const text = err instanceof PublishRefusal && err.reasons.length
            ? err.reasons.join("\n")
            : String((err as Error)?.message || err);
          for (const line of text.split("\n")) {
            if (line.trim()) reasons.push(`${target.name}: ${line.trim()}`);
          }
        }
      }
      if (reasons.length) {
        res.status(400).json({ error: reasons.join("\n"), reasons });
        return;
      }
      const job = await enqueueCataloguePublish({
        ...recipeBase,
        selectedColors: open[0].selectedColors,
        productTypeId: open[0].productTypeId,
        targets: open.map((target) => ({ productTypeId: target.productTypeId, selectedColors: target.selectedColors })),
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
    if (refuseStudioChange(res, req.shopDomain)) return;
    try {
      const shop = catalogueShopDomain(req.shopDomain);
      if (!shop) {
        res.status(400).json({ error: CATALOGUE_STUDIO_SHOP_MESSAGE });
        return;
      }
      const { reorderCatalogueColours } = await import("../catalogue-colour-order");
      const products = await reorderCatalogueColours(shop);
      res.json({ products });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/promote", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    if (cataloguePublishLocked()) {
      res.status(400).json({ error: CATALOGUE_PUBLISH_LOCKED_MESSAGE, reasons: [CATALOGUE_PUBLISH_LOCKED_MESSAGE] });
      return;
    }
    const promoteBlock = cataloguePublishBlockMessage(req.shopDomain);
    if (promoteBlock || !cataloguePublishAllowedForShop(req.shopDomain)) {
      const message = promoteBlock || "Catalogue publish is not available for this store.";
      res.status(400).json({ error: message, reasons: [message] });
      return;
    }
    try {
      const { promoteCatalogueCandidate } = await import("../flywheel-promote");
      const garment = await studioGarment(req.body?.productTypeId, req.shopDomain);
      if (!(await retailIsPositive(garment.id))) {
        const reason = "Retail is $0.00 for this type. Set the price table before publishing a design.";
        res.status(400).json({ error: reason, reasons: [reason] });
        return;
      }
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
    if (refuseStudioChange(res, req.shopDomain)) return;
    const started = Date.now();
    const shop = String(req.shopDomain || "");
    const filename = String(req.body?.filename || "image.png");
    try {
      const png = decodeCataloguePng(filename, String(req.body?.imageBase64 || ""));
      console.log(`[catalogue-draft] start shop=${shop} file=${filename} bytes=${png.length}`);
      const draft = await draftCatalogueImage(png);
      console.log(`[catalogue-draft] ok shop=${shop} file=${filename} model=${draft.model} ms=${Date.now() - started} cost=${draft.costUsd ?? "unknown"}`);
      res.json(draft);
    } catch (e: any) {
      const message = redactAnthropicSecrets(String(e?.message || e)).slice(0, 300);
      console.warn(`[catalogue-draft] fail shop=${shop} file=${filename} status=${e?.status || 400} ms=${Date.now() - started} ${message}`);
      res.status(e?.status || 400).json({
        error: message,
        costUsd: typeof e?.costUsd === "number" ? e.costUsd : null,
        inputTokens: Number(e?.inputTokens) || 0,
        outputTokens: Number(e?.outputTokens) || 0,
        model: String(e?.model || ""),
      });
    }
  });

  app.post("/api/platform/catalogue-studio/candidates/import/batch", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const shop = await assertCatalogueImportShop(req.shopDomain);
      await ensureCatalogueImportBatch(shop, String(req.body?.batchId || ""));
      res.json({ ok: true, batchId: String(req.body?.batchId || "") });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/candidates/import/row", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const shop = await assertCatalogueImportShop(req.shopDomain);
      const batchId = String(req.body?.batchId || "");
      const row = req.body?.row || {};
      await ensureCatalogueImportBatch(shop, batchId);
      await upsertCatalogueImportRow(shop, batchId, {
        rowNumber: Number(row.rowNumber) || 0,
        filename: String(row.filename || ""),
        style: String(row.style || ""),
        species: String(row.species || ""),
        humourOperator: String(row.humourOperator || ""),
        truth: String(row.truth || ""),
        device: String(row.device || ""),
        exactWording: String(row.exactWording || ""),
        source: row.source === "csv" ? "csv" : "draft",
        lowConfidence: {
          style: row.lowConfidence?.style === true,
          humourOperator: row.lowConfidence?.humourOperator === true,
        },
        proposedFilename: row.proposedFilename ? String(row.proposedFilename) : undefined,
        failureReason: row.failureReason ? String(row.failureReason) : undefined,
        importStatus: row.importStatus === "failed" ? "failed" : row.importStatus === "queued" ? "queued" : "drafted",
        selected: row.selected !== false,
        acknowledgedWarnings: row.acknowledgedWarnings === true,
      });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.get("/api/platform/catalogue-studio/candidates/import/open", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const shop = await assertCatalogueImportShop(req.shopDomain);
      const open = await readOpenCatalogueImport(shop);
      res.json({ batch: open });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/candidates/import/file", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const stored = await stageCataloguePng(String(req.body?.batchId || ""), String(req.body?.filename || ""), String(req.body?.imageBase64 || ""), req.shopDomain);
      res.json({ ok: true, hash: stored.hash, imagePath: stored.imagePath });
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
          acknowledgedWarnings: row?.acknowledgedWarnings === true,
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

  app.post("/api/platform/catalogue-studio/candidates/import/clear-created", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const shop = await assertCatalogueImportShop(req.shopDomain);
      const cleared = await clearCreatedCatalogueImportRows(shop, String(req.body?.batchId || ""));
      res.json({ ok: true, removed: cleared.removed });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e), removed: [] });
    }
  });

  app.post("/api/platform/catalogue-studio/candidates/import/abort", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const shop = await assertCatalogueImportShop(req.shopDomain);
      const filenames = Array.isArray(req.body?.filenames) ? req.body.filenames.map((name: unknown) => String(name)) : [];
      await abortCatalogueImport(shop, String(req.body?.batchId || ""), filenames);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
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
      let myPetEnabled: boolean | null = null;
      if (designProductId) {
        const { db } = await import("../db");
        const [row] = await db
          .select({ myPetEnabled: designProducts.myPetEnabled })
          .from(designProducts)
          .where(eq(designProducts.id, designProductId))
          .limit(1);
        myPetEnabled = row ? row.myPetEnabled !== false : null;
      }
      res.json({ designProductId, myPetEnabled });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  mountDesignColourRoutes(app, "/api/platform/catalogue-studio/design-products", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return null;
    const session = catalogueShopDomain(req.shopDomain);
    return catalogueShopAllowed(session) ? session : undefined;
  }, [isAuthenticated]);
}
