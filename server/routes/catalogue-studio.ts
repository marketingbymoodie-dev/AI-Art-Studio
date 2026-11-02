/**
 * Operator Design Studio. Preview only — no Shopify product is created.
 */
import type { Express, RequestHandler, Response } from "express";
import { and, asc, eq } from "drizzle-orm";
import { abortCatalogueImport, commitCatalogueImport, decodeCataloguePng, stageCataloguePng } from "../catalogue-bulk-import";
import { draftCatalogueImage } from "../catalogue-draft";
import { planCatalogueImport, type CatalogueImportRow } from "@shared/catalogueBulkImport";
import { customizerPages, designCandidates, merchants, productTypes } from "@shared/schema";
import { resolveVariantFromMap, type VariantMap } from "@shared/variantMapResolve";
import { formatSizeRange, printableSizeNames } from "@shared/flywheelPromote";
import { filterCatalogByPrintSides } from "@shared/shopifyVariantMatch";
import { requirePlatformAdmin } from "../platformAdmin";
import { parseMockupImport } from "@shared/mockupBundle";
import { PENDING_CANDIDATE } from "../catalogue-studio-preview";
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

export async function shippingPricesBySize(): Promise<{ sizes: string[]; pricesBySize: Record<string, string> }> {
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
  if (!row?.shop || !row.baseProductId) return { sizes: [], pricesBySize: {} };
  const installation = await storage.getShopifyInstallationByShop(row.shop);
  if (!installation?.accessToken) return { sizes: [], pricesBySize: {} };
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
  return { sizes, pricesBySize };
}

const STAGING_SHOP = "ai-art-studio-staging.myshopify.com";

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

async function pendingQueue(): Promise<Array<{ id: string }>> {
  const { db } = await import("../db");
  return db
    .select({ id: designCandidates.id })
    .from(designCandidates)
    .where(and(eq(designCandidates.status, "pending"), eq(designCandidates.shopDomain, STAGING_SHOP)))
    .orderBy(asc(designCandidates.createdAt));
}

async function resolveStudioCandidateId(value: unknown): Promise<{ id: string } | { error: string }> {
  const parsed = parseCandidateId(value);
  if ("error" in parsed || parsed.id) return parsed;
  const queue = await pendingQueue();
  return { id: queue[0]?.id || PENDING_CANDIDATE.id };
}

async function candidateIdFor(res: Response, value: unknown): Promise<string | null> {
  const resolved = await resolveStudioCandidateId(value);
  if ("error" in resolved) {
    res.status(400).json({ error: resolved.error });
    return null;
  }
  if (resolved.id !== PENDING_CANDIDATE.id && !(await readCandidateRow(resolved.id))) {
    res.status(404).json({ error: "That candidate is not stored." });
    return null;
  }
  return resolved.id;
}

