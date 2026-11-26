/**
 * Watched apply of server/migrations/reward-grants-repeatable-rungs.sql
 * Staging only — operator runs this explicitly. Not imported by startup.ts.
 */
import { pool } from "../server/db";

function hostHint(): { host: string; port: string } {
  try {
    const u = new URL(process.env.DATABASE_URL || "");
    return { host: u.hostname, port: u.port || "5432" };
  } catch {
    return { host: "(unparsed)", port: "" };
  }
}

async function run(label: string, sql: string) {
  console.log(`\n>>> ${label}`);
  console.log(sql.trim());
  const started = Date.now();
  const result = await pool.query(sql);
  console.log(`ok command=${result.command} rowCount=${result.rowCount} ${Date.now() - started}ms`);
}

async function listIndexes() {
  const r = await pool.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'reward_grants'
    ORDER BY indexname
  `);
  console.log("\n=== reward_grants indexes now ===");
  for (const row of r.rows) console.log(row);
}

async function main() {
  const hint = hostHint();
  console.log("target", hint);
  if (!hint.host.includes("altaria.proxy.rlwy.net")) {
    throw new Error(`Refusing to run: host ${hint.host} is not the confirmed staging proxy`);
  }

  await listIndexes();

  await run(
    "1/4 DROP old table UNIQUE",
    `ALTER TABLE reward_grants DROP CONSTRAINT IF EXISTS reward_grants_shop_customer_id_rung_key_key`,
  );
  await run(
    "2/4 DROP leftover drizzle index name (no-op if absent)",
    `DROP INDEX IF EXISTS reward_grants_shop_customer_rung`,
  );
  await run(
    "3/4 CREATE once-per-customer partial unique",
    `CREATE UNIQUE INDEX reward_grants_once_per_customer_rung
       ON reward_grants (shop, customer_id, rung_key)
       WHERE rung_key NOT IN ('share_design', 'purchase_threshold')`,
  );
  await run(
    "4/4 CREATE per-event partial unique",
    `CREATE UNIQUE INDEX reward_grants_per_event
       ON reward_grants (shop, customer_id, rung_key, related_entity_id)
       WHERE rung_key IN ('share_design', 'purchase_threshold')`,
  );

  await listIndexes();

  const constraints = await pool.query(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'reward_grants'::regclass
    ORDER BY conname
  `);
  console.log("\n=== reward_grants constraints now ===");
  for (const row of constraints.rows) console.log(row);

  const verify = await pool.query(`
    SELECT indexname
    FROM pg_indexes
    WHERE tablename = 'reward_grants'
      AND indexname IN (
        'reward_grants_once_per_customer_rung',
        'reward_grants_per_event',
        'reward_grants_shop_customer_id_rung_key_key',
        'reward_grants_shop_customer_rung'
      )
    ORDER BY indexname
  `);
  const names = verify.rows.map((r) => r.indexname);
  const oldGone =
    !names.includes("reward_grants_shop_customer_id_rung_key_key") &&
    !names.includes("reward_grants_shop_customer_rung");
  const newPresent =
    names.includes("reward_grants_once_per_customer_rung") &&
    names.includes("reward_grants_per_event");
  if (!oldGone || !newPresent) {
    throw new Error(`Verify failed: indexes=${JSON.stringify(names)}`);
  }
  console.log("\nVERIFY ok: old unique gone; both partial uniques present.");
}

main()
  .catch((err) => {
    console.error("APPLY FAILED:", err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
