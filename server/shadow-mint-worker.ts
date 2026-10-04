/**
 * Background shadow mint queue. Runs only for atcMode=base-first.
 * shadow-direct keeps the inline runPreShadowMint path.
 *
 * Spike C-2 (2026-10-04) failed: the theme cannot call Storefront cartLinesUpdate.
 * This worker does not swap carts. Phase 2 swap is add-shadow + zero the base line.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { PrintConfigFingerprintInput } from "@shared/printConfigFingerprint";
import { normalizeAtcMode, type AtcMode } from "@shared/atcMode";
import {
  SHADOW_MINT_MAX_ATTEMPTS,
  SHADOW_MINT_MAX_IN_FLIGHT_GLOBAL,
  SHADOW_MINT_MAX_IN_FLIGHT_PER_SHOP,
  percentile,
  shadowMintLikePrefix,
  shadowMintRetryDelayMs,
  shadowMintSupersedePrefix,
} from "@shared/shadowMintQueue";
import { publishedProducts, shadowMintJobs } from "@shared/schema";
import { db } from "./db";
import { storage } from "./storage";
import { awaitInFlightOrGenerate, preShadowFlightKey, runPreShadowMint } from "./pre-shadow-mint";
import { assertAjaxVariantVisible } from "./shadow-storefront-visible";
import { waitForInFlightProductImport } from "./shipping-reconciler";

export type ShadowMintEnqueueArgs = {
  shop: string;
  token: string;
  jobId: string;
  baseProductId: string;
  baseVariantId: string;
  primaryMockupUrl: string;
  designId: string;
  cfgSnapshot: PrintConfigFingerprintInput;
  priceOverride: string | null;
};

type JobRow = {
  id: number;
  shop: string;
  key: string;
  job_id: string;
  base_variant_id: string;
  base_product_id: string;
  cfg_snapshot: PrintConfigFingerprintInput;
  mockup_url: string;
  price_override: string | null;
  attempts: number;
  created_at: Date | string;
  claimed_at: Date | string | null;
};

function rowsOf<T>(result: unknown): T[] {
  const rows = (result as { rows?: T[] })?.rows;
  return Array.isArray(rows) ? rows : [];
}

function ms(value: Date | string | null | undefined): number {
  if (!value) return Date.now();
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : Date.now();
}

let ticking = false;

export async function enqueueShadowMint(args: ShadowMintEnqueueArgs): Promise<void> {
  const shop = String(args.shop || "").trim();
  const key = String(args.designId || "").trim();
  if (!shop || !key) throw new Error("shadow mint enqueue requires shop and key");

  const prefix = shadowMintSupersedePrefix(key);
  if (prefix) {
    await db.execute(sql`
      UPDATE shadow_mint_jobs
      SET state = 'failed', last_error = 'superseded', updated_at = now()
      WHERE shop = ${shop}
        AND state = 'pending'
        AND key <> ${key}
        AND key LIKE ${shadowMintLikePrefix(prefix)} ESCAPE '\\'
    `);
  }

  await db.execute(sql`
    INSERT INTO shadow_mint_jobs (
      shop, key, job_id, base_variant_id, base_product_id, cfg_snapshot, mockup_url, price_override
    ) VALUES (
      ${shop},
      ${key},
      ${args.jobId},
      ${String(args.baseVariantId)},
      ${String(args.baseProductId)},
      CAST(${JSON.stringify(args.cfgSnapshot ?? {})} AS jsonb),
      ${args.primaryMockupUrl},
      ${args.priceOverride}
    )
    ON CONFLICT (shop, key) DO UPDATE SET
      mockup_url = EXCLUDED.mockup_url,
      cfg_snapshot = EXCLUDED.cfg_snapshot,
      price_override = EXCLUDED.price_override,
      base_product_id = EXCLUDED.base_product_id,
      state = CASE WHEN shadow_mint_jobs.state = 'failed' THEN 'pending' ELSE shadow_mint_jobs.state END,
      attempts = CASE WHEN shadow_mint_jobs.state = 'failed' THEN 0 ELSE shadow_mint_jobs.attempts END,
      last_error = CASE WHEN shadow_mint_jobs.state = 'failed' THEN NULL ELSE shadow_mint_jobs.last_error END,
      lease_until = CASE WHEN shadow_mint_jobs.state = 'failed' THEN NULL ELSE shadow_mint_jobs.lease_until END,
      updated_at = now()
    WHERE shadow_mint_jobs.state IN ('pending', 'failed')
  `);
  console.log(`[ShadowMint] enqueued shop=${shop} key=${key.slice(0, 80)}`);
}

/** base-first enqueues. Every other mode keeps today's inline mint. */
export async function startPreShadowForMode(
  mode: AtcMode,
  args: ShadowMintEnqueueArgs,
  logTag = "Background",
): Promise<"queued" | "inline"> {
  if (mode === "base-first") {
    await enqueueShadowMint(args);
    return "queued";
  }
  const flightKey = preShadowFlightKey(args.shop, args.designId);
  void awaitInFlightOrGenerate(flightKey, () =>
    runPreShadowMint(args).catch((e: any) => {
      console.error(`[PreShadow] ${logTag} error for jobId=${args.jobId}:`, e?.message);
    }),
  );
  return "inline";
}

