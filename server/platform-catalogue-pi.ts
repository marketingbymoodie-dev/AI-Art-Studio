/**
 * Platform-catalogue Product Intelligence coverage.
 *
 * Ensures every published platform_catalog_blueprints entry has a reference
 * product_type (isPlatformCatalogRef) so daily Product Sync / OOS can store
 * COGS, shipping, availability, and history — and Profit Insights can load
 * instantly without a live Printify waterfall.
 */
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { listMerchantImportableCatalog } from "./platformCatalogStore";
import { fetchPrintifyProviderVariantsDual } from "./printifyCatalogVariantsFetch";
import {
  extractCostsFromCatalogVariants,
  parsePrintifyCostsCache,
  serializePrintifyCostsCache,
} from "@shared/printifyProductionCosts";
import { productTypes, type ProductType } from "@shared/schema";
import { syncProductTypeIntelligence } from "./product-intelligence-sync";

const TAG = "[platform-catalogue-pi]";
const DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function catalogToken(): string {
  return (process.env.PRINTIFY_API_TOKEN || "").trim();
}

async function resolvePlatformMerchantId(): Promise<string | null> {
  const ownerShop = (process.env.OWNER_SHOP_DOMAIN || "").toLowerCase().trim();
  if (ownerShop) {
    const m = await storage.getMerchantByShop(ownerShop);
    if (m?.id) return m.id;
    try {
      const created = await storage.getOrCreateShopifyMerchant(ownerShop);
      return created.id;
    } catch (e) {
      console.warn(`${TAG} Could not resolve owner merchant for ${ownerShop}:`, e);
    }
  }
  // Fallback: any merchant that already owns a platform catalog ref
  const all = await storage.getActiveProductTypes();
  const ref = all.find((pt) => (pt as any).isPlatformCatalogRef && pt.merchantId);
  return ref?.merchantId ?? null;
}

