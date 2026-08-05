/**
 * Product Sync — sole writer of Product Intelligence from Printify.
 * Merchants / storefront / calculators read local PI only.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { fetchPrintifyProviderVariantsDual } from "./printifyCatalogVariantsFetch";
import {
  catalogSyncEvents,
  catalogSyncRuns,
  catalogVariantCostHistory,
  catalogVariantCosts,
  type Merchant,
  type ProductType,
} from "@shared/schema";
import {
  extractCostsFromCatalogVariants,
  parsePrintifyCostsCache,
  serializePrintifyCostsCache,
} from "@shared/printifyProductionCosts";
import {
  extractCatalogVariantIds,
  summarizeVariantAvailability,
} from "@shared/printifyAvailability";
import { buildActivePrintifyVariantLabels } from "@shared/printifyVariantLabels";
import {
  computeProductHealth,
  costChecksum,
  type ProductHealth,
  type VariantAvailabilityMap,
  type VariantAvailabilityStatus,
} from "@shared/productIntelligence";

const TAG = "[product-intelligence-sync]";
const CATALOG_FETCH_DELAY_MS = 350;
const SCAN_GUARD_MS = 20 * 60 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseVariantMap(pt: ProductType): Record<string, { printifyVariantId?: number | string }> {
  try {
    return typeof pt.variantMap === "string"
      ? JSON.parse(pt.variantMap || "{}")
      : ((pt.variantMap as any) || {});
  } catch {
    return {};
  }
}

function selectedPrintifyVariantIds(pt: ProductType): number[] {
  const map = parseVariantMap(pt);
  const ids: number[] = [];
  for (const entry of Object.values(map)) {
    const id = Number(entry?.printifyVariantId);
    if (Number.isFinite(id) && id > 0) ids.push(id);
  }
  return [...new Set(ids)];
}

function sizeColorForVariant(
  pt: ProductType,
  supplierVariantId: string,
): { size: string | null; color: string | null; mapKey: string | null } {
  const map = parseVariantMap(pt);
  for (const [key, entry] of Object.entries(map)) {
    if (String(entry?.printifyVariantId) === supplierVariantId) {
      const [size, color] = key.split(":");
      return { size: size || null, color: color || null, mapKey: key };
    }
  }
  return { size: null, color: null, mapKey: null };
}

function catalogVariantTitle(v: any): string {
  if (!v || typeof v !== "object") return "";
  if (typeof v.title === "string") return v.title;
  const opts = Array.isArray(v.options) ? v.options : [];
  return opts.map((o: any) => String(o?.value ?? o ?? "")).filter(Boolean).join(" / ");
}

async function fetchUsShippingByVariant(
  blueprintId: number,
  providerId: number,
  apiToken: string,
): Promise<{ byVariant: Record<string, number>; snapshot: unknown }> {
  const headers = {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };
  const byVariant: Record<string, number> = {};
  try {
    const listResp = await fetch(
      `https://api.printify.com/v2/catalog/blueprints/${blueprintId}/print_providers/${providerId}/shipping.json`,
      { headers },
    );
    if (!listResp.ok) {
      return { byVariant, snapshot: { error: `list ${listResp.status}` } };
    }
    const listData = await listResp.json();
    const tiers: string[] = (listData.data || [])
      .map((m: any) => m.attributes?.name)
      .filter(Boolean);
    // Prefer economy / standard-ish first
    const ordered = [...tiers].sort((a, b) => {
      const rank = (t: string) =>
        /econom/i.test(t) ? 0 : /standard|ground/i.test(t) ? 1 : 2;
      return rank(a) - rank(b);
    });
    const tierResults: Record<string, unknown[]> = {};
    for (const tier of ordered.slice(0, 3)) {
      const tierResp = await fetch(
        `https://api.printify.com/v2/catalog/blueprints/${blueprintId}/print_providers/${providerId}/shipping/${tier}.json`,
        { headers },
      );
      if (!tierResp.ok) continue;
      const tierData = await tierResp.json();
      const entries = (tierData.data || []).map((entry: any) => ({
        variantId: entry.attributes?.variantId,
        country: entry.attributes?.country?.code,
        firstItem: entry.attributes?.shippingCost?.firstItem?.amount,
        currency: entry.attributes?.shippingCost?.firstItem?.currency || "USD",
      }));
      tierResults[tier] = entries;
      for (const e of entries) {
        if (e.country !== "US" || e.variantId == null) continue;
        const cents = Number(e.firstItem);
        if (!Number.isFinite(cents)) continue;
        const key = String(e.variantId);
        if (byVariant[key] == null) byVariant[key] = Math.round(cents);
      }
    }
    return { byVariant, snapshot: { version: "v2", tiers: ordered, shipping: tierResults } };
  } catch (err: any) {
    return { byVariant, snapshot: { error: err?.message || String(err) } };
  }
}

export type ProductSyncResult = {
  productTypeId: number;
  ok: boolean;
  pricingVersion: number;
  productHealth: ProductHealth;
  variantsChecked: number;
  priceChanges: number;
  availabilityChanges: number;
  newVariants: number;
  removedVariants: number;
  error?: string;
};

async function upsertEvent(args: {
  productTypeId: number;
  syncRunId: number | null;
  pricingVersion: number;
  eventType: string;
  supplierVariantId?: string | null;
  printAreaKey?: string | null;
  payload?: Record<string, unknown>;
}) {
  await db.insert(catalogSyncEvents).values({
    productTypeId: args.productTypeId,
    syncRunId: args.syncRunId,
    pricingVersion: args.pricingVersion,
    eventType: args.eventType,
    supplierVariantId: args.supplierVariantId ?? null,
    printAreaKey: args.printAreaKey ?? null,
    payloadJson: JSON.stringify(args.payload || {}),
  });
}

/**
 * Sync one product type into Product Intelligence.
 * Uses catalog variants + cached/extracted COGS (does not create temp Printify products).
 * Call GET /api/admin/printify/costs first when a full waterfall refresh is needed.
 */
