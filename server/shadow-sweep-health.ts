/**
 * Per-shop census of unpurchased custom-design shadows, and whether the
 * hourly sweep is still succeeding. h7epay-gh stays read-only until confirmed.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { founderAlerts, publishedProducts } from "@shared/schema";
import { db, pool } from "./db";
import { storage } from "./storage";

export const SHADOW_SWEEP_STALE_MS = 24 * 60 * 60 * 1000;

/** Deletes stay off for this shop until the operator confirms. */
export const SHADOW_SWEEP_READ_ONLY_SHOPS = ["h7epay-gh.myshopify.com"];

export function isShadowSweepReadOnlyShop(shop: string): boolean {
  const handle = String(shop || "").trim().toLowerCase().replace(/\.myshopify\.com$/, "");
  return SHADOW_SWEEP_READ_ONLY_SHOPS.some(
    (row) => row.replace(/\.myshopify\.com$/, "") === handle,
  );
}

export type ShadowAgeCounts = {
  under6h: number;
  h6to24: number;
  d1to7: number;
  over7d: number;
  total: number;
};

export function emptyAgeCounts(): ShadowAgeCounts {
  return { under6h: 0, h6to24: 0, d1to7: 0, over7d: 0, total: 0 };
}

/** Age of an unpurchased shadow from when it was created. */
export function shadowAgeBucket(createdAt: Date, now: Date): keyof Omit<ShadowAgeCounts, "total"> {
  const age = now.getTime() - createdAt.getTime();
  if (age < 6 * 60 * 60 * 1000) return "under6h";
  if (age < 24 * 60 * 60 * 1000) return "h6to24";
  if (age < 7 * 24 * 60 * 60 * 1000) return "d1to7";
  return "over7d";
}

export type SweepHealthDecision = {
  stale: boolean;
  growing: boolean;
  alert: boolean;
};

/**
 * Stale when the last successful sweep is missing or older than 24 hours.
 * Growing only after two checks in a row where the unpurchased count rose.
 */
export function decideSweepHealth(args: {
  now: Date;
  lastSuccessAt: Date | null;
  previousTotal: number | null;
  previousGrew: boolean;
  total: number;
}): SweepHealthDecision {
  const stale = !args.lastSuccessAt
    || args.now.getTime() - args.lastSuccessAt.getTime() > SHADOW_SWEEP_STALE_MS;
  const rose = args.previousTotal != null && args.total > args.previousTotal;
  const growing = rose && args.previousGrew;
  return { stale, growing, alert: stale || growing };
}

let tablesReady: Promise<void> | null = null;

async function ensureHealthTables(): Promise<void> {
  if (!tablesReady) {
    tablesReady = pool.query(`
      CREATE TABLE IF NOT EXISTS shadow_sweep_status (
        id integer PRIMARY KEY DEFAULT 1,
        last_success_at timestamptz,
        CONSTRAINT shadow_sweep_status_singleton CHECK (id = 1)
      )
    `).then(() => pool.query(`
      CREATE TABLE IF NOT EXISTS shadow_sweep_shop_census (
        shop text PRIMARY KEY,
        unpurchased_total integer NOT NULL,
        previous_grew boolean NOT NULL DEFAULT false,
        checked_at timestamptz NOT NULL
      )
    `)).then(() => undefined).catch((err) => {
      tablesReady = null;
      throw err;
    });
  }
  await tablesReady;
}

export async function recordShadowSweepSuccess(at = new Date()): Promise<void> {
  await ensureHealthTables();
  await pool.query(
    `INSERT INTO shadow_sweep_status (id, last_success_at)
     VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET last_success_at = EXCLUDED.last_success_at`,
    [at],
  );
}

type CensusRow = ShadowAgeCounts & { shop: string };