export function registerCatalogueStudioRoutes(app: Express, deps: { isAuthenticated: RequestHandler }) {
  const { isAuthenticated } = deps;

  app.get("/api/platform/catalogue-studio/panels", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const garment = await softstyleType();
      res.json({ scenes: await listScenes(garment.id) });
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get("/api/platform/catalogue-studio/pending", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const resolved = await resolveStudioCandidateId(req.query.candidate);
      if ("error" in resolved) {
        res.status(400).json({ error: resolved.error });
        return;
      }
      const id = resolved.id;
      const [prices, garment, scenes, choice, recentScenes, stored, queue] = await Promise.all([
        shippingPricesBySize(),
        softstyleType(),
        softstyleType().then((type) => listScenes(type.id)),
        readChoice(id),
        recentSceneLabels(),
        readCandidateRow(id),
        pendingQueue(),
      ]);
      if (id !== PENDING_CANDIDATE.id && !stored) {
        res.status(404).json({ error: "That candidate is not stored." });
        return;
      }
      const queueIndex = queue.findIndex((row) => row.id === id);
      const nextCandidateId = queueIndex >= 0 ? queue[queueIndex + 1]?.id || "" : queue[0]?.id || "";
      const fixture = id === PENDING_CANDIDATE.id;
      const { db } = await import("../db");
      const [typeRow] = await db
        .select({
          sizes: productTypes.sizes,
          selectedSizeIds: productTypes.selectedSizeIds,
          variantMap: productTypes.variantMap,
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
      const colours = [...colourByName.values()];
      const colourSizes: Record<string, string> = {};
      const offeredNames = offered.map((size) => size.name);
      for (const color of colours) {
        colourSizes[color.name] = formatSizeRange(offeredNames, printableSizeNames(variantMap, color, offered));
      }
      let eligibility = null;
      if (choice.artworkPath && colours.length) {
        try {
          const artwork = await readLibraryObject(choice.artworkPath);
          const { measureColourEligibility } = await import("../catalogue-studio-eligibility");
          eligibility = await measureColourEligibility(artwork, colours);
        } catch (err) {
          console.error("[catalogue-studio] eligibility:", (err as Error).message);
        }
      }
      const filename = (stored?.artworkPath || choice.artworkPath || "").split("/").pop() || "";
      res.json({
        id,
        status: stored?.status || PENDING_CANDIDATE.status,
        title: fixture ? stored?.title || PENDING_CANDIDATE.title : stored?.title || "",
        description: stored?.description || "",
        shopifyProductId: stored?.shopifyProductId || null,
        colors: fixture ? PENDING_CANDIDATE.colors : colours,
        selectedColor: fixture ? PENDING_CANDIDATE.selectedColor : colours[0]?.name || "White",
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
      const id = await candidateIdFor(res, req.query.candidate);
      if (!id) return;
      const known = PENDING_CANDIDATE.colors.find((c) => c.name === requested) ?? { name: requested, hex: "FFFFFF" };
      const [garment, choice] = await Promise.all([softstyleType(), readChoice(id)]);
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
      res.status(500).json({ error: String(e?.message || e) });
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
      const garment = await softstyleType();
      const [typeRow] = await db.select().from(productTypes).where(eq(productTypes.id, garment.id)).limit(1);
      if (!typeRow?.printifyBlueprintId || !typeRow.printifyProviderId || !typeRow.merchantId) {
        res.status(400).json({ error: "This product type has no Printify blueprint." });
        return;
      }
      const [merchant] = await db.select().from(merchants).where(eq(merchants.id, typeRow.merchantId)).limit(1);
      if (!merchant?.printifyApiToken || !merchant.printifyShopId) {
        res.status(400).json({ error: "Printify is not connected on this product type." });
        return;
      }
      const id = await candidateIdFor(res, req.body?.candidateId);
      if (!id) return;
      const known = PENDING_CANDIDATE.colors.find((c) => c.name === colorName) ?? { name: colorName, hex: "FFFFFF" };
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
      if (!/^Mockup_\d+$/i.test(panelId)) {
        res.status(400).json({ error: "Name the scene." });
        return;
      }
      const garment = await softstyleType();
      const cells = await reviewStoredScene(garment.id, panelId);
      res.json({ productTypeId: garment.id, productTypeName: garment.name, panelId, cells });
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/panels/import/plan", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    const paths = Array.isArray(req.body?.paths) ? req.body.paths.map((path: unknown) => String(path)) : [];
    const garment = await softstyleType();
    res.json({ ...parseMockupImport(paths), productTypeId: garment.id, productTypeName: garment.name });
  });

  app.post("/api/platform/catalogue-studio/panels/import/file", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const body = req.body ?? {};
      const garment = await softstyleType();
      const requested = Number(body.productTypeId);
      if (Number.isFinite(requested) && requested > 0 && requested !== garment.id) {
        res.status(400).json({ error: `This page stores panels on ${garment.name} (${garment.id}).` });
        return;
      }
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
      const garment = await softstyleType();
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
      const garment = await softstyleType();
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
      const id = await candidateIdFor(res, req.body?.candidateId);
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
      const id = await candidateIdFor(res, req.body?.candidateId);
      if (!id) return;
      await saveArtwork(id, String(req.body?.imageBase64 || ""));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/approve", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { approveCatalogueCandidate } = await import("../flywheel-approve");
      const id = await candidateIdFor(res, req.body?.candidateId);
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
      });
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/promote", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { promoteCatalogueCandidate } = await import("../flywheel-promote");
      const garment = await softstyleType();
      const prices = await shippingPricesBySize();
      const id = await candidateIdFor(res, req.body?.candidateId);
      if (!id) return;
      const result = await promoteCatalogueCandidate({
        candidateId: id,
        publishNow: req.body?.publishNow !== false,
        productTypeId: garment.id,
        pricesBySize: prices.pricesBySize,
      });
      res.json(result);
    } catch (e: any) {
      const status = e?.status === 409 || e?.name === "PromoteRefusal" ? 409 : 400;
      res.status(status).json({ error: String(e?.message || e) });
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
      await stageCataloguePng(String(req.body?.batchId || ""), String(req.body?.filename || ""), String(req.body?.imageBase64 || ""));
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
}
