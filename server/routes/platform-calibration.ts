/**
 * Platform-operator API: canonical product library harvest, publish, and calibrator.
 * Gated by OWNER_SHOP_DOMAIN / PLATFORM_ADMIN_SHOP_DOMAINS (dev: always allowed).
 */

import { type Express, type Response } from "express";
import { canonicalStorageKey } from "@shared/canonicalProducts";
import {
  getCanonicalPublishState,
  loadCanonicalManifest,
  publishCanonicalManifest,
} from "../canonicalFlatCalibration";
import {
  clearPlatformCatalogTag,
  getPlatformCatalogEntry,
  listMerchantImportableCatalog,
  listPlatformCatalogByKind,
  publishPlatformAopCatalogEntry,
  type PlatformCatalogEntry,
} from "../platformCatalogStore";
import {
  getPublishedHoodieTemplate,
  listPublishedTemplateNames,
} from "../hoodieTemplateStore";
import {
  buildHarvestColorsFromProductType,
  calibratorGeometryPath,
  calibratorLayerPaths,
  defaultCalibratorModelEntry,
  harvestFlatCalibration,
  mergeFlatCalibrationBlanks,
  normalizeHarvestBlankColorKey,
  sharedCalibratorLayerPaths,
  type CalibratorModelEntry,
  type FlatCalibrationManifest,
  type FlatCalibratorGeometry,
  type ViewName,
} from "../flat-calibration";
import { isPlatformAdminRequest, requirePlatformAdmin } from "../platformAdmin";
import {
  deleteFlatCalibrationAssetsByPrefix,
  downloadFlatCalibrationFile,
  publicFlatCalibrationUrl,
  resolveFlatCalibrationAssetUrl,
  uploadToFlatCalibrationBucket,
} from "../supabaseFlatCalibration";
import { detectPrintifyAllOverPrint } from "../printify-aop-detection";
import { shouldAllowFlatHarvest } from "@shared/productLayoutPolicy";
import { isPrintifyDecoratorUnavailableError } from "../printifyDecoratorErrors";

type StorageLike = {
  getProductTypes(): Promise<any[]>;
  getProductTypesByMerchant(merchantId: string): Promise<any[]>;
  getMerchantByUserId(userId: string): Promise<any>;
  getMerchantByShop(shop: string): Promise<any>;
};

type FlatCanonicalEntry = {
  blueprintId: number;
  label: string;
  brand?: string | null;
  category: string;
  kind: "flat" | "aop";
  panelMappingTemplate?: string | null;
};

type ReferenceProductLookup = {
  product: any | null;
  providerId: number | null;
  expectedBlueprintId: number;
  operatorBlueprintIds: number[];
  matchedVia: "owner_shop" | "session_merchant" | "global" | "catalog_api" | null;
};

const DEFAULT_CANONICAL_VERSION = 1;

function flatCanonicalEntryFromCatalog(entry: PlatformCatalogEntry): FlatCanonicalEntry | null {
  if (entry.kind !== "flat" && entry.kind !== "aop") return null;
  return {
    blueprintId: entry.printifyBlueprintId,
    label: entry.label,
    brand: entry.brand,
    category: entry.category ?? "",
    kind: entry.kind,
    panelMappingTemplate: entry.panelMappingTemplate,
  };
}

async function listFlatCanonicalEntries(): Promise<FlatCanonicalEntry[]> {
  const rows = await listPlatformCatalogByKind(["flat", "aop"]);
  return rows
    .map(flatCanonicalEntryFromCatalog)
    .filter((e): e is FlatCanonicalEntry => e != null);
}

async function getFlatCanonicalEntry(blueprintId: number): Promise<FlatCanonicalEntry | null> {
  const entry = await getPlatformCatalogEntry(blueprintId);
  if (!entry) return null;
  return flatCanonicalEntryFromCatalog(entry);
}

function referenceProductErrorMessage(lookup: ReferenceProductLookup): string {
  const imported = [...new Set(lookup.operatorBlueprintIds)].sort((a, b) => a - b);
  const importedHint =
    imported.length > 0
      ? `Operator shop has blueprint id(s): ${imported.join(", ")}.`
      : "No Printify blueprints imported on the operator shop yet.";
  const mismatchHint = imported.includes(lookup.expectedBlueprintId)
    ? "A matching product exists but is missing printifyProviderId — re-import the blueprint."
    : imported.length > 0
      ? `Expected blueprint ${lookup.expectedBlueprintId}; none of the imported products match.`
      : `Import blueprint ${lookup.expectedBlueprintId} on the operator shop first.`;
  return `${mismatchHint} ${importedHint}`;
}