export async function syncProductTypeIntelligence(
  pt: ProductType,
  apiToken: string,
  opts: {
    syncRunId?: number | null;
    source?: string;
    skipShipping?: boolean;
  } = {},
): Promise<ProductSyncResult> {
  const syncRunId = opts.syncRunId ?? null;
  const blueprintId = Number(pt.printifyBlueprintId);
  const providerId = Number(pt.printifyProviderId);
  if (!Number.isFinite(blueprintId) || !Number.isFinite(providerId)) {
    return {
      productTypeId: pt.id,
      ok: false,
      pricingVersion: pt.pricingVersion ?? 0,
      productHealth: "attention_required",
      variantsChecked: 0,
      priceChanges: 0,
      availabilityChanges: 0,
      newVariants: 0,
      removedVariants: 0,
      error: "Missing blueprint or provider",
    };
  }

  try {
    const dual = await fetchPrintifyProviderVariantsDual(blueprintId, providerId, apiToken);
    const selectedIds = selectedPrintifyVariantIds(pt);
    const labels = buildActivePrintifyVariantLabels(pt);
    const summary = summarizeVariantAvailability({
      catalogVariants: dual.variants,
      selectedPrintifyVariantIds: selectedIds,
      availablePrintifyVariantIds: dual.inStockVariantIds,
      labelsByPrintifyVariantId: labels,
    });

    const catalogCosts = extractCostsFromCatalogVariants(dual.variants);
    const cached = parsePrintifyCostsCache(pt.printifyCosts);
    // Prefer fresh catalog costs; fall back to cache for gaps / both-tier.
    const frontCosts: Record<string, number> = { ...cached.front };
    for (const [k, v] of Object.entries(catalogCosts)) frontCosts[k] = v;
    const bothCosts: Record<string, number> = { ...cached.both };

    let shippingByVariant: Record<string, number> = {};
    let shippingSnapshot: unknown = {};
    if (!opts.skipShipping) {
      const ship = await fetchUsShippingByVariant(blueprintId, providerId, apiToken);
      shippingByVariant = ship.byVariant;
      shippingSnapshot = ship.snapshot;
    }

    const existing = await db
      .select()
      .from(catalogVariantCosts)
      .where(
        and(
          eq(catalogVariantCosts.productTypeId, pt.id),
          eq(catalogVariantCosts.supplier, "printify"),
        ),
      );

    const existingByKey = new Map(
      existing.map((row) => [`${row.supplierVariantId}::${row.printAreaKey}`, row]),
    );

    const nextVersion = (pt.pricingVersion ?? 0) + 1;
    let priceChanges = 0;
    let availabilityChanges = 0;
    let newVariants = 0;
    let removedVariants = 0;
    let variantsChecked = 0;

    const inStockSet = new Set(dual.inStockVariantIds.map(Number));
    const listedSet = new Set(
      dual.variants.map((v: any) => Number(v?.id)).filter((id: number) => Number.isFinite(id)),
    );

    const printAreaMaps: Array<{ key: string; costs: Record<string, number> }> = [
      { key: "front", costs: frontCosts },
    ];
    if (Object.keys(bothCosts).length > 0) {
      printAreaMaps.push({ key: "both", costs: bothCosts });
    }

    const seenKeys = new Set<string>();
    const availabilityMap: VariantAvailabilityMap = {};
    const titleById = new Map<string, string>();
    for (const v of dual.variants) {
      if (v?.id == null) continue;
      titleById.set(String(v.id), catalogVariantTitle(v));
    }

    const idsToPersist =
      selectedIds.length > 0 ? selectedIds : [...listedSet];

    for (const vid of idsToPersist) {
      const supplierVariantId = String(vid);
      const { size, color, mapKey } = sizeColorForVariant(pt, supplierVariantId);
      const available = inStockSet.has(vid);
      let availabilityStatus: VariantAvailabilityStatus = "unknown";
      if (listedSet.has(vid) || inStockSet.has(vid)) {
        availabilityStatus = available ? "in_stock" : "out_of_stock";
      } else {
        availabilityStatus = "removed";
      }
      if (mapKey) {
        availabilityMap[mapKey] =
          availabilityStatus === "in_stock" ? "in_stock" : availabilityStatus;
      }

      for (const area of printAreaMaps) {
        const cogs = area.costs[supplierVariantId] ?? area.costs[String(Number(supplierVariantId))];
        const ship = shippingByVariant[supplierVariantId] ?? null;
        const key = `${supplierVariantId}::${area.key}`;
        seenKeys.add(key);
        variantsChecked++;
        const prev = existingByKey.get(key);
        const checksum = costChecksum({
          cogsCents: cogs ?? null,
          shippingUsCents: ship,
          available: availabilityStatus === "in_stock",
        });
        const cogsChanged =
          prev != null &&
          cogs != null &&
          prev.baseCogsCents != null &&
          Number(prev.baseCogsCents) !== Number(cogs);
        const availChanged =
          prev != null &&
          (prev.available !== (availabilityStatus === "in_stock") ||
            prev.availabilityStatus !== availabilityStatus);
        const isNew = !prev;

        if (cogsChanged) priceChanges++;
        if (availChanged) availabilityChanges++;
        if (isNew) newVariants++;

        if (cogsChanged && prev) {
          await db.insert(catalogVariantCostHistory).values({
            productTypeId: pt.id,
            supplier: "printify",
            supplierVariantId,
            printAreaKey: area.key,
            pricingVersion: nextVersion,
            previousCogsCents: prev.baseCogsCents,
            newCogsCents: cogs ?? null,
            previousShippingUsCents: prev.shippingFirstItemUsCents,
            newShippingUsCents: ship,
            changeReason: "price_changed",
            syncRunId,
          });
          await upsertEvent({
            productTypeId: pt.id,
            syncRunId,
            pricingVersion: nextVersion,
            eventType: "price_changed",
            supplierVariantId,
            printAreaKey: area.key,
            payload: { previous: prev.baseCogsCents, next: cogs },
          });
        }
        if (availChanged) {
          await upsertEvent({
            productTypeId: pt.id,
            syncRunId,
            pricingVersion: nextVersion,
            eventType: available ? "back_in_stock" : "variant_unavailable",
            supplierVariantId,
            printAreaKey: area.key,
            payload: { previous: prev?.availabilityStatus, next: availabilityStatus },
          });
        }
        if (isNew) {
          await upsertEvent({
            productTypeId: pt.id,
            syncRunId,
            pricingVersion: nextVersion,
            eventType: "variant_added",
            supplierVariantId,
            printAreaKey: area.key,
          });
        }

        const row = {
          productTypeId: pt.id,
          supplier: "printify",
          blueprintId,
          providerId,
          supplierVariantId,
          productName: pt.name,
          variantName: labels[supplierVariantId] || titleById.get(supplierVariantId) || null,
          size,
          color,
          printAreaKey: area.key,
          baseCogsCents: cogs ?? null,
          previousCogsCents: cogsChanged ? prev?.baseCogsCents ?? null : prev?.previousCogsCents ?? null,
          shippingFirstItemUsCents: ship,
          currency: "USD",
          available: availabilityStatus === "in_stock",
          availabilityStatus,
          priceChanged: !!cogsChanged,
          availabilityChanged: !!availChanged,
          isNewVariant: isNew,
          isRemoved: false,
          pricingVersion: nextVersion,
          costChecksum: checksum,
          lastSyncedAt: new Date(),
          priceLastChangedAt: cogsChanged ? new Date() : prev?.priceLastChangedAt ?? null,
          updatedAt: new Date(),
        };

        if (prev) {
          await db
            .update(catalogVariantCosts)
            .set(row)
            .where(eq(catalogVariantCosts.id, prev.id));
        } else {
          await db.insert(catalogVariantCosts).values(row);
        }
      }
    }

    // Mark removed variants (were in DB for this product, not in current selected/listed set)
    for (const prev of existing) {
      const key = `${prev.supplierVariantId}::${prev.printAreaKey}`;
      if (seenKeys.has(key)) continue;
      if (prev.isRemoved) continue;
      removedVariants++;
      await db
        .update(catalogVariantCosts)
        .set({
          isRemoved: true,
          available: false,
          availabilityStatus: "removed",
          availabilityChanged: true,
          pricingVersion: nextVersion,
          updatedAt: new Date(),
          lastSyncedAt: new Date(),
        })
        .where(eq(catalogVariantCosts.id, prev.id));
      await upsertEvent({
        productTypeId: pt.id,
        syncRunId,
        pricingVersion: nextVersion,
        eventType: "variant_removed",
        supplierVariantId: prev.supplierVariantId,
        printAreaKey: prev.printAreaKey,
      });
    }

    // Margin signal: if merchant set a floor and we have COGS, flag when typical
    // suggested retail at stored markup would breach min margin vs that COGS
    // (retail auto-update is separate — Resync Prices / maintain_margin).
    let marginBelowThreshold = false;
    const minMargin = pt.minMarginPercent;
    const markup = pt.defaultMarkupPercent;
    if (
      minMargin != null &&
      Number.isFinite(minMargin) &&
      markup != null &&
      Number.isFinite(markup) &&
      Object.keys(frontCosts).length > 0
    ) {
      const sampleCogs = Object.values(frontCosts).find((c) => c > 0);
      if (sampleCogs != null) {
        const impliedMargin = (markup / (100 + markup)) * 100;
        marginBelowThreshold = impliedMargin + 0.01 < minMargin;
      }
    }

    const health = computeProductHealth({
      fullyOos: summary.status === "fully_oos",
      partialOos: summary.status === "critical",
      priceChanged: priceChanges > 0,
      availabilityChanged: availabilityChanges > 0 || removedVariants > 0,
      newOrRemovedVariants: newVariants > 0 || removedVariants > 0,
      marginBelowThreshold,
    });

    const printifyCosts = serializePrintifyCostsCache(
      Object.keys(bothCosts).length > 0
        ? { front: frontCosts, both: bothCosts }
        : frontCosts,
    );

    await storage.updateProductType(pt.id, {
      pricingVersion: nextVersion,
      lastProductSyncAt: new Date(),
      productHealth: health,
      variantAvailability: JSON.stringify(availabilityMap),
      shippingSnapshot: JSON.stringify(shippingSnapshot),
      printifyCosts,
      lastOosScanAt: new Date(),
      oosAvailableVariants: summary.availableSelected,
      oosTotalVariants: summary.totalSelected,
      oosStatus: summary.status,
      oosDetail: JSON.stringify({
        unavailableLabels: summary.unavailableLabels,
        error: null,
        source: "product_sync",
      }),
    } as Partial<ProductType>);

    return {
      productTypeId: pt.id,
      ok: true,
      pricingVersion: nextVersion,
      productHealth: health,
      variantsChecked,
      priceChanges,
      availabilityChanges,
      newVariants,
      removedVariants,
    };
  } catch (err: any) {
    console.error(`${TAG} sync failed for product type ${pt.id}:`, err);
    const health: ProductHealth = "attention_required";
    await storage.updateProductType(pt.id, { productHealth: health } as Partial<ProductType>);
    await upsertEvent({
      productTypeId: pt.id,
      syncRunId,
      pricingVersion: pt.pricingVersion ?? 0,
      eventType: "sync_failure",
      payload: { error: err?.message || String(err) },
    });
    return {
      productTypeId: pt.id,
      ok: false,
      pricingVersion: pt.pricingVersion ?? 0,
      productHealth: health,
      variantsChecked: 0,
      priceChanges: 0,
      availabilityChanges: 0,
      newVariants: 0,
      removedVariants: 0,
      error: err?.message || String(err),
    };
  }
}