async function pickDefaultProviderId(
  blueprintId: number,
  token: string,
): Promise<{ providerId: number; title: string } | null> {
  try {
    const res = await fetch(
      `https://api.printify.com/v1/catalog/blueprints/${blueprintId}/print_providers.json`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const list = await res.json();
    if (!Array.isArray(list) || list.length === 0) return null;
    const sorted = [...list].sort((a, b) => {
      const aChoice = /printify choice/i.test(String(a?.title || "")) ? 1 : 0;
      const bChoice = /printify choice/i.test(String(b?.title || "")) ? 1 : 0;
      return bChoice - aChoice;
    });
    const p = sorted[0];
    const providerId = Number(p?.id);
    if (!Number.isFinite(providerId) || providerId <= 0) return null;
    return { providerId, title: String(p?.title || "") };
  } catch (e) {
    console.warn(`${TAG} providers fetch failed for bp ${blueprintId}:`, e);
    return null;
  }
}

function slugId(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

/** Build sizes / colors / variantMap from Printify catalog variants. */
export function buildCatalogVariantAxes(variants: any[]): {
  sizes: Array<{ id: string; name: string }>;
  colors: Array<{ id: string; name: string; hex: string }>;
  variantMap: Record<string, { printifyVariantId: number; providerId?: number }>;
  selectedSizeIds: string[];
  selectedColorIds: string[];
} {
  const sizesMap = new Map<string, { id: string; name: string }>();
  const colorsMap = new Map<string, { id: string; name: string; hex: string }>();
  const variantMap: Record<string, { printifyVariantId: number; providerId?: number }> = {};

  for (const v of variants) {
    const vid = Number(v?.id);
    if (!Number.isFinite(vid) || vid <= 0) continue;
    const opts = v?.options && typeof v.options === "object" ? v.options : {};
    const sizeName = String(opts.size || opts.Size || "").trim();
    const colorName = String(opts.color || opts.Color || "").trim();
    const title = String(v?.title || "").trim();

    let sizeId = "";
    let sizeLabel = sizeName;
    if (sizeName) {
      sizeId = slugId(sizeName) || sizeName;
      if (!sizesMap.has(sizeId)) sizesMap.set(sizeId, { id: sizeId, name: sizeName });
    } else if (title.includes(" / ")) {
      sizeLabel = title.split(" / ")[0]!.trim();
      sizeId = slugId(sizeLabel) || sizeLabel;
      if (sizeLabel && !sizesMap.has(sizeId)) sizesMap.set(sizeId, { id: sizeId, name: sizeLabel });
    }

    let colorId = "default";
    if (colorName) {
      colorId = slugId(colorName) || colorName;
      if (!colorsMap.has(colorId)) {
        colorsMap.set(colorId, { id: colorId, name: colorName, hex: "#888888" });
      }
    } else if (title.includes(" / ")) {
      const c = title.split(" / ").slice(1).join(" / ").trim();
      if (c) {
        colorId = slugId(c) || c;
        if (!colorsMap.has(colorId)) {
          colorsMap.set(colorId, { id: colorId, name: c, hex: "#888888" });
        }
      }
    }

    if (!sizeId) {
      sizeId = "one-size";
      if (!sizesMap.has(sizeId)) sizesMap.set(sizeId, { id: sizeId, name: "One size" });
    }

    const key = `${sizeId}:${colorId}`;
    if (!variantMap[key]) {
      variantMap[key] = { printifyVariantId: vid };
    }
  }

  if (Object.keys(variantMap).length === 0 && variants[0]?.id) {
    variantMap["one-size:default"] = { printifyVariantId: Number(variants[0].id) };
    if (!sizesMap.has("one-size")) sizesMap.set("one-size", { id: "one-size", name: "One size" });
  }

  const sizes = [...sizesMap.values()];
  const colors = [...colorsMap.values()];
  return {
    sizes,
    colors,
    variantMap,
    selectedSizeIds: sizes.map((s) => s.id),
    selectedColorIds: colors.map((c) => c.id),
  };
}

async function findCachedCostsForBlueprint(
  blueprintId: number,
  providerId: number,
): Promise<{ front: Record<string, number>; both: Record<string, number> }> {
  const all = await storage.getActiveProductTypes();
  for (const pt of all) {
    if (Number(pt.printifyBlueprintId) !== blueprintId) continue;
    if (Number(pt.printifyProviderId) !== providerId) continue;
    const parsed = parsePrintifyCostsCache(pt.printifyCosts);
    if (Object.keys(parsed.front).length > 0) return { front: parsed.front, both: parsed.both };
  }
  return { front: {}, both: {} };
}

export async function findPlatformCatalogRef(
  blueprintId: number,
): Promise<ProductType | undefined> {
  const all = await storage.getActiveProductTypes();
  return all.find(
    (pt) =>
      !!(pt as any).isPlatformCatalogRef &&
      Number(pt.printifyBlueprintId) === blueprintId &&
      pt.isActive !== false,
  );
}

/** Prefer merchant import, else platform catalogue reference product_type. */
export async function resolveInsightsProductTypeId(args: {
  blueprintId: number;
  merchantProductTypeId?: number | null;
}): Promise<number | null> {
  if (args.merchantProductTypeId != null && Number.isFinite(args.merchantProductTypeId)) {
    return Number(args.merchantProductTypeId);
  }
  const ref = await findPlatformCatalogRef(args.blueprintId);
  return ref?.id ?? null;
}

async function upsertPlatformRefForEntry(args: {
  blueprintId: number;
  label: string;
  kind: string;
  panelMappingTemplate?: string | null;
  merchantId: string;
  token: string;
}): Promise<"created" | "updated" | "error"> {
  const { blueprintId, label, kind, panelMappingTemplate, merchantId, token } = args;
  try {
    const existing = await findPlatformCatalogRef(blueprintId);
    const provider = await pickDefaultProviderId(blueprintId, token);
    if (!provider) {
      console.warn(`${TAG} No providers for blueprint ${blueprintId}`);
      return "error";
    }

    const dual = await fetchPrintifyProviderVariantsDual(
      blueprintId,
      provider.providerId,
      token,
    );
    const axes = buildCatalogVariantAxes(dual.variants);
    const catalogCosts = extractCostsFromCatalogVariants(dual.variants);
    const cached = await findCachedCostsForBlueprint(blueprintId, provider.providerId);
    const front = { ...cached.front, ...catalogCosts };
    const both = { ...cached.both };
    const printifyCosts =
      Object.keys(front).length > 0
        ? serializePrintifyCostsCache(
            Object.keys(both).length > 0 ? { front, both } : front,
          )
        : "{}";

    // Persist placeholder positions (needed for baseball Front/Back COGS detection).
    let placeholderPositions = "[]";
    const sampleVid = Number(dual.variants[0]?.id);
    if (Number.isFinite(sampleVid) && sampleVid > 0) {
      try {
        const phRes = await fetch(
          `https://api.printify.com/v1/catalog/blueprints/${blueprintId}/print_providers/${provider.providerId}/variants/${sampleVid}/placeholders.json`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (phRes.ok) {
          const phData = await phRes.json();
          const list = phData.placeholders || phData || [];
          if (Array.isArray(list) && list.length > 0) {
            placeholderPositions = JSON.stringify(
              list.map((p: any) => ({
                position: String(p?.position || "").trim(),
                width: p?.width ?? null,
                height: p?.height ?? null,
              })).filter((p: { position: string }) => p.position),
            );
          }
        }
      } catch (e) {
        console.warn(`${TAG} placeholders fetch failed for bp ${blueprintId}:`, e);
      }
    }

    const payload = {
      merchantId,
      name: label,
      description: null as string | null,
      printifyBlueprintId: blueprintId,
      printifyProviderId: provider.providerId,
      sizes: JSON.stringify(axes.sizes),
      frameColors: JSON.stringify(axes.colors),
      variantMap: JSON.stringify(axes.variantMap),
      selectedSizeIds: JSON.stringify(axes.selectedSizeIds),
      selectedColorIds: JSON.stringify(axes.selectedColorIds),
      printifyCosts,
      placeholderPositions,
      pricingStrategy: "notify_only" as const,
      isActive: true,
      isPlatformCatalogRef: true,
      isAllOverPrint: kind === "aop",
      panelMappingTemplate: panelMappingTemplate ?? null,
      sortOrder: 0,
    };

    if (existing) {
      await storage.updateProductType(existing.id, {
        name: payload.name,
        printifyProviderId: payload.printifyProviderId,
        sizes: payload.sizes,
        frameColors: payload.frameColors,
        variantMap: payload.variantMap,
        selectedSizeIds: payload.selectedSizeIds,
        selectedColorIds: payload.selectedColorIds,
        printifyCosts: payload.printifyCosts,
        placeholderPositions: payload.placeholderPositions,
        isPlatformCatalogRef: true,
        isAllOverPrint: payload.isAllOverPrint,
        panelMappingTemplate: payload.panelMappingTemplate,
        isActive: true,
      } as any);
      return "updated";
    }
    await storage.createProductType(payload as any);
    return "created";
  } catch (e) {
    console.error(`${TAG} ensure failed for bp ${blueprintId}:`, e);
    return "error";
  }
}

/** Ensure a single published blueprint has a platform PI reference row. */
export async function ensurePlatformCatalogueProductType(
  blueprintId: number,
): Promise<ProductType | undefined> {
  const token = catalogToken();
  if (!token) return findPlatformCatalogRef(blueprintId);
  const merchantId = await resolvePlatformMerchantId();
  if (!merchantId) return findPlatformCatalogRef(blueprintId);

  const entries = await listMerchantImportableCatalog();
  const entry = entries.find((e) => Number(e.printifyBlueprintId) === blueprintId);
  if (!entry) return findPlatformCatalogRef(blueprintId);

  await upsertPlatformRefForEntry({
    blueprintId,
    label: entry.label,
    kind: entry.kind,
    panelMappingTemplate: entry.panelMappingTemplate,
    merchantId,
    token,
  });
  const ref = await findPlatformCatalogRef(blueprintId);
  if (ref) {
    await syncProductTypeIntelligence(ref, token, {
      source: "ensure_single",
      skipShipping: false,
    });
  }
  return findPlatformCatalogRef(blueprintId);
}

/**
 * Create/update platform reference product_types for every published catalogue entry.
 * Returns counts for logging / sync summary.
 */
export async function ensurePlatformCatalogueProductTypes(): Promise<{
  ensured: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}> {
  const token = catalogToken();
  if (!token) {
    console.warn(`${TAG} PRINTIFY_API_TOKEN missing — cannot ensure catalogue coverage`);
    return { ensured: 0, created: 0, updated: 0, skipped: 0, errors: 0 };
  }

  const merchantId = await resolvePlatformMerchantId();
  if (!merchantId) {
    console.warn(
      `${TAG} No OWNER_SHOP_DOMAIN merchant — set OWNER_SHOP_DOMAIN so platform refs can be stored`,
    );
    return { ensured: 0, created: 0, updated: 0, skipped: 0, errors: 0 };
  }

  const entries = await listMerchantImportableCatalog();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const entry of entries) {
    const blueprintId = Number(entry.printifyBlueprintId);
    if (!Number.isFinite(blueprintId)) {
      skipped++;
      continue;
    }

    const result = await upsertPlatformRefForEntry({
      blueprintId,
      label: entry.label,
      kind: entry.kind,
      panelMappingTemplate: entry.panelMappingTemplate,
      merchantId,
      token,
    });
    if (result === "created") created++;
    else if (result === "updated") updated++;
    else errors++;
    await sleep(DELAY_MS);
  }

  const ensured = created + updated;
  console.log(
    `${TAG} ensure done: created=${created} updated=${updated} skipped=${skipped} errors=${errors}`,
  );
  return { ensured, created, updated, skipped, errors };
}

/**
 * Run Product Sync for all platform catalogue reference product_types
 * (uses PRINTIFY_API_TOKEN). Called from daily catalogue sync after ensure.
 */
export async function syncPlatformCatalogueRefs(opts: {
  syncRunId?: number | null;
  source?: string;
} = {}): Promise<{ synced: number; failures: number }> {
  const token = catalogToken();
  if (!token) return { synced: 0, failures: 0 };

  await ensurePlatformCatalogueProductTypes();

  const all = await storage.getActiveProductTypes();
  const refs = all.filter(
    (pt) =>
      !!(pt as any).isPlatformCatalogRef &&
      pt.printifyBlueprintId != null &&
      pt.printifyProviderId != null,
  );

  let synced = 0;
  let failures = 0;
  for (const pt of refs) {
    const result = await syncProductTypeIntelligence(pt, token, {
      syncRunId: opts.syncRunId ?? null,
      source: opts.source || "daily",
      skipShipping: false,
    });
    if (result.ok) synced++;
    else failures++;
    await sleep(DELAY_MS);
  }
  console.log(`${TAG} sync refs: synced=${synced} failures=${failures}`);
  return { synced, failures };
}

/** Blueprint → platform ref productTypeId map for catalogue API / Insights. */
export async function platformCatalogRefIdByBlueprint(): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  const all = await storage.getActiveProductTypes();
  for (const pt of all) {
    if (!(pt as any).isPlatformCatalogRef) continue;
    const bp = Number(pt.printifyBlueprintId);
    if (!Number.isFinite(bp)) continue;
    map.set(bp, pt.id);
  }
  return map;
}

/** True when column exists on a row (after migration). */
export function isPlatformCatalogRefRow(pt: ProductType | { isPlatformCatalogRef?: boolean | null }): boolean {
  return !!(pt as any).isPlatformCatalogRef;
}

/** Filter helper for OOS / sync inclusion. */
export async function listPlatformCatalogRefs(): Promise<ProductType[]> {
  const all = await storage.getActiveProductTypes();
  return all.filter((pt) => isPlatformCatalogRefRow(pt));
}

/** Mark existing rows if migration just added the column (no-op helper for tests). */
export async function countPlatformCatalogRefs(): Promise<number> {
  try {
    const rows = await db
      .select({ id: productTypes.id })
      .from(productTypes)
      .where(and(eq((productTypes as any).isPlatformCatalogRef, true)));
    return rows.length;
  } catch {
    return (await listPlatformCatalogRefs()).length;
  }
}
