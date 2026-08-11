/**
 * Versioned pricing catalogues — DB SSOT for plan fees/gens/caps/overage.
 *
 * Commit writes a committed row; activate flips the single active pointer.
 * Enforcement uses installation.pricingVersion; new subs use active.
 */
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { pricingCataloguePlans, pricingCatalogues } from "@shared/schema";
import {
  SEED_PRICING_VERSION,
  buildSeedCatalogueSnapshot,
  findCataloguePlan,
  getPlanOverageCappedAmountForCatalogue,
  overageUsageTermsForCatalogue,
  planDefinitionsFromCatalogue,
  resolveOveragePriceUsd,
  type CataloguePlanRow,
  type OveragePriceTier,
  type PricingCatalogueSnapshot,
} from "@shared/customizerPlans";

const TAG = "[pricing-catalogue]";

let activeCache: { at: number; snapshot: PricingCatalogueSnapshot } | null = null;
const CACHE_MS = 5_000;
const byIdCache = new Map<number, { at: number; snapshot: PricingCatalogueSnapshot }>();

function invalidateCaches() {
  activeCache = null;
  byIdCache.clear();
}

function num(v: string | number | null | undefined, fallback = 0): number {
  if (v == null) return fallback;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function rowToPlan(r: typeof pricingCataloguePlans.$inferSelect): CataloguePlanRow {
  return {
    planKey: r.planKey,
    displayName: r.displayName,
    priceUsd: num(r.priceUsd),
    generationQuota: r.generationQuota,
    pageLimit: r.pageLimit,
    designProductLimit: r.designProductLimit,
    overageCapUnits: r.overageCapUnits,
    marginOverAiCostPct: num(r.marginOverAiCostPct, 50),
    selfServe: !!r.selfServe,
    sortOrder: r.sortOrder,
  };
}

async function loadSnapshot(catalogueId: number): Promise<PricingCatalogueSnapshot | null> {
  const [cat] = await db
    .select()
    .from(pricingCatalogues)
    .where(eq(pricingCatalogues.id, catalogueId))
    .limit(1);
  if (!cat) return null;
  const plans = await db
    .select()
    .from(pricingCataloguePlans)
    .where(eq(pricingCataloguePlans.catalogueId, catalogueId))
    .orderBy(asc(pricingCataloguePlans.sortOrder));
  const schedule = (cat.overageSchedule ?? []) as OveragePriceTier[];
  return {
    id: cat.id,
    label: cat.label,
    status: cat.status as PricingCatalogueSnapshot["status"],
    overageSchedule: schedule.length ? schedule : buildSeedCatalogueSnapshot().overageSchedule,
    aiCostPerGenUsd: num(cat.aiCostPerGenUsd, 0.045),
    plans: plans.map(rowToPlan),
  };
}

/** Ensure seed catalogue id=0 exists and is active if nothing else is. */
export async function ensureSeedPricingCatalogue(): Promise<void> {
  const seed = buildSeedCatalogueSnapshot();
  const existing = await db
    .select({ id: pricingCatalogues.id })
    .from(pricingCatalogues)
    .where(eq(pricingCatalogues.id, SEED_PRICING_VERSION))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(pricingCatalogues).values({
      id: SEED_PRICING_VERSION,
      label: seed.label,
      status: "active",
      overageSchedule: seed.overageSchedule,
      aiCostPerGenUsd: String(seed.aiCostPerGenUsd),
      committedAt: new Date(),
      activatedAt: new Date(),
      createdBy: "seed",
    });
    // Align serial so next commit gets id >= 1
    await db.execute(sql`SELECT setval(pg_get_serial_sequence('pricing_catalogues', 'id'), GREATEST((SELECT MAX(id) FROM pricing_catalogues), 1))`);
    for (const p of seed.plans) {
      await db.insert(pricingCataloguePlans).values({
        catalogueId: SEED_PRICING_VERSION,
        planKey: p.planKey,
        displayName: p.displayName,
        priceUsd: String(p.priceUsd),
        generationQuota: p.generationQuota,
        pageLimit: p.pageLimit,
        designProductLimit: p.designProductLimit,
        overageCapUnits: p.overageCapUnits,
        marginOverAiCostPct: String(p.marginOverAiCostPct),
        selfServe: p.selfServe,
        sortOrder: p.sortOrder,
      });
    }
    console.log(`${TAG} Seeded pricing catalogue v0 (${seed.plans.length} plans)`);
  }

  const active = await db
    .select({ id: pricingCatalogues.id })
    .from(pricingCatalogues)
    .where(eq(pricingCatalogues.status, "active"))
    .limit(1);
  if (active.length === 0) {
    await db
      .update(pricingCatalogues)
      .set({ status: "active", activatedAt: new Date() })
      .where(eq(pricingCatalogues.id, SEED_PRICING_VERSION));
    console.log(`${TAG} Restored active pointer to seed catalogue v0`);
  }
  invalidateCaches();
}

