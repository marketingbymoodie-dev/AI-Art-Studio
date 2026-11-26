/**
 * Garment measurements live on the product type. Listings read them.
 * A null measurement set is filled from the Printify chart already stored
 * for that blueprint. An empty object is a deliberate clear and stays empty.
 */
import type { Express, Request, RequestHandler, Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import {
  defaultEaseForShape,
  garmentShapeFromName,
  measurementsFromPrintifyChart,
  type FitEase,
  type GarmentMeasurements,
  type GarmentShape,
} from "@shared/findMySize";
import { catalogueShopAllowed, PETSTAGE_CATALOGUE_SHOP } from "@shared/operatorCatalogue";
import { designProducts, productTypes, shopifyInstallations } from "@shared/schema";
import { db } from "./db";
import { normalizeMyshopifyShopDomain } from "./shopDomain";

const PETPOSTEROUS_SHOP = "h7epay-gh.myshopify.com";
const PETPOSTEROUS_GUARANTEE = {
  title: "30-day money-back & fit guarantee",
  detail: "Wrong size? We'll send you a new tee.",
};

type StoredType = {
  id: number;
  name: string;
  blueprintId: number | null;
  shop: string | null;
  shopifyProductId: string | null;
  selectedSizeIds: string | null;
  sizes: string | null;
  garmentWord: string | null;
  garmentShape: string | null;
  garmentFitEase: FitEase | null;
  garmentMeasurements: GarmentMeasurements | null;
};

function selectedSizeNames(row: { sizes: string | null; selectedSizeIds: string | null }): string[] {
  let sizes: Array<{ id?: string; name?: string }> = [];
  let selected: string[] = [];
  try { sizes = JSON.parse(row.sizes || "[]"); } catch { sizes = []; }
  try { selected = JSON.parse(row.selectedSizeIds || "[]").map(String); } catch { selected = []; }
  const chosen = selected.length
    ? sizes.filter((size) => selected.includes(String(size?.id)))
    : sizes;
  return chosen.map((size) => String(size?.name || "").trim()).filter(Boolean);
}

function shapeOf(row: { name: string; garmentShape: string | null }): GarmentShape {
  if (row.garmentShape === "tee" || row.garmentShape === "long-sleeve" || row.garmentShape === "sweatshirt") {
    return row.garmentShape;
  }
  return garmentShapeFromName(row.name);
}

async function printifyChart(blueprintId: number): Promise<{ model: string; measurements: unknown[][] } | null> {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key || !Number.isFinite(blueprintId)) return null;
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase
    .from("printify_size_charts")
    .select("blueprint_title, brand, model, measurements, status")
    .eq("blueprint_id", blueprintId)
    .eq("status", "extracted")
    .maybeSingle();
  if (error || !data || !Array.isArray(data.measurements)) return null;
  const model = [data.brand, data.model].filter(Boolean).join(" ") || String(data.blueprint_title || "");
  return { model, measurements: data.measurements as unknown[][] };
}

async function copyChart(row: StoredType): Promise<GarmentMeasurements | null> {
  if (!row.blueprintId) return null;
  const chart = await printifyChart(row.blueprintId);
  if (!chart) return null;
  return measurementsFromPrintifyChart({
    model: chart.model,
    measurements: chart.measurements,
    selectedSizes: selectedSizeNames(row),
  });
}

export async function backfillFindMySize(): Promise<{ charts: number; guarantee: number }> {
  const rows = await db
    .select({
      id: productTypes.id,
      name: productTypes.name,
      blueprintId: productTypes.printifyBlueprintId,
      shop: productTypes.shopifyShopDomain,
      shopifyProductId: productTypes.shopifyProductId,
      selectedSizeIds: productTypes.selectedSizeIds,
      sizes: productTypes.sizes,
      garmentWord: productTypes.listingGarmentWord,
      garmentShape: productTypes.garmentShape,
      garmentFitEase: productTypes.garmentFitEase,
      garmentMeasurements: productTypes.garmentMeasurements,
    })
    .from(productTypes)
    .where(isNull(productTypes.garmentMeasurements));
  let charts = 0;
  for (const row of rows) {
    if (!catalogueShopAllowed(row.shop)) continue;
    const measurements = await copyChart(row);
    if (!measurements) continue;
    const shape = shapeOf(row);
    const written = await db
      .update(productTypes)
      .set({
        garmentMeasurements: measurements,
        garmentShape: row.garmentShape || shape,
        garmentFitEase: row.garmentFitEase || defaultEaseForShape(shape),
      })
      .where(and(
        eq(productTypes.id, row.id),
        eq(productTypes.shopifyShopDomain, row.shop),
        isNull(productTypes.garmentMeasurements),
      ))
      .returning({ id: productTypes.id });
    charts += written.length;
  }
  const guarantee = await db
    .update(shopifyInstallations)
    .set({
      sizeFinderGuaranteeEnabled: true,
      sizeFinderGuaranteeTitle: PETPOSTEROUS_GUARANTEE.title,
      sizeFinderGuaranteeDetail: PETPOSTEROUS_GUARANTEE.detail,
    })
    .where(and(
      eq(shopifyInstallations.shopDomain, PETPOSTEROUS_SHOP),
      isNull(shopifyInstallations.sizeFinderGuaranteeEnabled),
    ))
    .returning({ id: shopifyInstallations.id });
  const petstage = await ensurePetstageGuarantee();
  return { charts, guarantee: guarantee.length + petstage };
}

