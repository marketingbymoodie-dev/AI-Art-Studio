/**
 * Operator Design Studio. Preview only — no Shopify product is created.
 */
import type { Express, RequestHandler, Response } from "express";
import { and, eq } from "drizzle-orm";
import { customizerPages, productTypes } from "@shared/schema";
import { filterCatalogByPrintSides } from "@shared/shopifyVariantMatch";
import { requirePlatformAdmin } from "../platformAdmin";
import { PENDING_CANDIDATE, renderPendingCandidatePng } from "../catalogue-studio-preview";
import { getProductRestCompat } from "../shopify-product-graphql";
import { storage } from "../storage";

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

  app.get("/api/platform/catalogue-studio/pending", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const [prices, eligibility] = await Promise.all([
        shippingPricesBySize(),
        import("../catalogue-studio-eligibility").then((m) => m.pendingColourEligibility()),
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
      });
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get("/api/platform/catalogue-studio/pending-preview", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const requested = typeof req.query.color === "string" ? req.query.color : "";
      const known = PENDING_CANDIDATE.colors.some((c) => c.name === requested);
      if (requested && !known) {
        res.status(400).json({ error: `Unknown garment colour: ${requested}` });
        return;
      }
      const png = await renderPendingCandidatePng(requested || PENDING_CANDIDATE.selectedColor);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-store");
      res.send(png);
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });
}
