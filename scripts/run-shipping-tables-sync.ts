/**
 * Manual shipping-table sync (bypasses the 20h boot guard, does not force
 * rewrites when the Printify hash is unchanged). Prints checked/changed/failed.
 */
import { pool } from "../server/db";
import { runShippingTablesSync } from "../server/shipping-tables";

const host = new URL(process.env.DATABASE_URL || "postgres://localhost").hostname;
console.log(`[shipping-sync] database host ${host}`);

const summary = await runShippingTablesSync({ source: "manual", force: false });
const failed = (summary.results || []).filter((r) => r.status === "failed");
console.log(
  JSON.stringify(
    {
      ok: summary.ok,
      skipped: summary.skipped ?? false,
      reason: summary.reason ?? null,
      checked: summary.checked,
      changed: summary.changed,
      failed: summary.failed,
      sampleErrors: failed.slice(0, 5).map((r) => ({
        blueprintId: r.blueprintId,
        providerId: r.providerId,
        error: r.error,
      })),
    },
    null,
    2,
  ),
);

await pool.end();
process.exit(summary.failed > 40 ? 2 : 0);