async function reapExpiredLeases(): Promise<void> {
  await db.execute(sql`
    UPDATE shadow_mint_jobs
    SET state = CASE WHEN attempts >= ${SHADOW_MINT_MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END,
        lease_until = CASE
          WHEN attempts >= ${SHADOW_MINT_MAX_ATTEMPTS} THEN NULL
          WHEN attempts <= 1 THEN now() + interval '5 seconds'
          ELSE now() + interval '30 seconds'
        END,
        last_error = COALESCE(last_error, 'lease expired'),
        updated_at = now()
    WHERE state = 'running' AND lease_until IS NOT NULL AND lease_until <= now()
  `);
}

async function claimOne(): Promise<JobRow | null> {
  const result = await db.execute(sql`
    WITH picked AS (
      SELECT id FROM shadow_mint_jobs
      WHERE state = 'pending'
        AND attempts < ${SHADOW_MINT_MAX_ATTEMPTS}
        AND (lease_until IS NULL OR lease_until <= now())
        AND (
          SELECT count(*) FROM shadow_mint_jobs r
          WHERE r.shop = shadow_mint_jobs.shop
            AND r.state = 'running'
            AND r.lease_until > now()
        ) < ${SHADOW_MINT_MAX_IN_FLIGHT_PER_SHOP}
        AND (
          SELECT count(*) FROM shadow_mint_jobs r
          WHERE r.state = 'running' AND r.lease_until > now()
        ) < ${SHADOW_MINT_MAX_IN_FLIGHT_GLOBAL}
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE shadow_mint_jobs AS j
    SET state = 'running',
        attempts = j.attempts + 1,
        claimed_at = now(),
        lease_until = now() + interval '60 seconds',
        updated_at = now()
    FROM picked
    WHERE j.id = picked.id
    RETURNING j.id, j.shop, j.key, j.job_id, j.base_variant_id, j.base_product_id, j.cfg_snapshot,
              j.mockup_url, j.price_override, j.attempts, j.created_at, j.claimed_at
  `);
  return rowsOf<JobRow>(result)[0] ?? null;
}

async function finishFailure(id: number, attempts: number, message: string): Promise<void> {
  const delay = shadowMintRetryDelayMs(attempts);
  const error = message.slice(0, 500);
  if (delay == null) {
    await db.execute(sql`
      UPDATE shadow_mint_jobs
      SET state = 'failed', lease_until = NULL, last_error = ${error}, updated_at = now()
      WHERE id = ${id} AND state = 'running'
    `);
    console.warn(`[ShadowMint] dead id=${id} attempts=${attempts} error=${error}`);
    return;
  }
  await db.execute(sql`
    UPDATE shadow_mint_jobs
    SET state = 'pending',
        lease_until = now() + (CAST(${delay} AS int) * interval '1 millisecond'),
        last_error = ${error},
        updated_at = now()
    WHERE id = ${id} AND state = 'running'
  `);
}

async function processJob(job: JobRow): Promise<void> {
  const started = Date.now();
  const enqueuedAt = ms(job.created_at);
  const claimedAt = ms(job.claimed_at);
  try {
    await waitForInFlightProductImport(job.shop);
    const inst = await storage.getShopifyInstallationByShop(job.shop);
    if (!inst?.accessToken || inst.status !== "active") {
      throw new Error("shop not authorized");
    }
    const minted = await runPreShadowMint({
      shop: job.shop,
      token: inst.accessToken,
      jobId: job.job_id,
      baseProductId: job.base_product_id,
      baseVariantId: job.base_variant_id,
      primaryMockupUrl: job.mockup_url,
      designId: job.key,
      cfgSnapshot: job.cfg_snapshot,
      priceOverride: job.price_override,
      lookup: "exact",
    });
    if (!minted?.shopifyVariantId) throw new Error("mint returned no variant");
    await assertAjaxVariantVisible({ shop: job.shop, variantId: minted.shopifyVariantId });
    await db
      .update(publishedProducts)
      .set({ readyAt: new Date(), updatedAt: new Date() })
      .where(and(eq(publishedProducts.shop, job.shop), eq(publishedProducts.designId, job.key)));
    const marked = await db.execute(sql`
      UPDATE shadow_mint_jobs
      SET state = 'ready', ready_at = now(), lease_until = NULL, last_error = NULL, updated_at = now()
      WHERE id = ${job.id} AND state = 'running'
      RETURNING id
    `);
    if (rowsOf(marked).length === 0) return;
    const done = Date.now();
    console.log(
      `[ShadowMint] key=${job.key.slice(0, 80)} waited=${claimedAt - enqueuedAt}ms minted=${done - started}ms total=${done - enqueuedAt}ms`,
    );
  } catch (e: any) {
    await finishFailure(job.id, job.attempts, String(e?.message || e || "mint failed"));
  }
}

