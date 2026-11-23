/**
 * Copy the two Petposterous shirt types onto petstage in the staging database.
 *
 * Reads production through its public host. Writes only to staging, and only
 * with --write. Does not publish shells, talk to Printify, or touch Shopify.
 *
 *   npx tsx scripts/copy-petstage-shirts.ts
 *   npx tsx scripts/copy-petstage-shirts.ts --write
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";
import "dotenv/config";

const { Client } = pg;

const LIVE_SHOP = "h7epay-gh.myshopify.com";
const DEST_SHOP = "petstage.myshopify.com";
const PRINTIFY_SHOP_ID = "29135517";
const BLUEPRINTS = [145, 706];
const PROVIDER_ID = 99;
const PROJECT = "c4de1669-dfe3-440d-8fad-b64dc4f67485";

type Sql = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};
type Row = Record<string, unknown>;

const CLEAR_COLUMNS = new Set([
  "merchant_id",
  "shopify_product_id",
  "shopify_product_handle",
  "shopify_product_url",
  "shopify_variant_ids",
  "shopify_variant_ids_both",
  "last_pushed_to_shopify",
  "blank_source_product_type_id",
]);

function hostOf(connectionString: string): string {
  return new URL(connectionString).hostname.toLowerCase();
}

function productionDatabaseUrl(): string {
  let raw = "";
  try {
    raw = execSync(
      `npx @railway/cli variable list --project ${PROJECT} --environment production --service Postgres --kv`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000, windowsHide: true },
    );
  } catch {
    throw new Error("Could not read the production public database setting.");
  }
  const line = raw.split(/\r?\n/).find((item) => item.startsWith("DATABASE_PUBLIC_URL="));
  if (!line) throw new Error("Production public database setting was not found.");
  const url = line.slice("DATABASE_PUBLIC_URL=".length).trim().replace(/^"|"$/g, "");
  const host = hostOf(url);
  if (!host.includes("switchyard") || host.includes("altaria")) {
    throw new Error("Production database host check failed.");
  }
  return url;
}

function stagingDatabaseUrl(): string {
  const url = process.env.DATABASE_URL || "";
  if (!url) throw new Error("DATABASE_URL is missing.");
  const host = hostOf(url);
  if (!host.includes("altaria") || host.includes("switchyard")) {
    throw new Error("Staging database host check failed.");
  }
  return url;
}

function isXs(value: unknown): boolean {
  return /^(xs|x-small|xsmall|extra small|extra-small)$/i.test(String(value || "").trim());
}

function parseJson(raw: unknown, fallback: unknown): unknown {
  if (typeof raw !== "string") return raw ?? fallback;
  try { return JSON.parse(raw || ""); } catch { return fallback; }
}

function xsFromSizes(raw: unknown): { ids: Set<string>; names: Set<string> } {
  const ids = new Set<string>();
  const names = new Set<string>();
  const sizes = parseJson(raw, []);
  if (!Array.isArray(sizes)) return { ids, names };
  for (const item of sizes) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (isXs(row.name) || isXs(row.id) || isXs(row.label)) {
      ids.add(String(row.id || ""));
      names.add(String(row.name || row.label || "XS").trim().toLowerCase());
    }
  }
  return { ids, names };
}

function stripSizeList(raw: unknown, xs: { ids: Set<string>; names: Set<string> }): string {
  const sizes = parseJson(raw, []);
  if (!Array.isArray(sizes)) return typeof raw === "string" ? raw : "[]";
  const next = sizes.filter((item) => {
    if (!item || typeof item !== "object") return true;
    const row = item as Record<string, unknown>;
    return !xs.ids.has(String(row.id || "")) && !isXs(row.name) && !isXs(row.label);
  });
  return JSON.stringify(next);
}

function stripIdList(raw: unknown, xs: { ids: Set<string> }): string {
  const list = parseJson(raw, []);
  if (!Array.isArray(list)) return typeof raw === "string" ? raw : "[]";
  return JSON.stringify(list.filter((item) => !xs.ids.has(String(item)) && !isXs(item)));
}

function stripMeasurements(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw ?? null;
  const row = raw as { rows?: Array<{ size?: string }> };
  if (!Array.isArray(row.rows)) return raw;
  return { ...row, rows: row.rows.filter((item) => !isXs(item.size)) };
}

function mentionsLive(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return value.includes("h7epay") || value.includes("gid://shopify/") || /(^|[^0-9])29135517([^0-9]|$)/.test(value);
}

function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unexpected column ${name}`);
  return `"${name}"`;
}

async function columns(db: Sql, table: string): Promise<string[]> {
  const result = await db.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table],
  );
  return result.rows.map((row) => String(row.column_name));
}

async function jsonColumns(db: Sql, table: string): Promise<Set<string>> {
  const result = await db.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND udt_name IN ('json', 'jsonb')`,
    [table],
  );
  return new Set(result.rows.map((row) => String(row.column_name)));
}

async function insertRows(db: Sql, table: string, rows: Row[], skip: Set<string>): Promise<Row[]> {
  if (!rows.length) return [];
  const present = await columns(db, table);
  const json = await jsonColumns(db, table);
  const used = present.filter((column) => !skip.has(column) && column in rows[0]);
  const inserted: Row[] = [];
  for (const row of rows) {
    const values: unknown[] = [];
    const placeholders = used.map((column) => {
      const raw = row[column];
      values.push(json.has(column) ? (raw == null ? null : JSON.stringify(raw)) : raw ?? null);
      return `$${values.length}`;
    });
    const result = await db.query(
      `INSERT INTO ${ident(table)} (${used.map(ident).join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING id`,
      values,
    );
    inserted.push(result.rows[0]);
  }
  return inserted;
}

async function verifyDest(): Promise<void> {
  const dest = new Client({ connectionString: stagingDatabaseUrl(), ssl: { rejectUnauthorized: false }, statement_timeout: 60000 });
  await dest.connect();
  await dest.query("SET default_transaction_read_only = on");
  try {
    const types = await dest.query(
      `SELECT id, name, printify_blueprint_id, shopify_shop_domain, shopify_product_id, merchant_id, blank_source_product_type_id, sizes
       FROM product_types
       WHERE lower(shopify_shop_domain) = $1 AND printify_blueprint_id = ANY($2::int[])
       ORDER BY printify_blueprint_id`,
      [DEST_SHOP, BLUEPRINTS],
    );
    for (const row of types.rows) {
      const sizes = parseJson(row.sizes, []);
      const names = Array.isArray(sizes)
        ? sizes.map((item) => (item && typeof item === "object" ? String((item as Row).name || "") : "")).join(", ")
        : "";
      const panels = await dest.query(`SELECT count(*)::int AS n FROM mockup_panels WHERE product_type_id = $1`, [row.id]);
      const colours = await dest.query(`SELECT count(*)::int AS n FROM mockup_library_colours WHERE product_type_id = $1`, [row.id]);
      console.log([
        `type ${row.id}`,
        row.name,
        `blueprint ${row.printify_blueprint_id}`,
        `shop ${row.shopify_shop_domain}`,
        `shopify product ${row.shopify_product_id ?? "none"}`,
        `merchant ${row.merchant_id ?? "none"}`,
        `blank source ${row.blank_source_product_type_id ?? "own"}`,
        `panels ${panels.rows[0]?.n}`,
        `colours ${colours.rows[0]?.n}`,
      ].join(" | "));
      console.log(`  sizes: ${names}`);
    }
  } finally {
    await dest.end();
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--verify")) {
    await verifyDest();
    return;
  }
  const writing = process.argv.includes("--write");
  const sourceUrl = productionDatabaseUrl();
  const destUrl = stagingDatabaseUrl();
  if (hostOf(sourceUrl) === hostOf(destUrl)) throw new Error("Source and destination are the same host.");

  const source = new Client({ connectionString: sourceUrl, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 });
  const dest = new Client({ connectionString: destUrl, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 });
  await source.connect();
  await source.query("SET default_transaction_read_only = on");
  await dest.connect();
  if (!writing) await dest.query("SET default_transaction_read_only = on");

  try {
    const types = await source.query(
      `SELECT * FROM product_types
       WHERE lower(shopify_shop_domain) = $1
         AND printify_blueprint_id = ANY($2::int[])
         AND printify_provider_id = $3
       ORDER BY printify_blueprint_id, id`,
      [LIVE_SHOP, BLUEPRINTS, PROVIDER_ID],
    );
    if (types.rows.length !== 2) {
      throw new Error(`Expected 2 shirt types, found ${types.rows.length}.`);
    }
    const typeIds = types.rows.map((row) => Number(row.id));
    const panels = await source.query(
      `SELECT * FROM mockup_panels WHERE product_type_id = ANY($1::int[]) ORDER BY product_type_id, panel_id`,
      [typeIds],
    );
    const colours = await source.query(
      `SELECT * FROM mockup_library_colours WHERE product_type_id = ANY($1::int[]) ORDER BY product_type_id, sort_order, name`,
      [typeIds],
    );
    const costs = await source.query(
      `SELECT * FROM catalog_variant_costs WHERE product_type_id = ANY($1::int[]) ORDER BY product_type_id, id`,
      [typeIds],
    );
    const designs = await source.query(
      `SELECT product_type_id, title, status, my_pet_enabled
       FROM design_products
       WHERE lower(shop) = $1 AND product_type_id = ANY($2::int[])
       ORDER BY product_type_id, title`,
      [LIVE_SHOP, typeIds],
    );

    console.log("source host check ok");
    console.log("dest host check ok");
    for (const row of types.rows) {
      const xs = xsFromSizes(row.sizes);
      const ownPanels = panels.rows.filter((panel) => Number(panel.product_type_id) === Number(row.id));
      const scenes = new Set(ownPanels.map((panel) => String(panel.panel_id)));
      const ownColours = colours.rows.filter((colour) => Number(colour.product_type_id) === Number(row.id));
      console.log([
        `type ${row.id}`,
        row.name,
        `blueprint ${row.printify_blueprint_id}`,
        `provider ${row.printify_provider_id}`,
        `blank_source ${row.blank_source_product_type_id ?? "own"}`,
        `sizes ${xs.names.size ? "includes XS" : "no XS"}`,
        `panels ${ownPanels.length}`,
        `scenes ${scenes.size}`,
        `colours ${ownColours.length}`,
      ].join(" | "));
      console.log(`  colour names: ${ownColours.map((colour) => colour.name).join(", ")}`);
    }
    const byType = new Map<number, Row[]>();
    for (const design of designs.rows) {
      const id = Number(design.product_type_id);
      byType.set(id, [...(byType.get(id) || []), design]);
    }
    console.log(`live listings read for a proposal only: ${designs.rows.length}`);
    for (const [typeId, rows] of byType) {
      const active = rows.filter((row) => row.status === "active");
      console.log(`listings on type ${typeId}: ${rows.length}, active ${active.length}`);
      for (const row of active) {
        console.log(`  ${row.my_pet_enabled ? "my-pet" : "no-my-pet"} | ${row.title}`);
      }
    }

    const existing = await dest.query(
      `SELECT id, name, printify_blueprint_id FROM product_types
       WHERE lower(shopify_shop_domain) = $1 AND printify_blueprint_id = ANY($2::int[])`,
      [DEST_SHOP, BLUEPRINTS],
    );
    console.log(`petstage shirt types already present: ${existing.rows.length}`);
    if (!writing) {
      console.log("Dry-run only. No rows were written.");
      return;
    }
    if (existing.rows.length) throw new Error("Pet Stage already has one of these shirt types. Refusing to insert another.");

    const outside = types.rows
      .map((row) => Number(row.blank_source_product_type_id))
      .filter((id) => Number.isInteger(id) && id > 0 && !typeIds.includes(id));
    if (outside.length) throw new Error("A shirt type borrows blanks from a type that is not being copied.");

    await dest.query("BEGIN");
    try {
      const idMap = new Map<number, number>();
      for (const row of types.rows) {
        const xs = xsFromSizes(row.sizes);
        const next: Row = { ...row, shopify_shop_domain: DEST_SHOP };
        for (const column of CLEAR_COLUMNS) next[column] = null;
        next.sizes = stripSizeList(row.sizes, xs);
        next.selected_size_ids = stripIdList(row.selected_size_ids, xs);
        next.garment_measurements = stripMeasurements(row.garment_measurements);
        for (const [key, value] of Object.entries(next)) {
          if (mentionsLive(value)) next[key] = null;
        }
        const [created] = await insertRows(dest, "product_types", [next], new Set(["id"]));
        idMap.set(Number(row.id), Number(created.id));
      }
      for (const row of types.rows) {
        const oldSource = Number(row.blank_source_product_type_id);
        const mapped = idMap.get(oldSource);
        if (!mapped) continue;
        await dest.query(
          `UPDATE product_types SET blank_source_product_type_id = $2 WHERE id = $1`,
          [idMap.get(Number(row.id)), mapped],
        );
      }

      const panelRows = panels.rows
        .filter((row) => !isXs(row.garment_color))
        .map((row) => ({
          ...row,
          id: randomUUID(),
          product_type_id: idMap.get(Number(row.product_type_id)),
        }));
      await insertRows(dest, "mockup_panels", panelRows, new Set());

      const colourRows = colours.rows.map((row) => ({
        ...row,
        id: randomUUID(),
        product_type_id: idMap.get(Number(row.product_type_id)),
      }));
      await insertRows(dest, "mockup_library_colours", colourRows, new Set());

      const costRows = costs.rows
        .filter((row) => !isXs(row.size))
        .map((row) => ({ ...row, product_type_id: idMap.get(Number(row.product_type_id)), supplier_product_id: null }));
      await insertRows(dest, "catalog_variant_costs", costRows, new Set(["id"]));

      await dest.query("COMMIT");
      for (const [oldId, newId] of idMap) console.log(`copied type ${oldId} -> ${newId}`);
      console.log(`copied panels ${panelRows.length}, colours ${colourRows.length}, cost rows ${costRows.length}`);
    } catch (err) {
      await dest.query("ROLLBACK");
      throw err;
    }
  } finally {
    await source.end();
    await dest.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : "Copy failed.");
  process.exit(1);
});