async function listCatalogProviders(
  token: string,
  blueprintId: number,
): Promise<Array<{ id: number; title: string }>> {
  const res = await fetch(
    `https://api.printify.com/v1/catalog/blueprints/${blueprintId}/print_providers.json`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  );
  if (!res.ok) return [];
  const providers = await res.json();
  if (!Array.isArray(providers)) return [];
  return providers
    .map((p: { id?: number; title?: string }) => ({
      id: Number(p.id),
      title: String(p.title || `provider ${p.id}`),
    }))
    .filter((p) => Number.isFinite(p.id) && p.id > 0);
}

async function resolveProviderFromCatalog(
  token: string,
  blueprintId: number,
  preferredProviderId?: number | null,
): Promise<number | null> {
  const providers = await listCatalogProviders(token, blueprintId);
  if (providers.length === 0) return preferredProviderId ?? null;
  if (preferredProviderId && providers.some((p) => p.id === preferredProviderId)) {
    return preferredProviderId;
  }
  return providers[0]?.id ?? null;
}

function frameColorCount(pt: { frameColors?: unknown }): number {
  const raw = pt.frameColors;
  if (Array.isArray(raw)) return raw.length;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw || "[]");
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

/**
 * Ordered provider candidates for canonical harvest.
 * Prefer explicit override, then imported product types with the most colours
 * (UK/EU listings often have more in-stock colorways than a US OOS provider),
 * then remaining catalog providers. Shop create may still reject some
 * (decorator 6002) — caller retries the next candidate.
 */
async function buildHarvestProviderCandidates(args: {
  token: string;
  blueprintId: number;
  preferredProviderId?: number | null;
  productTypes: Array<{ printifyProviderId?: number | null; frameColors?: unknown }>;
}): Promise<number[]> {
  const catalog = await listCatalogProviders(args.token, args.blueprintId);
  const catalogIds = new Set(catalog.map((p) => p.id));
  const ordered: number[] = [];
  const push = (id: number | null | undefined) => {
    const n = Number(id);
    if (!Number.isFinite(n) || n <= 0) return;
    if (catalogIds.size > 0 && !catalogIds.has(n)) return;
    if (!ordered.includes(n)) ordered.push(n);
  };

  push(args.preferredProviderId ?? null);

  const byColors = [...args.productTypes].sort(
    (a, b) => frameColorCount(b) - frameColorCount(a),
  );
  for (const pt of byColors) push(pt.printifyProviderId);

  for (const p of catalog) push(p.id);

  return ordered;
}

async function listBlueprintProductTypes(
  storage: StorageLike,
  blueprintId: number,
  merchantIds: string[],
): Promise<any[]> {
  const out: any[] = [];
  const seen = new Set<number>();
  for (const merchantId of merchantIds) {
    const types = await storage.getProductTypesByMerchant(merchantId);
    for (const pt of types) {
      if (Number(pt.printifyBlueprintId) !== blueprintId) continue;
      if (seen.has(pt.id)) continue;
      seen.add(pt.id);
      out.push(pt);
    }
  }
  if (out.length === 0) {
    const all = await storage.getProductTypes();
    for (const pt of all) {
      if (Number(pt.printifyBlueprintId) !== blueprintId) continue;
      if (seen.has(pt.id)) continue;
      seen.add(pt.id);
      out.push(pt);
    }
  }
  return out;
}

async function findReferenceProduct(
  storage: StorageLike,
  creds: { merchant: any },
  blueprintId: number,
  sessionMerchantId?: string | null,
): Promise<ReferenceProductLookup> {
  const merchantIds: string[] = [];
  const ownerShop = process.env.OWNER_SHOP_DOMAIN?.trim();
  if (ownerShop) {
    const ownerMerchant = await storage.getMerchantByShop(ownerShop);
    if (ownerMerchant?.id) merchantIds.push(ownerMerchant.id);
  }
  if (creds.merchant?.id && !merchantIds.includes(creds.merchant.id)) {
    merchantIds.push(creds.merchant.id);
  }
  if (sessionMerchantId && !merchantIds.includes(sessionMerchantId)) {
    merchantIds.push(sessionMerchantId);
  }

  const operatorBlueprintIds: number[] = [];
  const tryMerchant = async (
    merchantId: string,
    matchedVia: ReferenceProductLookup["matchedVia"],
  ): Promise<any | null> => {
    const types = await storage.getProductTypesByMerchant(merchantId);
    for (const pt of types) {
      if (pt.printifyBlueprintId != null) {
        operatorBlueprintIds.push(Number(pt.printifyBlueprintId));
      }
      if (Number(pt.printifyBlueprintId) === blueprintId) {
        return { product: pt, matchedVia };
      }
    }
    return null;
  };

  for (const merchantId of merchantIds) {
    const matchedVia: ReferenceProductLookup["matchedVia"] =
      merchantId === merchantIds[0]
        ? ownerShop
          ? "owner_shop"
          : "session_merchant"
        : merchantId === sessionMerchantId
          ? "session_merchant"
          : "global";
    const hit = await tryMerchant(merchantId, matchedVia);
    if (hit?.product) {
      return {
        product: hit.product,
        providerId: hit.product.printifyProviderId ?? null,
        expectedBlueprintId: blueprintId,
        operatorBlueprintIds,
        matchedVia: hit.matchedVia,
      };
    }
  }

  const allTypes = await storage.getProductTypes();
  const global = allTypes.find((pt) => Number(pt.printifyBlueprintId) === blueprintId) ?? null;
  if (global) {
    return {
      product: global,
      providerId: global.printifyProviderId ?? null,
      expectedBlueprintId: blueprintId,
      operatorBlueprintIds,
      matchedVia: "global",
    };
  }

  return {
    product: null,
    providerId: null,
    expectedBlueprintId: blueprintId,
    operatorBlueprintIds,
    matchedVia: null,
  };
}