/** Backfill PI rows from existing printify_costs JSON (no Printify call). */
export async function backfillProductTypeFromCosts(pt: ProductType): Promise<number> {
  const { front, both } = parsePrintifyCostsCache(pt.printifyCosts);
  const labels = buildActivePrintifyVariantLabels(pt);
  const areas: Array<{ key: string; costs: Record<string, number> }> = [
    { key: "front", costs: front },
  ];
  if (Object.keys(both).length > 0) areas.push({ key: "both", costs: both });

  let inserted = 0;
  const version = Math.max(1, pt.pricingVersion ?? 0);
  for (const area of areas) {
    for (const [vid, cogs] of Object.entries(area.costs)) {
      const { size, color } = sizeColorForVariant(pt, vid);
      const existing = await db
        .select({ id: catalogVariantCosts.id })
        .from(catalogVariantCosts)
        .where(
          and(
            eq(catalogVariantCosts.productTypeId, pt.id),
            eq(catalogVariantCosts.supplier, "printify"),
            eq(catalogVariantCosts.supplierVariantId, vid),
            eq(catalogVariantCosts.printAreaKey, area.key),
          ),
        )
        .limit(1);
      if (existing.length > 0) continue;
      await db.insert(catalogVariantCosts).values({
        productTypeId: pt.id,
        supplier: "printify",
        blueprintId: pt.printifyBlueprintId,
        providerId: pt.printifyProviderId,
        supplierVariantId: vid,
        productName: pt.name,
        variantName: labels[vid] || null,
        size,
        color,
        printAreaKey: area.key,
        baseCogsCents: cogs,
        currency: "USD",
        available: true,
        availabilityStatus: "unknown",
        pricingVersion: version,
        costChecksum: costChecksum({ cogsCents: cogs, shippingUsCents: null, available: true }),
      });
      inserted++;
    }
  }
  if ((pt.pricingVersion ?? 0) < 1) {
    await storage.updateProductType(pt.id, { pricingVersion: 1 } as Partial<ProductType>);
  }
  return inserted;
}

