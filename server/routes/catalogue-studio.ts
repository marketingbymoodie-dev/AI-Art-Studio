/**
 * Operator Design Studio. Preview only — no Shopify product is created.
 */
import type { Express, RequestHandler, Response } from "express";
import { and, eq } from "drizzle-orm";
import { customizerPages, productTypes } from "@shared/schema";
import { filterCatalogByPrintSides } from "@shared/shopifyVariantMatch";
import { requirePlatformAdmin } from "../platformAdmin";
import { parseMockupImport } from "@shared/mockupBundle";
import { PENDING_CANDIDATE } from "../catalogue-studio-preview";
import { getProductRestCompat } from "../shopify-product-graphql";
import { storage } from "../storage";
import {
  approveCandidateChoice,
  confirmPanelUpload,
  listScenes,
  preparePanelUpload,
  readChoice,
  recentSceneLabels,
  renderCandidateOnPanel,
  reviewStoredScene,
  saveArtwork,
  saveChoice,
  softstyleType,
  storeSegmentedPanel,
} from "../mockup-library-store";

/** Front Shopify variant prices for the Softstyle page. Same read as list-as-product. */
async function shippingPricesBySize(): Promise<{ sizes: string[]; pricesBySize: Record<string, string> }> {
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
      const [prices, eligibility, garment, scenes, choice, recentScenes] = await Promise.all([
        shippingPricesBySize(),
        import("../catalogue-studio-eligibility").then((m) => m.pendingColourEligibility()),
        softstyleType(),
        softstyleType().then((type) => listScenes(type.id)),
        readChoice(PENDING_CANDIDATE.id),
        recentSceneLabels(),
      ]);
      res.json({
        id: PENDING_CANDIDATE.id,
        status: PENDING_CANDIDATE.status,
        title: PENDING_CANDIDATE.title,
        shopifyProductId: PENDING_CANDIDATE.shopifyProductId,
        colors: PENDING_CANDIDATE.colors,
        selectedColor: PENDING_CANDIDATE.selectedColor,
        selectedSize: "L",
        ...prices,
        eligibility,
        productTypeId: garment.id,
        productTypeName: garment.name,
        scenes,
        choice,
        recentScenes,
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
      const known = PENDING_CANDIDATE.colors.find((c) => c.name === requested) ?? { name: requested, hex: "FFFFFF" };
      const [garment, choice] = await Promise.all([softstyleType(), readChoice(PENDING_CANDIDATE.id)]);
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
      const result = await storeSegmentedPanel({
        productTypeId: garment.id,
        label: String(body.label || ""),
        panelId: body.panelId ? String(body.panelId) : null,
        garmentColor: String(body.garmentColor || ""),
        garmentHex: String(body.garmentHex || ""),
        kind: body.kind === "white-master" ? "white-master" : "produced",
        isDefault: body.isDefault === true,
        imageBase64: String(body.imageBase64 || ""),
        uploadedBy: req.user?.id ? String(req.user.id) : null,
      });
      res.json({ ...result, productTypeId: garment.id, productTypeName: garment.name });
    } catch (e: any) {
      res.status(400).json({
        error: String(e?.message || e),
        areaFraction: e?.areaFraction,
        touchesEdge: e?.touchesEdge,
        disconnected: e?.disconnected,
        outlineJpegBase64: e?.outlineJpegBase64,
      });
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
      const colors = Array.isArray(req.body?.selectedColors) ? req.body.selectedColors : [];
      await saveChoice(
        PENDING_CANDIDATE.id,
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
      await saveArtwork(PENDING_CANDIDATE.id, String(req.body?.imageBase64 || ""));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/approve", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const garment = await softstyleType();
      const colors = Array.isArray(req.body?.selectedColors) ? req.body.selectedColors : [];
      await approveCandidateChoice({
        candidateId: PENDING_CANDIDATE.id,
        productTypeId: garment.id,
        typeName: garment.name,
        panelId: String(req.body?.panelId || ""),
        selectedColors: colors.map((c: { name?: string; hex?: string }) => ({ name: String(c?.name || ""), hex: String(c?.hex || "").replace(/^#/, "") })),
      });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });
}
