/**
 * Read-only: would the two partial unique indexes CREATE against current rows?
 * Does not print DATABASE_URL. Does not apply DDL.
 */
import { pool } from "../server/db";

function hostHint(): { host: string; port: string; db: string } {
  const raw = process.env.DATABASE_URL || "";
  try {
    const u = new URL(raw);
    return { host: u.hostname, port: u.port || "5432", db: u.pathname.replace(/^\//, "") };
  } catch {
    return { host: "(unparsed)", port: "", db: "" };
  }
}

function maskId(id: string): string {
  const s = String(id || "");
  return s.length <= 8 ? s : `${s.slice(0, 8)}-…`;
}

async function main() {
  const hint = hostHint();
  console.log("db_hint", {
    host: hint.host,
    port: hint.port,
    db: hint.db,
    railwayPublicProxy: hint.host.includes("rlwy.net"),
  });

  const indexes = await pool.query(`
    SELECT
      c.conname,
      c.contype,
      pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'reward_grants'
    ORDER BY c.conname
  `);
  const idx = await pool.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'reward_grants'
    ORDER BY indexname
  `);
  console.log("\n=== existing constraints ===");
  for (const r of indexes.rows) console.log(r);
  console.log("\n=== existing indexes ===");
  for (const r of idx.rows) console.log(r);

  const counts = await pool.query(`
    SELECT
      rung_key,
      COUNT(*)::int AS rows,
      COUNT(*) FILTER (WHERE related_entity_id IS NULL)::int AS null_related
    FROM reward_grants
    GROUP BY rung_key
    ORDER BY rung_key
  `);
  console.log("\n=== rows by rung ===");
  console.table(counts.rows);

  const onceCollisions = await pool.query(`
    SELECT shop, customer_id, rung_key, COUNT(*)::int AS n, array_agg(id ORDER BY id) AS ids
    FROM reward_grants
    WHERE rung_key NOT IN ('share_design', 'purchase_threshold')
    GROUP BY shop, customer_id, rung_key
    HAVING COUNT(*) > 1
    ORDER BY n DESC, shop, customer_id
  `);

  const eventCollisions = await pool.query(`
    SELECT shop, customer_id, rung_key, related_entity_id, COUNT(*)::int AS n, array_agg(id ORDER BY id) AS ids
    FROM reward_grants
    WHERE rung_key IN ('share_design', 'purchase_threshold')
    GROUP BY shop, customer_id, rung_key, related_entity_id
    HAVING COUNT(*) > 1
    ORDER BY n DESC, shop, customer_id
  `);

  const nullRelated = await pool.query(`
    SELECT id, shop, customer_id, rung_key, created_at
    FROM reward_grants
    WHERE rung_key IN ('share_design', 'purchase_threshold')
      AND related_entity_id IS NULL
    ORDER BY id
  `);

  const summarize = (rows: any[]) =>
    rows.map((r) => ({
      shop: r.shop,
      customer_id: maskId(r.customer_id),
      rung_key: r.rung_key,
      related_entity_id: r.related_entity_id ?? null,
      n: r.n,
      ids: r.ids,
    }));

  console.log("\n=== collisions for reward_grants_once_per_customer_rung ===");
  console.log("count", onceCollisions.rowCount);
  if (onceCollisions.rows.length) console.table(summarize(onceCollisions.rows));

  console.log("\n=== collisions for reward_grants_per_event ===");
  console.log("count", eventCollisions.rowCount);
  if (eventCollisions.rows.length) console.table(summarize(eventCollisions.rows));

  console.log("\n=== share/purchase rows with NULL related_entity_id ===");
  console.log("count", nullRelated.rowCount);
  if (nullRelated.rows.length) {
    console.table(
      nullRelated.rows.map((r) => ({
        id: r.id,
        shop: r.shop,
        customer_id: maskId(r.customer_id),
        rung_key: r.rung_key,
        created_at: r.created_at,
      })),
    );
  }

  const clean = onceCollisions.rowCount === 0 && eventCollisions.rowCount === 0;
  console.log("\nCREATE UNIQUE INDEX would succeed:", clean);
}

main()
  .catch((err) => {
    console.error("check failed:", err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