function parseJsonArray(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function loadGeometryJson(path: string): Promise<FlatCalibratorGeometry | null> {
  const buf = await downloadFlatCalibrationFile(path);
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString("utf-8")) as FlatCalibratorGeometry;
  } catch {
    return null;
  }
}

function mergeViewCalibration(
  manifest: Record<string, any> | null,
  modelId: string,
  view: ViewName,
): Record<string, any> | null {
  if (!manifest) return null;
  const base = manifest?.views?.[view];
  if (!base) return null;
  const override = manifest?.geometryByBlank?.[modelId]?.[view];
  if (!override) return { ...base };
  return {
    ...base,
    ...override,
    visibleRectNormalized: override.visibleRectNormalized ?? base.visibleRectNormalized,
    printBoundsNormalized: override.printBoundsNormalized ?? base.printBoundsNormalized,
    backFaceCropNormalized: override.backFaceCropNormalized ?? base.backFaceCropNormalized,
    phoneBackNormalized: override.phoneBackNormalized ?? base.phoneBackNormalized,
    safeZoneNormalized: override.safeZoneNormalized ?? base.safeZoneNormalized,
    sideProfileCropped: override.sideProfileCropped ?? base.sideProfileCropped,
    sideProfileSourceCropNormalized:
      override.sideProfileSourceCropNormalized ?? base.sideProfileSourceCropNormalized,
    mockupDims: override.mockupDims ?? base.mockupDims,
    printFileDims: override.printFileDims ?? base.printFileDims,
    maskUrl: override.maskUrl ?? base.maskUrl,
    shadingUrl: override.shadingUrl ?? base.shadingUrl,
    shadingMode: override.shadingMode ?? base.shadingMode,
    meshNodes: base.meshNodes,
    meshGrid: base.meshGrid,
    planarityScore: base.planarityScore,
    coverage: base.coverage,
  };
}

function phoneModelsFromProduct(productType: any): Array<{ id: string; name: string }> {
  const sizes = parseJsonArray(productType.sizes);
  const colors = buildHarvestColorsFromProductType({
    designerType: productType.designerType,
    frameColors: productType.frameColors,
    sizes: productType.sizes,
    variantMap: productType.variantMap,
  });
  if (colors.length > 0) {
    return colors.map((c) => ({ id: c.id, name: c.name || c.id }));
  }
  return sizes
    .filter((s: any) => s?.id)
    .map((s: any) => ({ id: String(s.id), name: String(s.name || s.id) }));
}

function resolveCalibratorModels(
  entry: FlatCanonicalEntry,
  manifest: Awaited<ReturnType<typeof loadCanonicalManifest>>,
  refProduct: any | null,
): Array<{ id: string; name: string }> {
  if (manifest?.blanks && Object.keys(manifest.blanks).length > 0) {
    return Object.keys(manifest.blanks).map((id) => ({
      id,
      name: (manifest.blanks as Record<string, { name?: string }>)?.[id]?.name ?? id,
    }));
  }

  if (refProduct) {
    const variants = phoneModelsFromProduct(refProduct);
    if (entry.category === "phone-cases" && variants.length > 0) {
      return variants;
    }
    if (variants.length > 1) {
      return variants;
    }
    if (variants.length === 1) {
      return variants;
    }
  }

  return [{ id: "default", name: entry.label || "Default" }];
}

function isHarvestComplete(manifest: Awaited<ReturnType<typeof loadCanonicalManifest>>): boolean {
  return !!(
    manifest?.views &&
    Object.keys(manifest.views).length > 0 &&
    manifest?.blanks &&
    Object.keys(manifest.blanks).length > 0
  );
}

export type HarvestOutcome = "none" | "ready" | "unsupported" | "failed";

