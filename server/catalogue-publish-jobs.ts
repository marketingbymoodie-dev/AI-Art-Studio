/**
 * Catalogue promote runs after the request returns.
 * Two jobs at a time. A running job heartbeats. Another process reclaims it
 * only after that heartbeat is stale, then skips steps already stored.
 */
import { cataloguePublishAllowedShops, CATALOGUE_PUBLISH_LOCKED_MESSAGE } from "@shared/cataloguePublishAccess";
import { catalogueQueueIsDone, catalogueQueueLabel } from "@shared/catalogueQueue";
import { CATALOGUE_PUBLISH_HEARTBEAT_MS, CATALOGUE_PUBLISH_STALE_MS, type CatalogueJobPhase } from "@shared/cataloguePublish";
import type { ApprovalRecipe } from "./catalogue-approval";
import { publishCatalogueTargets, PublishRefusal, type CatalogueBatchResult } from "./catalogue-publish";
import { pool } from "./db";

export const CATALOGUE_PUBLISH_CONCURRENCY = 2;

const ACTIVE: CatalogueJobPhase[] = ["queued", "print", "listing", "mockups", "shopify"];

type JobRow = {
  candidate_id: string;
  status: string;
  phase: string;
  error: string;
  title: string;
  recipe: ApprovalRecipe;
  results: CatalogueBatchResult | null;
  updated_at: Date | string;
};

export type CatalogueQueueEntry = {
  id: string;
  title: string;
  punchline: string;
  phase: string;
  label: string;
  error: string;
  done: boolean;
};

let tableReady: Promise<void> | null = null;
let inFlight = 0;
let pumping = false;
let started = false;
const localRunning = new Set<string>();

function jobsAllowed(): boolean {
  return cataloguePublishAllowedShops().length > 0;
}

async function ensureJobsTable(): Promise<void> {
  if (!tableReady) {
    tableReady = pool.query(`
      CREATE TABLE IF NOT EXISTS catalogue_publish_jobs (
        candidate_id text PRIMARY KEY,
        status text NOT NULL,
        phase text NOT NULL,
        error text NOT NULL DEFAULT '',
        title text NOT NULL DEFAULT '',
        recipe jsonb NOT NULL,
        results jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `).then(() => pool.query(`
      ALTER TABLE catalogue_publish_jobs
      ADD COLUMN IF NOT EXISTS results jsonb NOT NULL DEFAULT '{}'::jsonb
    `)).then(() => pool.query(`
      ALTER TABLE catalogue_publish_jobs
      ADD COLUMN IF NOT EXISTS external_ids jsonb NOT NULL DEFAULT '{}'::jsonb
    `)).then(() => undefined).catch((err) => {
      tableReady = null;
      throw err;
    });
  }
  await tableReady;
}

function entry(row: {
  id: string;
  title: string;
  punchline?: string;
  phase: string;
  error: string;
  listed?: boolean;
}): CatalogueQueueEntry {
  const listed = Boolean(row.listed);
  return {
    id: row.id,
    title: row.title,
    punchline: row.punchline || "",
    phase: row.phase,
    label: catalogueQueueLabel(row.phase, row.error, listed),
    error: row.error || "",
    done: catalogueQueueIsDone({ phase: row.phase, listed }),
  };
}

export async function listCatalogueJobQueue(
  open: Array<{ id: string; title: string; punchline?: string }>,
  listedIds: ReadonlySet<string> = new Set(),
): Promise<CatalogueQueueEntry[]> {
  await ensureJobsTable();
  const result = await pool.query<JobRow>(
    `SELECT candidate_id, status, phase, error, title, updated_at FROM catalogue_publish_jobs`,
  );
  const byId = new Map(result.rows.map((row) => [row.candidate_id, row]));
  const seen = new Set<string>();
  const rows: CatalogueQueueEntry[] = [];
  for (const item of open) {
    seen.add(item.id);
    const job = byId.get(item.id);
    rows.push(entry({
      id: item.id,
      title: item.title || job?.title || item.id,
      punchline: item.punchline,
      phase: job?.phase || "",
      error: job?.error || "",
      listed: listedIds.has(item.id),
    }));
  }
  const cutoff = Date.now() - 12 * 60 * 60 * 1000;
  for (const job of result.rows) {
    if (seen.has(job.candidate_id)) continue;
    if (job.status !== "done" && job.status !== "failed") continue;
    if (new Date(job.updated_at).getTime() < cutoff) continue;
    rows.push(entry({
      id: job.candidate_id,
      title: job.title || job.candidate_id,
      phase: job.phase,
      error: job.error || "",
      listed: listedIds.has(job.candidate_id),
    }));
  }
  return rows;
}

export function catalogueJobIsActive(phase: string): boolean {
  return ACTIVE.includes(phase as CatalogueJobPhase);
}

export async function enqueueCataloguePublish(recipe: ApprovalRecipe): Promise<CatalogueQueueEntry> {
  if (!jobsAllowed()) {
    throw new PublishRefusal([CATALOGUE_PUBLISH_LOCKED_MESSAGE]);
  }
  await ensureJobsTable();
  const existing = await pool.query<JobRow>(
    `SELECT candidate_id, status, phase, error, title FROM catalogue_publish_jobs WHERE candidate_id = $1`,
    [recipe.candidateId],
  );
  const current = existing.rows[0];
  if (current && (current.status === "queued" || current.status === "running")) {
    return entry({
      id: current.candidate_id,
      title: current.title,
      phase: current.phase,
      error: current.error,
    });
  }
  const title = String(recipe.title || recipe.punchline || "").trim();
  await pool.query(
    `INSERT INTO catalogue_publish_jobs (candidate_id, status, phase, error, title, recipe, updated_at)
     VALUES ($1, 'queued', 'queued', '', $2, $3::jsonb, now())
     ON CONFLICT (candidate_id) DO UPDATE
     SET status = 'queued', phase = 'queued', error = '', title = $2, recipe = $3::jsonb, updated_at = now()`,
    [recipe.candidateId, title, JSON.stringify(recipe)],
  );
  void pump();
  return entry({ id: recipe.candidateId, title, phase: "queued", error: "" });
}