export async function runCatalogueProductSync(opts: {
  force?: boolean;
  source?: string;
  productTypeId?: number;
  skipShipping?: boolean;
} = {}): Promise<{
  ran: boolean;
  runId?: number;
  results?: ProductSyncResult[];
}> {
  if (!opts.force && !opts.productTypeId) {
    const [last] = await db
      .select()
      .from(catalogSyncRuns)
      .where(eq(catalogSyncRuns.scope, "catalogue"))
      .orderBy(desc(catalogSyncRuns.startedAt))
      .limit(1);
    if (last?.startedAt && Date.now() - last.startedAt.getTime() < SCAN_GUARD_MS) {
      console.log(`${TAG} Skipping catalogue sync — last ran recently`);
      return { ran: false };
    }
  }

  // Catalogue-wide runs: seed platform reference product_types for every published blueprint.
  if (!opts.productTypeId) {
    try {
      const { ensurePlatformCatalogueProductTypes } = await import("./platform-catalogue-pi");
      await ensurePlatformCatalogueProductTypes();
    } catch (e) {
      console.error(`${TAG} ensurePlatformCatalogueProductTypes failed:`, e);
    }
  }

  const [run] = await db
    .insert(catalogSyncRuns)
    .values({
      scope: opts.productTypeId ? "product" : "catalogue",
      productTypeId: opts.productTypeId ?? null,
      source: opts.source || "manual",
      status: "running",
    })
    .returning();

  const catalogToken = (process.env.PRINTIFY_API_TOKEN || "").trim();

  const allPts = opts.productTypeId
    ? ([await storage.getProductType(opts.productTypeId)].filter(Boolean) as ProductType[])
    : (await storage.getActiveProductTypes()).filter(
        (pt) =>
          pt.printifyBlueprintId != null &&
          pt.printifyProviderId != null &&
          (pt.merchantId != null || !!(pt as any).isPlatformCatalogRef),
      );

  // Deduplicate: when both a merchant import and a platform ref share the same
  // blueprint+provider, sync both (merchant retail strategy may differ) — but
  // prefer catalog token for platform refs.
  const merchantCache = new Map<string, Merchant | null>();
  const results: ProductSyncResult[] = [];
  let productsChecked = 0;
  let variantsChecked = 0;
  let priceChanges = 0;
  let availabilityChanges = 0;
  let newVariants = 0;
  let removedVariants = 0;
  let syncFailures = 0;

  for (const pt of allPts) {
    const isPlatformRef = !!(pt as any).isPlatformCatalogRef;
    let apiToken: string | undefined;
    if (isPlatformRef && catalogToken) {
      apiToken = catalogToken;
    } else if (pt.merchantId) {
      const merchantId = pt.merchantId as string;
      let merchant = merchantCache.get(merchantId);
      if (merchant === undefined) {
        merchant = (await storage.getMerchant(merchantId)) ?? null;
        merchantCache.set(merchantId, merchant);
      }
      apiToken = merchant?.printifyApiToken?.trim() || catalogToken || undefined;
    } else {
      apiToken = catalogToken || undefined;
    }

    if (!apiToken) {
      syncFailures++;
      results.push({
        productTypeId: pt.id,
        ok: false,
        pricingVersion: pt.pricingVersion ?? 0,
        productHealth: "attention_required",
        variantsChecked: 0,
        priceChanges: 0,
        availabilityChanges: 0,
        newVariants: 0,
        removedVariants: 0,
        error: "No Printify API token",
      });
      continue;
    }

    const result = await syncProductTypeIntelligence(pt, apiToken, {
      syncRunId: run.id,
      source: opts.source,
      // Platform refs always pull shipping for Insights; merchant sync respects flag.
      skipShipping: isPlatformRef ? false : opts.skipShipping,
    });
    results.push(result);
    productsChecked++;
    variantsChecked += result.variantsChecked;
    priceChanges += result.priceChanges;
    availabilityChanges += result.availabilityChanges;
    newVariants += result.newVariants;
    removedVariants += result.removedVariants;
    if (!result.ok) syncFailures++;
    await sleep(CATALOG_FETCH_DELAY_MS);
  }

  await db
    .update(catalogSyncRuns)
    .set({
      status: syncFailures > 0 && productsChecked === syncFailures ? "failed" : "complete",
      productsChecked,
      variantsChecked,
      priceChanges,
      availabilityChanges,
      newVariants,
      removedVariants,
      syncFailures,
      summaryJson: JSON.stringify({
        results: results.map((r) => ({
          productTypeId: r.productTypeId,
          ok: r.ok,
          health: r.productHealth,
          error: r.error,
        })),
      }),
      finishedAt: new Date(),
    })
    .where(eq(catalogSyncRuns.id, run.id));

  console.log(
    `${TAG} run ${run.id} complete: products=${productsChecked} variants=${variantsChecked} priceΔ=${priceChanges} availΔ=${availabilityChanges} failures=${syncFailures}`,
  );

  return { ran: true, runId: run.id, results };
}