export async function tickShadowMintQueue(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    await reapExpiredLeases();
    for (;;) {
      const job = await claimOne();
      if (!job) break;
      void processJob(job).catch((e) => console.error("[ShadowMint] process error:", e?.message));
    }
  } catch (e: any) {
    console.error("[ShadowMint] tick error:", e?.message || e);
  } finally {
    ticking = false;
  }
}

export async function readShadowReady(shop: string, keysRaw: string) {
  const inst = await storage.getShopifyInstallationByShop(shop);
  const atcMode = normalizeAtcMode((inst as { atcMode?: string } | null)?.atcMode);
  const keys = String(keysRaw || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 20);
  if (keys.length === 0) return { atcMode, results: [] as const };

  const jobs = await db
    .select()
    .from(shadowMintJobs)
    .where(and(eq(shadowMintJobs.shop, shop), inArray(shadowMintJobs.key, keys)));
  const pubs = await db
    .select({
      designId: publishedProducts.designId,
      shopifyVariantId: publishedProducts.shopifyVariantId,
      readyAt: publishedProducts.readyAt,
      status: publishedProducts.status,
    })
    .from(publishedProducts)
    .where(and(eq(publishedProducts.shop, shop), inArray(publishedProducts.designId, keys)));

  const results = keys.map((key) => {
    const job = jobs.find((row) => row.key === key);
    const pub = pubs.find((row) => row.designId === key && row.status === "active" && row.readyAt);
    const ready = job?.state === "ready" && !!pub;
    return {
      key,
      state: job?.state ?? "absent",
      ready,
      shopifyVariantId: ready ? pub!.shopifyVariantId : null,
    };
  });
  return { atcMode, results };
}

export async function shadowMintDiagnostics() {
  const failedRows = await db
    .select({
      shop: shadowMintJobs.shop,
      key: shadowMintJobs.key,
      attempts: shadowMintJobs.attempts,
      lastError: shadowMintJobs.lastError,
      updatedAt: shadowMintJobs.updatedAt,
    })
    .from(shadowMintJobs)
    .where(eq(shadowMintJobs.state, "failed"))
    .orderBy(desc(shadowMintJobs.updatedAt))
    .limit(50);

  const countResult = await db.execute(sql`
    SELECT shop, state, count(*)::int AS n
    FROM shadow_mint_jobs
    GROUP BY shop, state
    ORDER BY shop, state
  `);
  const timingResult = await db.execute(sql`
    SELECT shop,
      EXTRACT(EPOCH FROM (ready_at - created_at)) * 1000 AS total_ms,
      EXTRACT(EPOCH FROM (claimed_at - created_at)) * 1000 AS waited_ms
    FROM shadow_mint_jobs
    WHERE state = 'ready' AND ready_at IS NOT NULL AND claimed_at IS NOT NULL
    ORDER BY ready_at DESC
    LIMIT 200
  `);

  const byShop = new Map<string, { total: number[]; waited: number[] }>();
  for (const row of rowsOf<{ shop: string; total_ms: string | number; waited_ms: string | number }>(timingResult)) {
    const bucket = byShop.get(row.shop) ?? { total: [], waited: [] };
    const total = Number(row.total_ms);
    const waited = Number(row.waited_ms);
    if (Number.isFinite(total)) bucket.total.push(total);
    if (Number.isFinite(waited)) bucket.waited.push(waited);
    byShop.set(row.shop, bucket);
  }
  const timing = [...byShop.entries()].map(([shop, bucket]) => {
    const total = [...bucket.total].sort((a, b) => a - b);
    const waited = [...bucket.waited].sort((a, b) => a - b);
    return {
      shop,
      n: total.length,
      p50Ms: percentile(total, 50),
      p95Ms: percentile(total, 95),
      waitP50Ms: percentile(waited, 50),
    };
  });

  return {
    counts: rowsOf<{ shop: string; state: string; n: number }>(countResult),
    timing,
    failed: failedRows.map((row) => ({
      shop: row.shop,
      key: row.key.slice(0, 120),
      attempts: row.attempts,
      lastError: (row.lastError || "").slice(0, 300),
      updatedAt: row.updatedAt,
    })),
  };
}