async function claimNext(): Promise<JobRow | null> {
  const result = await pool.query<JobRow>(`
    WITH next AS (
      SELECT candidate_id FROM catalogue_publish_jobs
      WHERE status = 'queued'
      ORDER BY updated_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE catalogue_publish_jobs AS job
    SET status = 'running', updated_at = now()
    FROM next
    WHERE job.candidate_id = next.candidate_id
    RETURNING job.candidate_id, job.status, job.phase, job.error, job.title, job.recipe, job.updated_at
  `);
  return result.rows[0] || null;
}

async function setPhase(candidateId: string, phase: string): Promise<void> {
  await pool.query(
    `UPDATE catalogue_publish_jobs
     SET phase = $2, updated_at = now()
     WHERE candidate_id = $1 AND status = 'running'`,
    [candidateId, phase],
  );
}

async function finish(
  candidateId: string,
  status: "done" | "failed",
  error = "",
  results: CatalogueBatchResult | null = null,
): Promise<void> {
  await pool.query(
    `UPDATE catalogue_publish_jobs
     SET status = $2, phase = $2, error = $3, results = $4::jsonb, updated_at = now()
     WHERE candidate_id = $1 AND status = 'running'`,
    [candidateId, status, error.slice(0, 500), JSON.stringify(results || {})],
  );
}

async function heartbeat(candidateId: string): Promise<void> {
  await pool.query(
    `UPDATE catalogue_publish_jobs
     SET updated_at = now()
     WHERE candidate_id = $1 AND status = 'running'`,
    [candidateId],
  );
}

function startHeartbeat(candidateId: string): () => void {
  const timer = setInterval(() => {
    void heartbeat(candidateId).catch((err) => {
      console.warn("[catalogue-publish-jobs] heartbeat was not stored:", (err as Error).message);
    });
  }, CATALOGUE_PUBLISH_HEARTBEAT_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** A dead worker stops heartbeating. This process does not take its own live jobs. */
export async function reclaimStaleCatalogueJobs(): Promise<number> {
  await ensureJobsTable();
  const owned = [...localRunning];
  const excluded = owned.length ? owned : ["00000000-0000-0000-0000-000000000000"];
  const result = await pool.query(
    `UPDATE catalogue_publish_jobs
     SET status = 'queued', phase = 'queued', updated_at = now()
     WHERE status = 'running'
       AND updated_at < now() - ($1::int * interval '1 millisecond')
       AND NOT (candidate_id = ANY($2::text[]))`,
    [CATALOGUE_PUBLISH_STALE_MS, excluded],
  );
  return result.rowCount || 0;
}

async function runJob(row: JobRow): Promise<void> {
  const recipe = row.recipe;
  localRunning.add(recipe.candidateId);
  const stopHeartbeat = startHeartbeat(recipe.candidateId);
  try {
    const outcome = await publishCatalogueTargets({
      recipe,
      onPhase: (event) => {
        if (event.phase === "done") return;
        void setPhase(recipe.candidateId, event.phase).catch((err) => {
          console.warn("[catalogue-publish-jobs] phase was not stored:", (err as Error).message);
        });
      },
    });
    const failed = outcome.types.filter((type) => type.status === "failed");
    await finish(
      recipe.candidateId,
      failed.length ? "failed" : "done",
      failed.map((type) => `${type.name}: ${type.error}`).join("\n"),
      outcome,
    );
  } catch (err) {
    const reasons = err instanceof PublishRefusal && err.reasons.length
      ? err.reasons
      : [err instanceof Error ? err.message : String(err)];
    console.error("[catalogue-publish-jobs] failed", recipe.candidateId, reasons.join(" | "));
    await finish(recipe.candidateId, "failed", reasons.join("\n")).catch((storeErr) => {
      console.error("[catalogue-publish-jobs] failure was not stored:", (storeErr as Error).message);
    });
  } finally {
    stopHeartbeat();
    localRunning.delete(recipe.candidateId);
  }
}

async function pump(): Promise<void> {
  if (pumping || !jobsAllowed()) return;
  pumping = true;
  try {
    while (inFlight < CATALOGUE_PUBLISH_CONCURRENCY) {
      const row = await claimNext();
      if (!row) break;
      inFlight += 1;
      void runJob(row).finally(() => {
        inFlight -= 1;
        void pump();
      });
    }
  } catch (err) {
    console.error("[catalogue-publish-jobs] queue read failed:", (err as Error).message);
  } finally {
    pumping = false;
  }
}

/** Reclaim only jobs whose worker has stopped heartbeating, then keep watching. */
export async function startCataloguePublishJobs(): Promise<void> {
  if (started || !jobsAllowed()) return;
  await ensureJobsTable();
  started = true;
  const sweep = async () => {
    const recovered = await reclaimStaleCatalogueJobs().catch((err) => {
      console.error("[catalogue-publish-jobs] reclaim failed:", (err as Error).message);
      return 0;
    });
    if (recovered) console.log(`[catalogue-publish-jobs] requeued ${recovered} stale job(s)`);
    void pump();
  };
  const timer = setInterval(() => void sweep(), CATALOGUE_PUBLISH_HEARTBEAT_MS);
  timer.unref?.();
  void sweep();
}