function resolveHarvestOutcome(manifest: Awaited<ReturnType<typeof loadCanonicalManifest>>): {
  outcome: HarvestOutcome;
  error?: string;
} {
  if (!manifest?.generatedAt) return { outcome: "none" };
  if (isHarvestComplete(manifest)) return { outcome: "ready" };
  const err = typeof manifest.harvestError === "string" ? manifest.harvestError : undefined;
  if (manifest.harvestStatus === "failed") {
    return { outcome: "failed", error: err || "Harvest failed unexpectedly." };
  }
  if (manifest.tier === "reject" || manifest.harvestStatus === "unsupported") {
    return {
      outcome: "unsupported",
      error:
        err ||
        "Print area probe rejected this product (curved/wrap/3D or undetectable grid). Enable “Force flat harvest” on the catalog tag for operator overrides.",
    };
  }
  if (manifest.views && Object.keys(manifest.views).length > 0) {
    return {
      outcome: "failed",
      error: err || "Registration completed but blank garment photos could not be harvested.",
    };
  }
  return { outcome: "failed", error: err || "Harvest did not produce usable calibration assets." };
}

async function assetUrlsForStorage(
  storageKey: string,
  modelId: string,
  view: ViewName,
  baseView: Record<string, any> | null,
  blankFallbackUrl?: string | null,
) {
  const safe = modelId.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const paths = calibratorLayerPaths(storageKey, safe, view);
  const shared = sharedCalibratorLayerPaths(storageKey, view);
  const [pink, blank, mask, shading] = await Promise.all([
    resolveFlatCalibrationAssetUrl(
      paths.pink,
      publicFlatCalibrationUrl(shared.pink) ?? null,
    ),
    resolveFlatCalibrationAssetUrl(paths.blank, blankFallbackUrl),
    resolveFlatCalibrationAssetUrl(
      paths.mask,
      baseView?.maskUrl ?? publicFlatCalibrationUrl(shared.mask) ?? null,
    ),
    resolveFlatCalibrationAssetUrl(
      paths.shading,
      baseView?.shadingUrl ?? publicFlatCalibrationUrl(shared.shading) ?? null,
    ),
  ]);
  return { pink, blank, mask, shading };
}

async function resolvePlatformPrintifyCreds(
  storage: StorageLike,
  req: any,
): Promise<{ token: string; shopId: string; merchant: any } | null> {
  const userId = req.user?.claims?.sub;
  let merchant = userId ? await storage.getMerchantByUserId(userId) : null;
  const ownerShop = process.env.OWNER_SHOP_DOMAIN?.trim();
  if (ownerShop) {
    const ownerMerchant = await storage.getMerchantByShop(ownerShop);
    if (ownerMerchant?.printifyApiToken && ownerMerchant?.printifyShopId) {
      merchant = ownerMerchant;
    }
  }
  const token = merchant?.printifyApiToken || process.env.PRINTIFY_API_TOKEN || "";
  const shopId = merchant?.printifyShopId || process.env.PRINTIFY_SHOP_ID || "";
  if (!token || !shopId || !merchant) return null;
  return { token, shopId, merchant };
}