export async function getCatalogueById(id: number): Promise<PricingCatalogueSnapshot> {
  const cached = byIdCache.get(id);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.snapshot;

  await ensureSeedPricingCatalogue();
  const snap = await loadSnapshot(id);
  if (snap) {
    byIdCache.set(id, { at: Date.now(), snapshot: snap });
    return snap;
  }
  // Missing version → seed fallback (never throw in billing path)
  console.warn(`${TAG} Catalogue ${id} missing — falling back to seed`);
  const seed = buildSeedCatalogueSnapshot();
  byIdCache.set(id, { at: Date.now(), snapshot: seed });
  return seed;
}

export async function getActiveCatalogue(): Promise<PricingCatalogueSnapshot> {
  if (activeCache && Date.now() - activeCache.at < CACHE_MS) {
    return activeCache.snapshot;
  }
  await ensureSeedPricingCatalogue();
  const [row] = await db
    .select({ id: pricingCatalogues.id })
    .from(pricingCatalogues)
    .where(eq(pricingCatalogues.status, "active"))
    .limit(1);
  const id = row?.id ?? SEED_PRICING_VERSION;
  const snap = await getCatalogueById(id);
  activeCache = { at: Date.now(), snapshot: snap };
  return snap;
}

/** Enforcement version for a shop — never null after backfill (treat null as 0). */
export function enforcementPricingVersion(
  pricingVersion: number | null | undefined,
): number {
  if (pricingVersion == null || !Number.isFinite(pricingVersion)) {
    return SEED_PRICING_VERSION;
  }
  return Math.floor(pricingVersion);
}

export async function getCatalogueForInstallation(
  pricingVersion: number | null | undefined,
): Promise<PricingCatalogueSnapshot> {
  return getCatalogueById(enforcementPricingVersion(pricingVersion));
}

export async function listPricingCatalogues(): Promise<
  Array<{
    id: number;
    label: string;
    status: string;
    committedAt: Date;
    activatedAt: Date | null;
    planCount: number;
  }>
> {
  await ensureSeedPricingCatalogue();
  const cats = await db
    .select()
    .from(pricingCatalogues)
    .orderBy(desc(pricingCatalogues.id));
  const out = [];
  for (const c of cats) {
    const plans = await db
      .select({ id: pricingCataloguePlans.id })
      .from(pricingCataloguePlans)
      .where(eq(pricingCataloguePlans.catalogueId, c.id));
    out.push({
      id: c.id,
      label: c.label,
      status: c.status,
      committedAt: c.committedAt,
      activatedAt: c.activatedAt,
      planCount: plans.length,
    });
  }
  return out;
}

export type CommitDraftInput = {
  label: string;
  overageSchedule: OveragePriceTier[];
  aiCostPerGenUsd?: number;
  plans: CataloguePlanRow[];
  createdBy?: string | null;
};