export async function getProductIntelligence(productTypeId: number) {
  const pt = await storage.getProductType(productTypeId);
  if (!pt) return null;
  const variants = await db
    .select()
    .from(catalogVariantCosts)
    .where(
      and(
        eq(catalogVariantCosts.productTypeId, productTypeId),
        eq(catalogVariantCosts.isRemoved, false),
      ),
    );
  const events = await db
    .select()
    .from(catalogSyncEvents)
    .where(eq(catalogSyncEvents.productTypeId, productTypeId))
    .orderBy(desc(catalogSyncEvents.createdAt))
    .limit(50);
  return { productType: pt, variants, events };
}

export async function listRecentSyncRuns(limit = 20) {
  return db
    .select()
    .from(catalogSyncRuns)
    .orderBy(desc(catalogSyncRuns.startedAt))
    .limit(limit);
}

export async function listRecentSyncEvents(opts: {
  limit?: number;
  syncRunId?: number;
  eventType?: string;
} = {}) {
  const limit = opts.limit ?? 100;
  const conditions = [];
  if (opts.syncRunId != null && Number.isFinite(opts.syncRunId)) {
    conditions.push(eq(catalogSyncEvents.syncRunId, opts.syncRunId));
  }
  if (opts.eventType) {
    conditions.push(eq(catalogSyncEvents.eventType, opts.eventType));
  }
  if (conditions.length === 0) {
    return db.select().from(catalogSyncEvents).orderBy(desc(catalogSyncEvents.createdAt)).limit(limit);
  }
  return db
    .select()
    .from(catalogSyncEvents)
    .where(conditions.length === 1 ? conditions[0]! : and(...conditions))
    .orderBy(desc(catalogSyncEvents.createdAt))
    .limit(limit);
}