export function registerPlatformCalibrationRoutes(
  app: Express,
  deps: { storage: StorageLike; isAuthenticated: any },
) {
  const { storage, isAuthenticated } = deps;

  app.get("/api/platform/admin/status", isAuthenticated, (req: any, res: Response) => {
    res.json({ isPlatformAdmin: isPlatformAdminRequest(req) });
  });

  app.get("/api/platform/generation-health", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    const shops = await storage.listGenerationHealthSummary();
    res.json({ shops, currency: "USD" });
  });

  app.get("/api/admin/catalog/allowed-blueprints", isAuthenticated, async (_req: any, res: Response) => {
    const entries = await listMerchantImportableCatalog();
    const blueprints = await Promise.all(
      entries.map(async (e) => ({
        blueprintId: e.printifyBlueprintId,
        label: e.label,
        brand: e.brand,
        category: e.category ?? "",
        kind: e.kind,
        publish:
          e.kind === "flat" || e.kind === "aop"
            ? await getCanonicalPublishState(e.printifyBlueprintId)
            : { published: e.status === "published" },
      })),
    );
    res.json({ blueprints });
  });

  app.get("/api/platform/canonical/products", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    const entries = await listFlatCanonicalEntries();
    const products = await Promise.all(
      entries.map(async (e) => {
        const manifest =
          e.kind === "flat" ? await loadCanonicalManifest(e.blueprintId, DEFAULT_CANONICAL_VERSION) : null;
        const harvest = manifest ? resolveHarvestOutcome(manifest) : { outcome: "none" as const };
        return {
          ...e,
          harvestComplete: e.kind === "flat" ? isHarvestComplete(manifest) : false,
          harvestOutcome: e.kind === "flat" ? harvest.outcome : undefined,
          harvestError: e.kind === "flat" ? harvest.error : undefined,
          publish: await getCanonicalPublishState(e.blueprintId),
        };
      }),
    );
    res.json({ products });
  });

  app.get("/api/platform/flat-calibrator/:blueprintId", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const blueprintId = parseInt(req.params.blueprintId, 10);
      const version = parseInt(String(req.query.version || DEFAULT_CANONICAL_VERSION), 10);
      const entry = await getFlatCanonicalEntry(blueprintId);
      if (!entry || entry.kind !== "flat") {
        return res.status(404).json({ error: "Blueprint not in flat canonical registry" });
      }

      const storageKey = canonicalStorageKey(blueprintId, version);
      const manifest = await loadCanonicalManifest(blueprintId, version);
      const geometry =
        (await loadGeometryJson(calibratorGeometryPath(storageKey))) ??
        manifest?.calibratorGeometry ??
        null;

      const creds = await resolvePlatformPrintifyCreds(storage, req);
      const sessionMerchantId = req.user?.claims?.sub
        ? (await storage.getMerchantByUserId(req.user.claims.sub))?.id
        : null;
      let refProduct: any | null = null;
      if (creds) {
        const ref = await findReferenceProduct(storage, creds, blueprintId, sessionMerchantId);
        refProduct = ref.product;
      }

      const models = resolveCalibratorModels(entry, manifest, refProduct);
      const harvest = resolveHarvestOutcome(manifest);
      const modelPickerLabel =
        models.length <= 1
          ? null
          : entry.category === "phone-cases"
            ? "phone"
            : "variant";

      const view: ViewName = "front";
      const modelPayload = await Promise.all(
        models.map(async (m) => {
          const baseView = mergeViewCalibration(manifest as any, m.id, view);
          const blankFallbackUrl =
            (manifest as any)?.blanks?.[m.id]?.[view] ??
            (manifest as any)?.blanks?.[m.id]?.front ??
            null;
          return {
            modelId: m.id,
            name: m.name,
            assets: await assetUrlsForStorage(storageKey, m.id, view, baseView, blankFallbackUrl),
            geometry: geometry?.models?.[m.id]?.[view] ?? defaultCalibratorModelEntry(),
            baseView,
          };
        }),
      );
      res.json({
        blueprintId,
        version,
        storageKey,
        name: entry.label,
        category: entry.category,
        edgeWrap: !!manifest?.edgeWrap,
        harvestComplete: isHarvestComplete(manifest),
        harvestOutcome: harvest.outcome,
        harvestError: harvest.error,
        modelPickerLabel,
        models: modelPayload,
      });
    } catch (e) {
      console.error("[platform-calibrator] GET failed:", e);
      res.status(500).json({ error: "Failed to load calibrator state" });
    }
  });

  app.post("/api/platform/canonical/:blueprintId/harvest", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const blueprintId = parseInt(req.params.blueprintId, 10);
      const version = parseInt(String(req.body?.version || DEFAULT_CANONICAL_VERSION), 10);
      const entry = await getFlatCanonicalEntry(blueprintId);
      if (!entry || entry.kind !== "flat") {
        return res.status(404).json({ error: "Blueprint not in flat canonical registry" });
      }

      const catalogEntry = await getPlatformCatalogEntry(blueprintId);
      if (
        detectPrintifyAllOverPrint({ name: entry.label, blueprintId }) &&
        !shouldAllowFlatHarvest({
          name: entry.label,
          blueprintId,
          isAllOverPrint: true,
          forceFlatHarvest: catalogEntry?.forceFlatHarvest,
          fulfillmentLayout: catalogEntry?.fulfillmentLayout,
        })
      ) {
        return res.status(400).json({
          error:
            "This is an all-over print (AOP) product — enable “Force flat harvest” on the catalog tag, or set fulfillment to tote_folded_v1 with flat storefront mockups.",
          code: "AOP_NOT_FLAT",
        });
      }

      const creds = await resolvePlatformPrintifyCreds(storage, req);
      if (!creds) {
        return res.status(400).json({ error: "Platform Printify credentials not configured" });
      }

      const sessionMerchantId = req.user?.claims?.sub
        ? (await storage.getMerchantByUserId(req.user.claims.sub))?.id
        : null;
      const refLookup = await findReferenceProduct(storage, creds, blueprintId, sessionMerchantId);

      const merchantIds: string[] = [];
      const ownerShop = process.env.OWNER_SHOP_DOMAIN?.trim();
      if (ownerShop) {
        const ownerMerchant = await storage.getMerchantByShop(ownerShop);
        if (ownerMerchant?.id) merchantIds.push(ownerMerchant.id);
      }
      if (creds.merchant?.id && !merchantIds.includes(creds.merchant.id)) {
        merchantIds.push(creds.merchant.id);
      }
      if (sessionMerchantId && !merchantIds.includes(sessionMerchantId)) {
        merchantIds.push(sessionMerchantId);
      }

      const blueprintProducts = await listBlueprintProductTypes(storage, blueprintId, merchantIds);
      // Only honor an explicit body override as "preferred". Do not pin the first
      // reference product's provider (often JAMS) ahead of a UK listing with more
      // colours — shop create may reject that decorator (Printify 6002).
      const bodyProviderId = req.body?.providerId != null ? Number(req.body.providerId) : null;
      const providerCandidates = await buildHarvestProviderCandidates({
        token: creds.token,
        blueprintId,
        preferredProviderId:
          Number.isFinite(bodyProviderId) && bodyProviderId! > 0 ? bodyProviderId : null,
        productTypes: blueprintProducts,
      });

      if (providerCandidates.length === 0) {
        return res.status(400).json({
          error: referenceProductErrorMessage(refLookup),
          expectedBlueprintId: blueprintId,
          operatorBlueprintIds: [...new Set(refLookup.operatorBlueprintIds)].sort((a, b) => a - b),
          code: "REFERENCE_PRODUCT_REQUIRED",
        });
      }

      res.status(202).json({
        status: "running",
        blueprintId,
        version,
        providerCandidates,
      });

      void (async () => {
        const storageKey = canonicalStorageKey(blueprintId, version);
        let lastError: string | null = null;
        let accumulated: FlatCalibrationManifest | null = null;
        const providersUsed: number[] = [];
        let wiped = false;

        const writeManifest = async (
          manifest: FlatCalibrationManifest,
          status: string,
          error: string | null,
        ) => {
          await uploadToFlatCalibrationBucket(
            `${storageKey}/manifest.json`,
            Buffer.from(
              JSON.stringify(
                {
                  ...manifest,
                  canonicalVersion: version,
                  harvestStatus: status,
                  harvestError: error,
                  harvestProviderId: providersUsed[0] ?? manifest.providerId,
                  harvestProviderIds: providersUsed,
                },
                null,
                2,
              ),
              "utf-8",
            ),
            "application/json",
          );
        };

        const existingBlankIds = (): string[] =>
          Object.keys(accumulated?.blanks || {}).filter((k) => {
            const b = accumulated!.blanks[k];
            return !!(b?.front || b?.back);
          });

        try {
          // Pass 1: first provider that can create products wins for masks/geometry.
          // Pass 2+: other providers only add blank colours not already harvested
          // (e.g. JAMS Black/Red after UK White/*) — listings stay provider-scoped.
          for (let i = 0; i < providerCandidates.length; i++) {
            const providerId = providerCandidates[i]!;
            const ref =
              blueprintProducts.find(
                (pt) => Number(pt.printifyProviderId) === providerId,
              ) ?? null;
            const skipBlankColorIds = accumulated ? existingBlankIds() : [];
            console.log(
              `[platform-canonical] harvest bp ${blueprintId} v${version} provider ${providerId}` +
                ` (${i + 1}/${providerCandidates.length}` +
                `${ref ? `, pt ${ref.id}` : ", catalog colours"}` +
                `${skipBlankColorIds.length ? `, skip ${skipBlankColorIds.length} blanks` : ""})`,
            );
            try {
              const result = await harvestFlatCalibration({
                productTypeId: 0,
                name: entry.label,
                blueprintId,
                providerId,
                token: creds.token,
                shopId: creds.shopId,
                designerType: ref?.designerType ?? refLookup.product?.designerType,
                sizes: ref?.sizes ?? refLookup.product?.sizes,
                frameColors: ref?.frameColors,
                variantMap: ref?.variantMap,
                calibratorMode: true,
                wipeExisting: !wiped,
                storageKey,
                forceFlatHarvest:
                  !!(catalogEntry?.forceFlatHarvest || catalogEntry?.kind === "flat"),
                fulfillmentLayout: catalogEntry?.fulfillmentLayout ?? null,
                skipBlankColorIds,
              });
              wiped = true;

              const errMsg = result.error || "";
              if (
                (result.status === "failed" || result.status === "unsupported") &&
                isPrintifyDecoratorUnavailableError(errMsg)
              ) {
                lastError = errMsg;
                console.warn(
                  `[platform-canonical] provider ${providerId} unavailable for bp ${blueprintId}; trying next`,
                );
                continue;
              }

              if (!accumulated) {
                if (result.status !== "ready" && result.status !== "failed") {
                  // unsupported without decorator — stop
                  if (result.manifest) {
                    await writeManifest(
                      result.manifest,
                      result.status,
                      result.error ?? null,
                    );
                  }
                  console.log(
                    `[platform-canonical] harvest bp ${blueprintId} v${version} -> ${result.status} tier=${result.tier}` +
                      ` provider=${providerId}${result.error ? ` (${result.error})` : ""}`,
                  );
                  return;
                }
                if (result.status === "failed" && !result.manifest?.blanks) {
                  lastError = errMsg || "harvest failed";
                  continue;
                }
                accumulated = result.manifest
                  ? { ...result.manifest, blanks: { ...(result.manifest.blanks || {}) } }
                  : null;
                if (!accumulated) {
                  lastError = errMsg || "harvest returned no manifest";
                  continue;
                }
                providersUsed.push(providerId);
                await writeManifest(
                  accumulated,
                  result.status === "ready" ? "ready" : result.status,
                  result.error ?? null,
                );
                console.log(
                  `[platform-canonical] harvest bp ${blueprintId}: primary provider ${providerId} -> ${result.status}` +
                    ` blanks=${Object.keys(accumulated.blanks || {}).length}`,
                );
                // Continue to fill missing colours from other providers.
                continue;
              }

              // Secondary provider: merge only new blank keys.
              const added = mergeFlatCalibrationBlanks(accumulated, result.manifest);
              if (added > 0) providersUsed.push(providerId);
              await writeManifest(accumulated, "ready", null);
              console.log(
                `[platform-canonical] harvest bp ${blueprintId}: provider ${providerId} added ${added} blank(s)` +
                  ` (total ${Object.keys(accumulated.blanks || {}).length})`,
              );
            } catch (err) {
              const msg = (err as Error)?.message || String(err);
              lastError = msg;
              if (isPrintifyDecoratorUnavailableError(msg)) {
                console.warn(
                  `[platform-canonical] provider ${providerId} threw decorator error for bp ${blueprintId}; trying next: ${msg}`,
                );
                continue;
              }
              // Non-decorator errors on a fill pass shouldn't wipe a good primary harvest.
              if (accumulated) {
                console.warn(
                  `[platform-canonical] provider ${providerId} fill failed (keeping primary): ${msg}`,
                );
                continue;
              }
              throw err;
            }
          }

          if (accumulated) {
            await writeManifest(accumulated, "ready", null);
            console.log(
              `[platform-canonical] harvest bp ${blueprintId} v${version} complete` +
                ` providers=[${providersUsed.join(",")}]` +
                ` blanks=[${Object.keys(accumulated.blanks || {})
                  .map(normalizeHarvestBlankColorKey)
                  .join(", ")}]`,
            );
            return;
          }

          await writeManifest(
            {
              productTypeId: 0,
              name: entry.label,
              blueprintId,
              providerId: providerCandidates[0]!,
              tier: "reject",
              views: {},
              blanks: {},
              representativeGeometry: true,
              generatedAt: new Date().toISOString(),
            },
            "failed",
            lastError ||
              `No Printify print provider available for blueprint ${blueprintId} on this shop`,
          );
          console.error(
            `[platform-canonical] harvest failed bp ${blueprintId}: all providers rejected (${lastError})`,
          );
        } catch (err) {
          console.error(`[platform-canonical] harvest failed bp ${blueprintId}:`, err);
          try {
            await uploadToFlatCalibrationBucket(
              `${storageKey}/manifest.json`,
              Buffer.from(
                JSON.stringify(
                  {
                    blueprintId,
                    tier: "reject",
                    harvestStatus: "failed",
                    harvestError: (err as Error)?.message || "Harvest failed unexpectedly",
                    generatedAt: new Date().toISOString(),
                  },
                  null,
                  2,
                ),
                "utf-8",
              ),
              "application/json",
            );
          } catch (writeErr) {
            console.error(`[platform-canonical] failed to write harvest error manifest bp ${blueprintId}:`, writeErr);
          }
        }
      })();
    } catch (e) {
      console.error("[platform-canonical] harvest start failed:", e);
      res.status(500).json({ error: "Failed to start harvest" });
    }
  });

  app.get("/api/platform/canonical/aop-panel-templates", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    const templates = await listPublishedTemplateNames();
    res.json({ templates });
  });

  app.post("/api/platform/canonical/:blueprintId/publish-aop", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const blueprintId = parseInt(req.params.blueprintId, 10);
      const panelMappingTemplate = String(req.body?.panelMappingTemplate ?? "").trim();
      if (!panelMappingTemplate) {
        return res.status(400).json({ error: "panelMappingTemplate is required" });
      }

      const entry = await getFlatCanonicalEntry(blueprintId);
      if (!entry || entry.kind !== "aop") {
        return res.status(404).json({ error: "Blueprint not in AOP platform catalog" });
      }

      try {
        await getPublishedHoodieTemplate(panelMappingTemplate);
      } catch (err: any) {
        return res.status(400).json({
          error:
            `Panel template "${panelMappingTemplate}" is not available on Supabase yet. ` +
            "Open AOP Panel Mapper → Save → Publish first.",
          detail: err?.message || String(err),
        });
      }

      const row = await publishPlatformAopCatalogEntry(blueprintId, panelMappingTemplate);
      res.json({
        ok: true,
        published: await getCanonicalPublishState(blueprintId),
        tag: row,
      });
    } catch (e: any) {
      console.error("[platform-canonical] AOP publish failed:", e);
      res.status(500).json({ error: e?.message || "AOP publish failed" });
    }
  });

  app.post("/api/platform/canonical/:blueprintId/publish", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const blueprintId = parseInt(req.params.blueprintId, 10);
      const version = parseInt(String(req.body?.version || DEFAULT_CANONICAL_VERSION), 10);
      const entry = await getFlatCanonicalEntry(blueprintId);
      if (!entry || entry.kind !== "flat") {
        return res.status(404).json({ error: "Blueprint not in flat canonical registry" });
      }

      const manifest = await loadCanonicalManifest(blueprintId, version);
      if (!manifest || !manifest.views || Object.keys(manifest.views).length === 0) {
        return res.status(400).json({ error: "No harvested manifest found — run harvest first" });
      }

      const meta = await publishCanonicalManifest({
        blueprintId,
        version,
        manifest,
        tier: manifest.tier,
        label: entry.label,
      });

      res.json({ ok: true, published: meta });
    } catch (e: any) {
      console.error("[platform-canonical] publish failed:", e);
      res.status(500).json({ error: e?.message || "Publish failed" });
    }
  });

  app.delete("/api/platform/canonical/:blueprintId", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const blueprintId = parseInt(req.params.blueprintId, 10);
      const entry = await getPlatformCatalogEntry(blueprintId);
      if (!entry || (entry.kind !== "flat" && entry.kind !== "aop")) {
        return res.status(404).json({ error: "Product not in platform catalog" });
      }

      await clearPlatformCatalogTag(blueprintId);
      res.json({ ok: true, blueprintId });
    } catch (e: any) {
      console.error("[platform-canonical] remove failed:", e);
      res.status(500).json({ error: e?.message || "Failed to remove from platform catalog" });
    }
  });

  app.put("/api/platform/flat-calibrator/:blueprintId/geometry", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const blueprintId = parseInt(req.params.blueprintId, 10);
      const version = parseInt(String(req.body?.version || DEFAULT_CANONICAL_VERSION), 10);
      const { modelId, geometry, publishToManifest } = req.body ?? {};
      if (!modelId || !geometry) {
        return res.status(400).json({ error: "modelId and geometry required" });
      }

      const storageKey = canonicalStorageKey(blueprintId, version);
      const existing =
        (await loadGeometryJson(calibratorGeometryPath(storageKey))) ??
        ({ productTypeId: 0, models: {}, updatedAt: new Date().toISOString() } as FlatCalibratorGeometry);

      const view: ViewName = "front";
      if (!existing.models[modelId]) existing.models[modelId] = {};
      existing.models[modelId]![view] = geometry as CalibratorModelEntry;
      existing.updatedAt = new Date().toISOString();

      await uploadToFlatCalibrationBucket(
        calibratorGeometryPath(storageKey),
        Buffer.from(JSON.stringify(existing, null, 2), "utf-8"),
        "application/json",
      );

      if (publishToManifest) {
        const catalogEntry = await getFlatCanonicalEntry(blueprintId);
        const manifest =
          (await loadCanonicalManifest(blueprintId, version)) ?? {
            productTypeId: 0,
            name: catalogEntry?.label ?? "",
            blueprintId,
            providerId: 0,
            tier: "flat" as const,
            views: {},
            blanks: {},
            generatedAt: new Date().toISOString(),
          };

        manifest.calibratorGeometry = existing;
        manifest.generatedAt = new Date().toISOString();

        await uploadToFlatCalibrationBucket(
          `${storageKey}/manifest.json`,
          Buffer.from(JSON.stringify({ ...manifest, canonicalVersion: version }, null, 2), "utf-8"),
          "application/json",
        );
      }

      res.json({ ok: true });
    } catch (e) {
      console.error("[platform-calibrator] save geometry failed:", e);
      res.status(500).json({ error: "Failed to save geometry" });
    }
  });

  app.post("/api/platform/canonical/:blueprintId/wipe", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const blueprintId = parseInt(req.params.blueprintId, 10);
      const version = parseInt(String(req.body?.version || DEFAULT_CANONICAL_VERSION), 10);
      const removed = await deleteFlatCalibrationAssetsByPrefix(canonicalStorageKey(blueprintId, version));
      res.json({ ok: true, removed });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Wipe failed" });
    }
  });
}