async function unpurchasedByShop(): Promise<CensusRow[]> {
  const rows = await db
    .select({
      shop: publishedProducts.shop,
      under6h: sql<number>`count(*) filter (where ${publishedProducts.createdAt} > now() - interval '6 hours')::int`,
      h6to24: sql<number>`count(*) filter (where ${publishedProducts.createdAt} <= now() - interval '6 hours' and ${publishedProducts.createdAt} > now() - interval '24 hours')::int`,
      d1to7: sql<number>`count(*) filter (where ${publishedProducts.createdAt} <= now() - interval '24 hours' and ${publishedProducts.createdAt} > now() - interval '7 days')::int`,
      over7d: sql<number>`count(*) filter (where ${publishedProducts.createdAt} <= now() - interval '7 days')::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(publishedProducts)
    .where(and(
      eq(publishedProducts.status, "active"),
      sql`${publishedProducts.orderProtectedAt} is null`,
    ))
    .groupBy(publishedProducts.shop);
  return rows.map((row) => ({
    shop: row.shop,
    under6h: Number(row.under6h) || 0,
    h6to24: Number(row.h6to24) || 0,
    d1to7: Number(row.d1to7) || 0,
    over7d: Number(row.over7d) || 0,
    total: Number(row.total) || 0,
  }));
}

async function lastSuccessAt(): Promise<Date | null> {
  const result = await pool.query<{ last_success_at: Date | null }>(
    `SELECT last_success_at FROM shadow_sweep_status WHERE id = 1`,
  );
  const value = result.rows[0]?.last_success_at;
  return value ? new Date(value) : null;
}

async function previousCensus(): Promise<Map<string, { total: number; grew: boolean }>> {
  const result = await pool.query<{ shop: string; unpurchased_total: number; previous_grew: boolean }>(
    `SELECT shop, unpurchased_total, previous_grew FROM shadow_sweep_shop_census`,
  );
  const out = new Map<string, { total: number; grew: boolean }>();
  for (const row of result.rows) {
    out.set(row.shop, { total: row.unpurchased_total, grew: row.previous_grew });
  }
  return out;
}

async function saveCensus(shop: string, total: number, grew: boolean, at: Date): Promise<void> {
  await pool.query(
    `INSERT INTO shadow_sweep_shop_census (shop, unpurchased_total, previous_grew, checked_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (shop) DO UPDATE
       SET unpurchased_total = EXCLUDED.unpurchased_total,
           previous_grew = EXCLUDED.previous_grew,
           checked_at = EXCLUDED.checked_at`,
    [shop, total, grew, at],
  );
}

async function alertOnce(shop: string, alertType: string, detail: string): Promise<void> {
  console.error(`[ShadowSweepHealth] ALERT shop=${shop} ${detail}`);
  const since = new Date(Date.now() - SHADOW_SWEEP_STALE_MS);
  const recent = await db
    .select({ id: founderAlerts.id })
    .from(founderAlerts)
    .where(and(
      eq(founderAlerts.shopDomain, shop),
      eq(founderAlerts.alertType, alertType),
      gte(founderAlerts.createdAt, since),
    ))
    .limit(1);
  if (recent.length) return;
  await storage.insertFounderAlert({
    installationId: null,
    shopDomain: shop,
    alertType,
    emailSent: false,
  });
}

export async function runShadowSweepHealthCheck(now = new Date()): Promise<void> {
  await ensureHealthTables();
  const [census, last, previous] = await Promise.all([
    unpurchasedByShop(),
    lastSuccessAt(),
    previousCensus(),
  ]);
  const byShop = new Map(census.map((row) => [row.shop, row]));
  const shops = new Set<string>([...byShop.keys(), ...previous.keys()]);
  const lastLabel = last ? last.toISOString() : "never";
  if (shops.size === 0) {
    console.log(`[ShadowSweepHealth] shops=0 lastSweep=${lastLabel}`);
    const quiet = decideSweepHealth({
      now,
      lastSuccessAt: last,
      previousTotal: null,
      previousGrew: false,
      total: 0,
    });
    if (quiet.stale) {
      await alertOnce("shadow-sweep", "shadow_sweep_stale", `sweep has not succeeded in 24 hours (last=${lastLabel})`);
    }
    return;
  }
  let staleAlerted = false;
  for (const shop of shops) {
    const counts = byShop.get(shop) || emptyAgeCounts();
    const prior = previous.get(shop);
    const decision = decideSweepHealth({
      now,
      lastSuccessAt: last,
      previousTotal: prior ? prior.total : null,
      previousGrew: prior?.grew ?? false,
      total: counts.total,
    });
    const rose = prior != null && counts.total > prior.total;
    console.log(
      `[ShadowSweepHealth] shop=${shop} unpurchased=${counts.total} under6h=${counts.under6h} h6to24=${counts.h6to24} d1to7=${counts.d1to7} over7d=${counts.over7d} lastSweep=${lastLabel}`,
    );
    if (decision.stale && !staleAlerted) {
      staleAlerted = true;
      await alertOnce(shop, "shadow_sweep_stale", `sweep has not succeeded in 24 hours (last=${lastLabel})`);
    }
    if (decision.growing) {
      await alertOnce(
        shop,
        "shadow_sweep_growing",
        `unpurchased shadows grew ${prior?.total ?? 0} -> ${counts.total} on two checks in a row`,
      );
    }
    await saveCensus(shop, counts.total, rose, now);
  }
}