/** Pet Stage only. The refund link is this store, not the live Petposterous URL. */
export async function ensurePetstageGuarantee(): Promise<number> {
  const updated = await db
    .update(shopifyInstallations)
    .set({
      sizeFinderGuaranteeEnabled: true,
      sizeFinderGuaranteeTitle: PETPOSTEROUS_GUARANTEE.title,
      sizeFinderGuaranteeDetail: PETPOSTEROUS_GUARANTEE.detail,
      sizeFinderGuaranteeUrl: `https://${PETSTAGE_CATALOGUE_SHOP}/policies/refund-policy`,
    })
    .where(and(
      eq(shopifyInstallations.shopDomain, PETSTAGE_CATALOGUE_SHOP),
      isNull(shopifyInstallations.sizeFinderGuaranteeEnabled),
    ))
    .returning({ id: shopifyInstallations.id });
  return updated.length;
}

async function typeById(id: number): Promise<StoredType | null> {
  const [row] = await db
    .select({
      id: productTypes.id,
      name: productTypes.name,
      blueprintId: productTypes.printifyBlueprintId,
      shop: productTypes.shopifyShopDomain,
      shopifyProductId: productTypes.shopifyProductId,
      selectedSizeIds: productTypes.selectedSizeIds,
      sizes: productTypes.sizes,
      garmentWord: productTypes.listingGarmentWord,
      garmentShape: productTypes.garmentShape,
      garmentFitEase: productTypes.garmentFitEase,
      garmentMeasurements: productTypes.garmentMeasurements,
    })
    .from(productTypes)
    .where(eq(productTypes.id, id))
    .limit(1);
  return row ?? null;
}

async function resolveType(args: { shop?: string; productId?: string; productTypeId?: number }): Promise<StoredType | null> {
  if (args.productTypeId && args.productTypeId > 0) return typeById(args.productTypeId);
  const productId = String(args.productId || "").replace(/\D/g, "");
  if (!productId) return null;
  const shop = normalizeMyshopifyShopDomain(args.shop || "");
  const [listed] = await db
    .select({ productTypeId: designProducts.productTypeId })
    .from(designProducts)
    .where(shop
      ? and(eq(designProducts.shopifyProductId, productId), eq(designProducts.shop, shop))
      : eq(designProducts.shopifyProductId, productId))
    .limit(1);
  if (listed?.productTypeId) return typeById(listed.productTypeId);
  const [shell] = await db
    .select({ id: productTypes.id })
    .from(productTypes)
    .where(eq(productTypes.shopifyProductId, productId))
    .limit(1);
  return shell ? typeById(shell.id) : null;
}