/** Operator overview: health counts + products needing attention. */
export async function getCatalogueHealthOverview(limit = 80) {
  const pts = (await storage.getActiveProductTypes()).filter(
    (pt) => pt.printifyBlueprintId != null && pt.printifyProviderId != null,
  );
  const counts = { healthy: 0, needs_review: 0, attention_required: 0, unknown: 0 };
  const attention: Array<{
    id: number;
    name: string;
    merchantId: string | null;
    productHealth: string;
    lastProductSyncAt: Date | null;
    oosStatus: string | null;
    pricingStrategy: string;
  }> = [];
  for (const pt of pts) {
    const h = String(pt.productHealth || "unknown");
    if (h === "healthy") counts.healthy++;
    else if (h === "needs_review") counts.needs_review++;
    else if (h === "attention_required") counts.attention_required++;
    else counts.unknown++;
    if (h === "needs_review" || h === "attention_required") {
      attention.push({
        id: pt.id,
        name: pt.name,
        merchantId: pt.merchantId ?? null,
        productHealth: h,
        lastProductSyncAt: pt.lastProductSyncAt ?? null,
        oosStatus: pt.oosStatus ?? null,
        pricingStrategy: pt.pricingStrategy ?? "notify_only",
      });
    }
  }
  attention.sort((a, b) => {
    if (a.productHealth !== b.productHealth) {
      return a.productHealth === "attention_required" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  return {
    total: pts.length,
    counts,
    attention: attention.slice(0, limit),
  };
}

export async function getVariantCostHistory(
  productTypeId: number,
  supplierVariantId?: string,
  printAreaKey?: string,
) {
  const conditions = [eq(catalogVariantCostHistory.productTypeId, productTypeId)];
  if (supplierVariantId) {
    conditions.push(eq(catalogVariantCostHistory.supplierVariantId, supplierVariantId));
  }
  if (printAreaKey) {
    conditions.push(eq(catalogVariantCostHistory.printAreaKey, printAreaKey));
  }
  return db
    .select()
    .from(catalogVariantCostHistory)
    .where(and(...conditions))
    .orderBy(desc(catalogVariantCostHistory.changedAt))
    .limit(100);
}

/** Ensure PI rows exist from cache; used on import / first open. */
export async function ensureBackfillForProductType(productTypeId: number): Promise<number> {
  const pt = await storage.getProductType(productTypeId);
  if (!pt) return 0;
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(catalogVariantCosts)
    .where(eq(catalogVariantCosts.productTypeId, productTypeId));
  if (count > 0) return 0;
  return backfillProductTypeFromCosts(pt);
}

/**
 * Build the legacy `/api/admin/printify/costs` JSON shape from Product Intelligence rows.
 * Returns null when PI does not cover active Printify variant ids (caller falls through to waterfall).
 */
export async function costsResponseFromProductIntelligence(productType: ProductType): Promise<{
  costs: Record<string, number>;
  costsBoth: Record<string, number>;
  shopifyVariantCosts: Record<string, number>;
  shopifyVariantCostsBoth: Record<string, number>;
  printifyVariantLabels: Record<string, string>;
  costsByNormalizedLabel: Record<string, number>;
  costsBothByNormalizedLabel: Record<string, number>;
  supportsBothSides: boolean;
  cached: boolean;
  source: "product_intelligence";
} | null> {
  await ensureBackfillForProductType(productType.id);

  const rows = await db
    .select()
    .from(catalogVariantCosts)
    .where(
      and(
        eq(catalogVariantCosts.productTypeId, productType.id),
        eq(catalogVariantCosts.supplier, "printify"),
        eq(catalogVariantCosts.isRemoved, false),
      ),
    );
  if (rows.length === 0) return null;

  const variantMap = JSON.parse(productType.variantMap || "{}") as Record<
    string,
    { printifyVariantId?: number | string }
  >;
  const currentIds = new Set<number>();
  for (const entry of Object.values(variantMap)) {
    if (entry?.printifyVariantId) currentIds.add(Number(entry.printifyVariantId));
  }
  if (currentIds.size === 0) return null;

  const costs: Record<string, number> = {};
  const costsBoth: Record<string, number> = {};
  const labels: Record<string, string> = {};

  for (const row of rows) {
    const vid = String(row.supplierVariantId);
    const n = Number(vid);
    if (!Number.isFinite(n) || !currentIds.has(n)) continue;
    if (row.baseCogsCents == null || !Number.isFinite(row.baseCogsCents)) continue;
    const area = String(row.printAreaKey || "front").toLowerCase();
    if (area === "both" || area === "front+back" || area === "front_back") {
      costsBoth[vid] = row.baseCogsCents;
    } else {
      // "front" and AOP / other single-area keys all count as base (front) COGS.
      if (costs[vid] == null) costs[vid] = row.baseCogsCents;
    }
    if (row.variantName) labels[vid] = row.variantName;
  }

  // Prefer full coverage; if incomplete but we have usable COGS, still return PI
  // (Create Page / Refresh should not hard-fail when most variants are priced).
  let covered = 0;
  for (const id of currentIds) {
    if (costs[String(id)] != null || costs[String(Number(id))] != null) covered++;
  }
  if (covered === 0) return null;
  const coverageRatio = covered / currentIds.size;
  if (coverageRatio < 0.5 && covered < 4) return null;

  const sizes = JSON.parse(productType.sizes || "[]") as Array<{ id: string; name: string }>;
  const frameColors = JSON.parse(productType.frameColors || "[]") as Array<{ id: string; name: string }>;
  const nameToVmKey: Record<string, string> = {};
  for (const [key, entry] of Object.entries(variantMap)) {
    if (!entry?.printifyVariantId) continue;
    const [sizeId, colorId] = key.split(":");
    const sizeName = sizes.find((s) => String(s.id) === sizeId)?.name ?? sizeId;
    const colorName = frameColors.find((c) => String(c.id) === colorId)?.name;
    const vid = String(entry.printifyVariantId);
    if (!labels[vid]) {
      labels[vid] =
        colorName && colorId !== "default" ? `${sizeName} / ${colorName}` : sizeName;
    }
    const nameKey = colorName ? `${sizeName}:${colorName}` : `${sizeName}:default`;
    nameToVmKey[nameKey] = key;
  }

  const svIds = (
    typeof productType.shopifyVariantIds === "string"
      ? JSON.parse(productType.shopifyVariantIds || "{}")
      : productType.shopifyVariantIds || {}
  ) as Record<string, number>;

  const shopifyVariantCosts: Record<string, number> = {};
  const shopifyVariantCostsBoth: Record<string, number> = {};
  for (const [mapKey, shopifyVid] of Object.entries(svIds)) {
    let vmEntry = variantMap[mapKey] as { printifyVariantId?: number | string } | undefined;
    if (!vmEntry?.printifyVariantId) {
      const bridged = nameToVmKey[mapKey];
      if (bridged) vmEntry = variantMap[bridged];
    }
    if (!vmEntry?.printifyVariantId) continue;
    const pvid = String(vmEntry.printifyVariantId);
    if (costs[pvid] !== undefined) shopifyVariantCosts[String(shopifyVid)] = costs[pvid];
    if (costsBoth[pvid] !== undefined) shopifyVariantCostsBoth[String(shopifyVid)] = costsBoth[pvid];
  }

  const norm = (label: string) =>
    label
      .toLowerCase()
      .replace(/\s*\/\s*/g, "/")
      .replace(/\s+/g, " ")
      .trim();
  const costsByNormalizedLabel: Record<string, number> = {};
  const costsBothByNormalizedLabel: Record<string, number> = {};
  for (const [vid, label] of Object.entries(labels)) {
    const key = norm(label);
    if (costs[vid] != null) costsByNormalizedLabel[key] = costs[vid];
    if (costsBoth[vid] != null) costsBothByNormalizedLabel[key] = costsBoth[vid];
  }

  return {
    costs,
    costsBoth,
    shopifyVariantCosts,
    shopifyVariantCostsBoth,
    printifyVariantLabels: labels,
    costsByNormalizedLabel,
    costsBothByNormalizedLabel,
    supportsBothSides: Object.keys(costsBoth).length > 0,
    cached: true,
    source: "product_intelligence",
  };
}