/** Commit a draft as a new committed catalogue. Does NOT activate. */
export async function commitPricingCatalogue(
  input: CommitDraftInput,
): Promise<PricingCatalogueSnapshot> {
  await ensureSeedPricingCatalogue();
  const label = String(input.label || "").trim();
  if (!label) throw new Error("label is required");
  if (!Array.isArray(input.plans) || input.plans.length === 0) {
    throw new Error("plans are required");
  }
  const schedule =
    Array.isArray(input.overageSchedule) && input.overageSchedule.length > 0
      ? input.overageSchedule
      : buildSeedCatalogueSnapshot().overageSchedule;
  const aiCost = input.aiCostPerGenUsd ?? 0.045;

  const [cat] = await db
    .insert(pricingCatalogues)
    .values({
      label,
      status: "committed",
      overageSchedule: schedule,
      aiCostPerGenUsd: String(aiCost),
      committedAt: new Date(),
      createdBy: input.createdBy ?? null,
    })
    .returning();

  if (!cat) throw new Error("Failed to insert catalogue");

  for (const p of input.plans) {
    await db.insert(pricingCataloguePlans).values({
      catalogueId: cat.id,
      planKey: p.planKey,
      displayName: p.displayName,
      priceUsd: String(p.priceUsd),
      generationQuota: Math.max(0, Math.floor(p.generationQuota)),
      pageLimit: Math.max(0, Math.floor(p.pageLimit)),
      designProductLimit: Math.max(0, Math.floor(p.designProductLimit)),
      overageCapUnits: Math.max(0, Math.floor(p.overageCapUnits)),
      marginOverAiCostPct: String(p.marginOverAiCostPct),
      selfServe: !!p.selfServe,
      sortOrder: p.sortOrder,
    });
  }

  invalidateCaches();
  const snap = await getCatalogueById(cat.id);
  console.log(`${TAG} Committed catalogue ${cat.id} (${label}) — not activated`);
  return snap;
}

/**
 * Activate a committed (or superseded) catalogue. Previous active → superseded.
 * Does not touch Shopify or installation.pricingVersion stamps.
 */
export async function activatePricingCatalogue(catalogueId: number): Promise<PricingCatalogueSnapshot> {
  await ensureSeedPricingCatalogue();
  await db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(pricingCatalogues)
      .where(eq(pricingCatalogues.id, catalogueId))
      .limit(1);
    if (!target) throw new Error(`Catalogue ${catalogueId} not found`);
    if (target.status === "active") return;

    await tx
      .update(pricingCatalogues)
      .set({ status: "superseded" })
      .where(eq(pricingCatalogues.status, "active"));

    await tx
      .update(pricingCatalogues)
      .set({ status: "active", activatedAt: new Date() })
      .where(eq(pricingCatalogues.id, catalogueId));

    console.log(`${TAG} Activated catalogue ${catalogueId} (${target.label})`);
  });
  invalidateCaches();
  return getCatalogueById(catalogueId);
}

export async function getActivePlanPriceUsd(planKey: string): Promise<number> {
  const cat = await getActiveCatalogue();
  return findCataloguePlan(cat, planKey)?.priceUsd ?? 0;
}

export async function getActiveOverageCappedAmountUsd(planKey: string): Promise<number> {
  const cat = await getActiveCatalogue();
  return getPlanOverageCappedAmountForCatalogue(planKey, cat);
}

export async function getActiveOverageUsageTerms(): Promise<string> {
  return overageUsageTermsForCatalogue(await getActiveCatalogue());
}

export async function getActivePaidPlanDefinitions() {
  return planDefinitionsFromCatalogue(await getActiveCatalogue(), { selfServeOnly: true });
}

export function resolveOveragePriceForCatalogue(
  catalogue: PricingCatalogueSnapshot,
  volume?: number,
): number {
  return resolveOveragePriceUsd(volume, catalogue.overageSchedule);
}

export {
  findCataloguePlan,
  planDefinitionsFromCatalogue,
  getPlanOverageCappedAmountForCatalogue,
  overageUsageTermsForCatalogue,
};