export async function findMySizePayload(args: { shop?: string; productId?: string; productTypeId?: number }) {
  const row = await resolveType({ shop: args.shop, productId: args.productId, productTypeId: args.productTypeId });
  if (!row) return null;
  let measurements = row.garmentMeasurements;
  if (measurements == null) {
    const copied = await copyChart(row);
    if (copied) {
      const shape = shapeOf(row);
      await db.update(productTypes).set({
        garmentMeasurements: copied,
        garmentShape: row.garmentShape || shape,
        garmentFitEase: row.garmentFitEase || defaultEaseForShape(shape),
      }).where(and(eq(productTypes.id, row.id), isNull(productTypes.garmentMeasurements)));
      measurements = copied;
    }
  }
  const chest = measurements?.columns?.find((column) => column.role === "chest");
  const hasChest = !!chest && !!measurements?.rows?.some((row) => Number(row.values?.[chest.key]) > 0);
  if (!measurements || !hasChest) return null;
  const shape = shapeOf(row);
  const shop = normalizeMyshopifyShopDomain(args.shop || row.shop || "");
  let guarantee: { title: string; detail: string; url: string } | null = null;
  if (shop) {
    const [installation] = await db
      .select({
        enabled: shopifyInstallations.sizeFinderGuaranteeEnabled,
        title: shopifyInstallations.sizeFinderGuaranteeTitle,
        detail: shopifyInstallations.sizeFinderGuaranteeDetail,
        url: shopifyInstallations.sizeFinderGuaranteeUrl,
      })
      .from(shopifyInstallations)
      .where(eq(shopifyInstallations.shopDomain, shop))
      .limit(1);
    if (installation?.enabled && installation.title && installation.detail) {
      guarantee = {
        title: installation.title,
        detail: installation.detail,
        url: installation.url || "",
      };
    }
  }
  return {
    productTypeId: row.id,
    garmentWord: String(row.garmentWord || "").trim() || "Garment",
    shape,
    ease: row.garmentFitEase || defaultEaseForShape(shape),
    measurements,
    guarantee,
  };
}

export function registerFindMySizeRoutes(app: Express, deps?: { isAuthenticated?: RequestHandler }) {
  if ((app as Express & { __findMySizePublic?: boolean }).__findMySizePublic) {
    registerFindMySizeAdmin(app, deps?.isAuthenticated);
    return;
  }
  (app as Express & { __findMySizePublic?: boolean }).__findMySizePublic = true;
  app.get("/api/storefront/find-my-size", async (req: Request, res: Response) => {
    try {
      const productTypeId = Number(req.query.productTypeId);
      const guide = await findMySizePayload({
        shop: String(req.query.shop || ""),
        productId: String(req.query.productId || ""),
        productTypeId: Number.isInteger(productTypeId) ? productTypeId : undefined,
      });
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json({ guide });
    } catch (err) {
      res.status(500).json({ guide: null, error: err instanceof Error ? err.message : String(err) });
    }
  });

  registerFindMySizeAdmin(app, deps?.isAuthenticated);
}

function registerFindMySizeAdmin(app: Express, auth?: RequestHandler) {
  if (!auth) return;
  app.get("/api/admin/size-finder", auth, async (req: any, res: Response) => {
    const shop = normalizeMyshopifyShopDomain(req.shopDomain || "");
    if (!shop) return res.status(400).json({ error: "Shop is not connected." });
    const [row] = await db
      .select({
        enabled: shopifyInstallations.sizeFinderGuaranteeEnabled,
        title: shopifyInstallations.sizeFinderGuaranteeTitle,
        detail: shopifyInstallations.sizeFinderGuaranteeDetail,
        url: shopifyInstallations.sizeFinderGuaranteeUrl,
      })
      .from(shopifyInstallations)
      .where(eq(shopifyInstallations.shopDomain, shop))
      .limit(1);
    res.json({
      enabled: row?.enabled === true,
      title: row?.title || "",
      detail: row?.detail || "",
      url: row?.url || "",
    });
  });
  app.patch("/api/admin/size-finder", auth, async (req: any, res: Response) => {
    const shop = normalizeMyshopifyShopDomain(req.shopDomain || "");
    if (!shop) return res.status(400).json({ error: "Shop is not connected." });
    const enabled = req.body?.enabled === true;
    const title = String(req.body?.title || "").trim();
    const detail = String(req.body?.detail || "").trim();
    const url = String(req.body?.url || "").trim();
    if (enabled && (!title || !detail)) {
      return res.status(400).json({ error: "A guarantee needs a title and a line of detail." });
    }
    const [updated] = await db
      .update(shopifyInstallations)
      .set({
        sizeFinderGuaranteeEnabled: enabled,
        sizeFinderGuaranteeTitle: title,
        sizeFinderGuaranteeDetail: detail,
        sizeFinderGuaranteeUrl: url,
      })
      .where(eq(shopifyInstallations.shopDomain, shop))
      .returning({ id: shopifyInstallations.id });
    if (!updated) return res.status(404).json({ error: "Shop installation was not found." });
    res.json({ enabled, title, detail, url });
  });
}
