/**
 * Colour edits run after the request returns, one design at a time.
 * A restart puts a running job back on the queue. Apply is safe to repeat:
 * variants that already exist are reused.
 */
import { pool } from "./db";
import { applyDesignColourEdit, ColourEditRefusal, type ColourEditPlan } from "./design-colour-edit";

const ACTIVE = ["queued", "mockups", "shopify", "printify", "shipping"];

type JobRow = {
  design_product_id: string;
  status: string;
  phase: string;
  error: string;
  colours: string[];
  plan: ColourEditPlan | null;
};

export type ColourJobEntry = {
  designProductId: string;
  phase: string;
  label: string;
  error: string;
  plan: ColourEditPlan | null;
};

let tableReady: Promise<void> | null = null;
let started = false;
let pumping = false;
let inFlight = 0;

function label(phase: string, error: string): string {
  if (phase === "failed") return error || "Colour edit failed";
  if (phase === "done") return "Colours saved";
  if (phase === "queued") return "Queued";
  if (phase === "mockups") return "Making mockups";
  if (phase === "shopify") return "Updating Shopify";
  if (phase === "printify") return "Updating Printify";
  if (phase === "shipping") return "Updating delivery profile";
  return phase || "";
}

async function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = pool.query(`
      CREATE TABLE IF NOT EXISTS design_colour_jobs (
        design_product_id text PRIMARY KEY,
        status text NOT NULL,
        phase text NOT NULL,
        error text NOT NULL DEFAULT '',
        colours jsonb NOT NULL,
        plan jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `).then(() => undefined).catch((err) => {
      tableReady = null;
      throw err;
    });
  }
  await tableReady;
}

function entry(row: JobRow): ColourJobEntry {
  return {
    designProductId: row.design_product_id,
    phase: row.phase,
    label: label(row.phase, row.error),
    error: row.error || "",
    plan: row.plan,
  };
}

export function colourJobIsActive(phase: string): boolean {
  return ACTIVE.includes(phase);
}

export async function readColourJob(designProductId: string): Promise<ColourJobEntry | null> {
  await ensureTable();
  const result = await pool.query<JobRow>(
    `SELECT design_product_id, status, phase, error, colours, plan FROM design_colour_jobs WHERE design_product_id = $1`,
    [designProductId],
  );
  return result.rows[0] ? entry(result.rows[0]) : null;
}

export async function enqueueColourEdit(designProductId: string, colours: string[], plan: ColourEditPlan): Promise<ColourJobEntry> {
  await ensureTable();
  const existing = await pool.query<JobRow>(
    `SELECT design_product_id, status, phase, error, colours, plan FROM design_colour_jobs WHERE design_product_id = $1`,
    [designProductId],
  );
  const current = existing.rows[0];
  if (current && (current.status === "queued" || current.status === "running")) return entry(current);
  await pool.query(
    `INSERT INTO design_colour_jobs (design_product_id, status, phase, error, colours, plan, updated_at)
     VALUES ($1, 'queued', 'queued', '', $2::jsonb, $3::jsonb, now())
     ON CONFLICT (design_product_id) DO UPDATE
     SET status = 'queued', phase = 'queued', error = '', colours = $2::jsonb, plan = $3::jsonb, updated_at = now()`,
    [designProductId, JSON.stringify(colours), JSON.stringify(plan)],
  );
  void pump();
  return { designProductId, phase: "queued", label: "Queued", error: "", plan };
}

async function claimNext(): Promise<JobRow | null> {
  const result = await pool.query<JobRow>(`
    WITH next AS (
      SELECT design_product_id FROM design_colour_jobs
      WHERE status = 'queued'
      ORDER BY updated_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE design_colour_jobs AS job
    SET status = 'running', updated_at = now()
    FROM next
    WHERE job.design_product_id = next.design_product_id
    RETURNING job.design_product_id, job.status, job.phase, job.error, job.colours, job.plan
  `);
  return result.rows[0] || null;
}

async function setPhase(id: string, phase: string): Promise<void> {
  await pool.query(
    `UPDATE design_colour_jobs SET phase = $2, updated_at = now() WHERE design_product_id = $1 AND status = 'running'`,
    [id, phase],
  );
}

async function finish(id: string, status: "done" | "failed", error = ""): Promise<void> {
  await pool.query(
    `UPDATE design_colour_jobs SET status = $2, phase = $2, error = $3, updated_at = now() WHERE design_product_id = $1`,
    [id, status, error.slice(0, 500)],
  );
}

async function runJob(row: JobRow): Promise<void> {
  const colours = Array.isArray(row.colours) ? row.colours.map(String) : [];
  try {
    await applyDesignColourEdit(row.design_product_id, colours, (phase) => {
      void setPhase(row.design_product_id, phase).catch(() => undefined);
    });
    await finish(row.design_product_id, "done");
  } catch (err) {
    const reasons = err instanceof ColourEditRefusal && err.reasons.length
      ? err.reasons
      : [err instanceof Error ? err.message : String(err)];
    console.error("[design-colour-jobs] failed", row.design_product_id, reasons.join(" | "));
    await finish(row.design_product_id, "failed", reasons.join("\n")).catch(() => undefined);
  }
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (inFlight < 1) {
      const row = await claimNext();
      if (!row) break;
      inFlight += 1;
      void runJob(row).finally(() => {
        inFlight -= 1;
        void pump();
      });
    }
  } catch (err) {
    console.error("[design-colour-jobs] queue read failed:", (err as Error).message);
  } finally {
    pumping = false;
  }
}

export async function startDesignColourJobs(): Promise<void> {
  if (started) return;
  await ensureTable();
  const recovered = await pool.query(
    `UPDATE design_colour_jobs SET status = 'queued', phase = 'queued', updated_at = now() WHERE status = 'running'`,
  );
  started = true;
  if (recovered.rowCount) console.log(`[design-colour-jobs] requeued ${recovered.rowCount} job(s) after restart`);
  void pump();
}
