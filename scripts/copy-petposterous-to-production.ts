/**
 * Copy Petposterous catalogue rows from staging Postgres to production Postgres.
 *
 * Dry-run is the default. It prints counts and writes nothing.
 *   SOURCE_DATABASE_URL=... DEST_DATABASE_URL=... npx tsx scripts/copy-petposterous-to-production.ts
 *
 * A real copy also needs --write and CONFIRM_PETPOSTEROUS_COPY=copy-petposterous.
 * Do not run that until the switchover checklist says go.
 *
 * Product types are inserted without ids. Linked rows are pointed at the new ids.
 * The demo shop is not read for copying. ROUND ONE is skipped. Tokens are never printed.
 */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import {
  COPY_CONFIRM,
  DELIVERY_PROFILE_ID,
  DEMO_SHOP,
  EXPECTED_PROFILE_VARIANTS,
  PETPOSTEROUS_SHOP,
  PRINTIFY_SHOP_ID,
  assertCopyTargets,
  isRoundOneDesign,
  jsonParameter,
  remapIdKeys,
} from "./petposterous-copy-lib";

const { Client } = pg;

type Sql = { query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }> };
type Row = Record<string, unknown>;

const SERIAL_TABLES = new Set([
  "product_types",
  "shopify_installations",
  "variant_shipping",
  "shipping_coverage",
  "catalog_variant_costs",
  "shipping_classes",
  "shipping_rates",
  "shipping_store_profiles",
  "shipping_store_zones",
  "shipping_store_rates",
  "shipping_store_variants",
]);

function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unexpected column ${name}`);
  return `"${name}"`;
}

async function columnSet(db: Sql, table: string): Promise<Set<string>> {
  const result = await db.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return new Set(result.rows.map((row) => String(row.column_name)));
}

async function writableColumns(source: Sql, dest: Sql, table: string): Promise<string[]> {
  const [from, to] = await Promise.all([columnSet(source, table), columnSet(dest, table)]);
  if (!to.size) throw new Error(`Destination has no table ${table}. Run the production boot first.`);
  const missing = [...from].filter((column) => !to.has(column) && column !== "id");
  if (missing.length) {
    throw new Error(`Destination ${table} is missing columns: ${missing.join(", ")}`);
  }
  return [...from].filter((column) => to.has(column) && !(SERIAL_TABLES.has(table) && column === "id"));
}

const jsonColumnCache = new Map<string, Set<string>>();

async function jsonColumns(db: Sql, table: string): Promise<Set<string>> {
  const cached = jsonColumnCache.get(table);
  if (cached) return cached;
  const result = await db.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND udt_name IN ('json', 'jsonb')`,
    [table],
  );
  const names = new Set(result.rows.map((row) => String(row.column_name)));
  jsonColumnCache.set(table, names);
  return names;
}

async function insertRow(db: Sql, table: string, row: Row, columns: string[]): Promise<Row> {
  const json = await jsonColumns(db, table);
  const names = columns.filter((column) => Object.prototype.hasOwnProperty.call(row, column));
  const values = names.map((column) => json.has(column) ? jsonParameter(row[column]) : row[column]);
  const sql = `INSERT INTO ${ident(table)} (${names.map(ident).join(", ")})
    VALUES (${names.map((_, index) => `$${index + 1}`).join(", ")}) RETURNING *`;
  const result = await db.query(sql, values);
  return result.rows[0];
}

function shopClause(column: string): string {
  return `lower(${ident(column)}) = $1`;
}

async function main(): Promise<void> {
  const writing = process.argv.includes("--write");
  const sourceUrl = process.env.SOURCE_DATABASE_URL || "";
  const destUrl = process.env.DEST_DATABASE_URL || "";
  const hosts = assertCopyTargets(sourceUrl, destUrl || undefined, writing);
  if (writing && process.env.CONFIRM_PETPOSTEROUS_COPY !== COPY_CONFIRM) {
    throw new Error(`Refusing to write. Set CONFIRM_PETPOSTEROUS_COPY=${COPY_CONFIRM} and pass --write.`);
  }

  const source = new Client({ connectionString: sourceUrl, ssl: sslFor(hosts.sourceHost), statement_timeout: 60000 });
  await source.connect();
  await source.query("SET default_transaction_read_only = on");
  const dest = destUrl
    ? new Client({ connectionString: destUrl, ssl: sslFor(hosts.destHost || ""), statement_timeout: 60000 })
    : null;
  if (dest) {
    await dest.connect();
    if (!writing) await dest.query("SET default_transaction_read_only = on");
  }

  try {
    const plan = await readPlan(source);
    printPlan(plan, hosts);
    if (dest) await printDestChecks(dest, plan);
    if (!writing) {
      console.log("Dry-run only. No rows were written.");
      return;
    }
    if (!dest) throw new Error("DEST_DATABASE_URL is required to write.");
    await dest.query("BEGIN");
    try {
      const idMap = await writePlan(source, dest, plan);
      await dest.query("COMMIT");
      const file = path.resolve("tmp/petposterous-id-map.json");
      await mkdir(path.dirname(file), { recursive: true });
      const body = Object.fromEntries([...idMap.entries()].map(([oldId, newId]) => [String(oldId), newId]));
      await writeFile(file, `${JSON.stringify(body, null, 2)}\n`);
      console.log(`Wrote id map ${file}`);
      for (const [oldId, newId] of idMap) console.log(`product type ${oldId} -> ${newId}`);
    } catch (err) {
      await dest.query("ROLLBACK");
      throw err;
    }
  } finally {
    await source.end();
    await dest?.end();
  }
}

function sslFor(host: string): { rejectUnauthorized: false } | undefined {
  return host.endsWith("rlwy.net") ? { rejectUnauthorized: false } : undefined;
}

async function readPlan(source: Sql) {
  const types = await source.query(
    `SELECT * FROM product_types WHERE ${shopClause("shopify_shop_domain")} ORDER BY id`,
    [PETPOSTEROUS_SHOP],
  );
  const demo = await source.query(
    `SELECT count(*)::int AS n FROM product_types WHERE ${shopClause("shopify_shop_domain")}`,
    [DEMO_SHOP],
  );
  const products = await source.query(
    `SELECT * FROM design_products WHERE ${shopClause("shop")} ORDER BY created_at`,
    [PETPOSTEROUS_SHOP],
  );
  const roundOne = products.rows.filter((row) => isRoundOneDesign(row));
  const keptProducts = products.rows.filter((row) => !isRoundOneDesign(row));
  const candidates = await source.query(
    `SELECT * FROM design_candidates WHERE ${shopClause("shop_domain")} ORDER BY created_at`,
    [PETPOSTEROUS_SHOP],
  );
  const candidateIds = candidates.rows.map((row) => String(row.id));
  const choices = candidateIds.length
    ? await source.query(`SELECT * FROM catalogue_candidate_choices WHERE candidate_id = ANY($1::text[])`, [candidateIds])
    : { rows: [] as Row[], rowCount: 0 };
  const batches = await source.query(
    `SELECT * FROM catalogue_import_batches WHERE ${shopClause("shop_domain")}`,
    [PETPOSTEROUS_SHOP],
  );
  const importRows = await source.query(
    `SELECT * FROM catalogue_import_rows WHERE ${shopClause("shop_domain")}`,
    [PETPOSTEROUS_SHOP],
  );
  const typeIds = types.rows.map((row) => Number(row.id));
  const panels = await byTypes(source, "mockup_panels", typeIds);
  const colours = await byTypes(source, "mockup_library_colours", typeIds);
  const pages = await source.query(
    `SELECT * FROM customizer_pages WHERE ${shopClause("shop")}`,
    [PETPOSTEROUS_SHOP],
  );
  const variantShipping = await byTypes(source, "variant_shipping", typeIds);
  const coverage = await byTypes(source, "shipping_coverage", typeIds);
  const costs = await byTypes(source, "catalog_variant_costs", typeIds);
  const installs = await source.query(
    `SELECT * FROM shopify_installations WHERE ${shopClause("shop_domain")}`,
    [PETPOSTEROUS_SHOP],
  );
  const merchantId = String(installs.rows[0]?.merchant_id || "");
  const merchants = await source.query(
    `SELECT * FROM merchants WHERE id = $1 OR printify_shop_id = $2`,
    [merchantId, PRINTIFY_SHOP_ID],
  );
  const settings = await source.query(
    `SELECT * FROM my_pet_settings WHERE ${shopClause("shop_domain")}`,
    [PETPOSTEROUS_SHOP],
  );
  const profiles = await source.query(
    `SELECT * FROM shipping_store_profiles
     WHERE ${shopClause("shop_domain")} AND shopify_profile_id LIKE $2`,
    [PETPOSTEROUS_SHOP, `%${DELIVERY_PROFILE_ID}%`],
  );
  const profileId = Number(profiles.rows[0]?.id || 0);
  const zones = profileId
    ? await source.query(`SELECT * FROM shipping_store_zones WHERE store_profile_id = $1`, [profileId])
    : { rows: [] as Row[], rowCount: 0 };
  const zoneIds = zones.rows.map((row) => Number(row.id));
  const rates = zoneIds.length
    ? await source.query(`SELECT * FROM shipping_store_rates WHERE store_zone_id = ANY($1::int[])`, [zoneIds])
    : { rows: [] as Row[], rowCount: 0 };
  const membership = profileId
    ? await source.query(`SELECT * FROM shipping_store_variants WHERE store_profile_id = $1`, [profileId])
    : { rows: [] as Row[], rowCount: 0 };
  const classIds = uniqueNumbers([
    ...variantShipping.rows.map((row) => Number(row.shipping_class_id)),
    ...coverage.rows.map((row) => Number(row.shipping_class_id)),
    ...profiles.rows.map((row) => Number(row.shipping_class_id)),
  ]);
  const classes = classIds.length
    ? await source.query(`SELECT * FROM shipping_classes WHERE id = ANY($1::int[])`, [classIds])
    : { rows: [] as Row[], rowCount: 0 };
  const classRates = classIds.length
    ? await source.query(`SELECT * FROM shipping_rates WHERE shipping_class_id = ANY($1::int[])`, [classIds])
    : { rows: [] as Row[], rowCount: 0 };
  return {
    types: types.rows,
    demoTypes: Number(demo.rows[0]?.n || 0),
    roundOne: roundOne.length,
    products: keptProducts,
    candidates: candidates.rows,
    choices: choices.rows,
    batches: batches.rows,
    importRows: importRows.rows,
    panels: panels.rows,
    colours: colours.rows,
    pages: pages.rows,
    variantShipping: variantShipping.rows,
    coverage: coverage.rows,
    costs: costs.rows,
    install: installs.rows[0] || null,
    merchant: merchants.rows.find((row) => String(row.printify_shop_id || "") === PRINTIFY_SHOP_ID) || merchants.rows[0] || null,
    settings: settings.rows[0] || null,
    profile: profiles.rows[0] || null,
    profileCount: profiles.rows.length,
    zones: zones.rows,
    rates: rates.rows,
    membership: membership.rows,
    classes: classes.rows,
    classRates: classRates.rows,
  };
}

async function byTypes(db: Sql, table: string, typeIds: number[]) {
  if (!typeIds.length) return { rows: [] as Row[], rowCount: 0 };
  return db.query(`SELECT * FROM ${ident(table)} WHERE product_type_id = ANY($1::int[])`, [typeIds]);
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))];
}

function printPlan(plan: Awaited<ReturnType<typeof readPlan>>, hosts: { sourceHost: string; destHost: string | null }): void {
  const lines: Array<[string, number | string]> = [
    ["source host", hosts.sourceHost],
    ["dest host", hosts.destHost || "(not connected)"],
    ["product_types", plan.types.length],
    ["demo product_types left alone", plan.demoTypes],
    ["design_products", plan.products.length],
    ["ROUND ONE skipped", plan.roundOne],
    ["design_candidates", plan.candidates.length],
    ["catalogue_candidate_choices", plan.choices.length],
    ["catalogue_import_batches", plan.batches.length],
    ["catalogue_import_rows", plan.importRows.length],
    ["mockup_panels", plan.panels.length],
    ["mockup_library_colours", plan.colours.length],
    ["customizer_pages", plan.pages.length],
    ["variant_shipping", plan.variantShipping.length],
    ["shipping_coverage", plan.coverage.length],
    ["catalog_variant_costs", plan.costs.length],
    ["install row", plan.install ? 1 : 0],
    ["merchant printify shop", plan.merchant ? 1 : 0],
    ["my_pet_settings", plan.settings ? 1 : 0],
    ["shipping profiles", plan.profileCount],
    ["shipping zones", plan.zones.length],
    ["shipping profile rates", plan.rates.length],
    ["shipping membership", plan.membership.length],
    ["shipping classes referenced", plan.classes.length],
  ];
  for (const [label, value] of lines) console.log(`${label}: ${value}`);
  for (const row of plan.types) {
    console.log(`type ${row.id} blueprint ${row.printify_blueprint_id} provider ${row.printify_provider_id} ${row.name}`);
  }
  if (plan.profileCount !== 1) console.log(`Expected 1 delivery profile ${DELIVERY_PROFILE_ID}.`);
  if (plan.membership.length !== EXPECTED_PROFILE_VARIANTS) {
    console.log(`Expected ${EXPECTED_PROFILE_VARIANTS} membership rows. Found ${plan.membership.length}.`);
  }
}

async function printDestChecks(dest: Sql, plan: Awaited<ReturnType<typeof readPlan>>): Promise<void> {
  const install = await dest.query(
    `SELECT 1 AS present FROM shopify_installations WHERE ${shopClause("shop_domain")} LIMIT 1`,
    [PETPOSTEROUS_SHOP],
  );
  const merchant = await dest.query(
    `SELECT 1 AS present FROM merchants WHERE printify_shop_id = $1 LIMIT 1`,
    [PRINTIFY_SHOP_ID],
  );
  const candidateIds = plan.candidates.map((row) => String(row.id));
  const candidateHits = candidateIds.length
    ? await dest.query(`SELECT count(*)::int AS n FROM design_candidates WHERE id = ANY($1::text[])`, [candidateIds])
    : { rows: [{ n: 0 }] };
  const existingTypes = await dest.query(
    `SELECT printify_blueprint_id, printify_provider_id FROM product_types WHERE ${shopClause("shopify_shop_domain")}`,
    [PETPOSTEROUS_SHOP],
  );
  console.log(`dest installation present: ${install.rows.length ? "yes" : "no"}`);
  console.log(`dest merchant for printify shop present: ${merchant.rows.length ? "yes" : "no"}`);
  console.log(`dest candidate id collisions: ${candidateHits.rows[0]?.n || 0}`);
  console.log(`dest petposterous product types already there: ${existingTypes.rows.length}`);
  const variantIds = plan.membership.map((row) => String(row.shopify_variant_id || "")).filter(Boolean);
  const memberHits = variantIds.length
    ? await dest.query(
      `SELECT count(*)::int AS n FROM shipping_store_variants
       WHERE lower(shop_domain) = $1 AND shopify_variant_id = ANY($2::text[])`,
      [PETPOSTEROUS_SHOP, variantIds],
    )
    : { rows: [{ n: 0 }] };
  console.log(`dest membership collisions: ${memberHits.rows[0]?.n || 0}`);
}

async function writePlan(source: Sql, dest: Sql, plan: Awaited<ReturnType<typeof readPlan>>): Promise<Map<number, number>> {
  if (!plan.install || !plan.merchant) throw new Error("Staging is missing the Petposterous install or Printify merchant.");
  if (plan.types.length < 1) throw new Error("No Petposterous product types to copy.");
  if (plan.profileCount !== 1) throw new Error(`Expected 1 delivery profile, found ${plan.profileCount}.`);
  if (plan.membership.length !== EXPECTED_PROFILE_VARIANTS) {
    throw new Error(`Expected ${EXPECTED_PROFILE_VARIANTS} membership rows, found ${plan.membership.length}.`);
  }
  const existingInstall = await dest.query(
    `SELECT 1 AS present FROM shopify_installations WHERE ${shopClause("shop_domain")} LIMIT 1`,
    [PETPOSTEROUS_SHOP],
  );
  if (existingInstall.rows.length) throw new Error("Destination already has this shop's installation. Refusing to replace it.");

  const merchantId = await reuseOrInsertMerchant(source, dest, plan.merchant);
  const installColumns = await writableColumns(source, dest, "shopify_installations");
  await insertRow(dest, "shopify_installations", { ...plan.install, merchant_id: merchantId }, installColumns);

  const typeColumns = await writableColumns(source, dest, "product_types");
  const idMap = new Map<number, number>();
  for (const row of plan.types) {
    const created = await insertRow(dest, "product_types", {
      ...row,
      merchant_id: row.merchant_id ? merchantId : row.merchant_id,
      blank_source_product_type_id: null,
    }, typeColumns);
    idMap.set(Number(row.id), Number(created.id));
  }
  for (const row of plan.types) {
    const oldSource = Number(row.blank_source_product_type_id);
    const mapped = idMap.get(oldSource);
    if (!mapped) continue;
    await dest.query(
      `UPDATE product_types SET blank_source_product_type_id = $2 WHERE id = $1`,
      [idMap.get(Number(row.id)), mapped],
    );
  }

  const classMap = await ensureClasses(source, dest, plan.classes, plan.classRates);
  await insertMapped(source, dest, "mockup_panels", plan.panels, idMap, classMap);
  await insertMapped(source, dest, "mockup_library_colours", plan.colours, idMap, classMap);
  await insertMapped(source, dest, "customizer_pages", plan.pages, idMap, classMap);
  await insertMapped(source, dest, "catalog_variant_costs", plan.costs, idMap, classMap);
  await insertMapped(source, dest, "shipping_coverage", plan.coverage, idMap, classMap);
  await insertMapped(source, dest, "variant_shipping", plan.variantShipping, idMap, classMap);

  const candidateColumns = await writableColumns(source, dest, "design_candidates");
  for (const row of plan.candidates) {
    await insertRow(dest, "design_candidates", {
      ...row,
      publish_color_ticks: remapIdKeys(row.publish_color_ticks, idMap),
    }, candidateColumns);
  }
  await insertMapped(source, dest, "catalogue_candidate_choices", plan.choices, idMap, classMap);
  await insertMapped(source, dest, "catalogue_import_batches", plan.batches, idMap, classMap);
  await insertMapped(source, dest, "catalogue_import_rows", plan.importRows, idMap, classMap);

  const productColumns = await writableColumns(source, dest, "design_products");
  for (const row of plan.products) {
    const typeId = idMap.get(Number(row.product_type_id));
    if (!typeId) throw new Error(`Design product ${row.id} has no copied product type.`);
    await insertRow(dest, "design_products", {
      ...row,
      merchant_id: merchantId,
      product_type_id: typeId,
    }, productColumns);
  }

  if (plan.settings) {
    const present = await dest.query(
      `SELECT 1 AS present FROM my_pet_settings WHERE ${shopClause("shop_domain")} LIMIT 1`,
      [PETPOSTEROUS_SHOP],
    );
    if (!present.rows.length) {
      const columns = await writableColumns(source, dest, "my_pet_settings");
      await insertRow(dest, "my_pet_settings", plan.settings, columns);
    }
  }

  await insertProfile(source, dest, plan, classMap);
  return idMap;
}

async function reuseOrInsertMerchant(source: Sql, dest: Sql, merchant: Row): Promise<string> {
  const existing = await dest.query(
    `SELECT id, user_id, printify_shop_id FROM merchants WHERE printify_shop_id = $1 OR user_id = $2`,
    [PRINTIFY_SHOP_ID, merchant.user_id],
  );
  const sameShop = existing.rows.find((row) => String(row.printify_shop_id || "") === PRINTIFY_SHOP_ID);
  if (sameShop) return String(sameShop.id);
  if (existing.rows.length) throw new Error("Destination user already has a different Printify shop. Refusing.");
  const columns = await writableColumns(source, dest, "merchants");
  const created = await insertRow(dest, "merchants", { ...merchant, id: randomUUID() }, columns);
  return String(created.id);
}

async function ensureClasses(source: Sql, dest: Sql, classes: Row[], rates: Row[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  const classColumns = await writableColumns(source, dest, "shipping_classes");
  const rateColumns = await writableColumns(source, dest, "shipping_rates");
  for (const row of classes) {
    const found = await dest.query(
      `SELECT id FROM shipping_classes WHERE blueprint_id = $1 AND provider_id = $2 LIMIT 1`,
      [row.blueprint_id, row.provider_id],
    );
    if (found.rows[0]) {
      map.set(Number(row.id), Number(found.rows[0].id));
      continue;
    }
    const created = await insertRow(dest, "shipping_classes", row, classColumns);
    const newId = Number(created.id);
    map.set(Number(row.id), newId);
    for (const rate of rates.filter((item) => Number(item.shipping_class_id) === Number(row.id))) {
      await insertRow(dest, "shipping_rates", { ...rate, shipping_class_id: newId }, rateColumns);
    }
  }
  return map;
}

async function insertMapped(source: Sql, dest: Sql, table: string, rows: Row[], idMap: Map<number, number>, classMap: Map<number, number>): Promise<void> {
  if (!rows.length) return;
  const columns = await writableColumns(source, dest, table);
  for (const row of rows) {
    const next = { ...row };
    if ("product_type_id" in next) {
      const mapped = idMap.get(Number(next.product_type_id));
      if (!mapped) throw new Error(`${table} row points at a product type that was not copied.`);
      next.product_type_id = mapped;
    }
    if ("shipping_class_id" in next) {
      const mapped = classMap.get(Number(next.shipping_class_id));
      if (!mapped) throw new Error(`${table} row points at a shipping class that was not copied.`);
      next.shipping_class_id = mapped;
    }
    await insertRow(dest, table, next, columns);
  }
}

async function insertProfile(source: Sql, dest: Sql, plan: Awaited<ReturnType<typeof readPlan>>, classMap: Map<number, number>): Promise<void> {
  if (!plan.profile) throw new Error("Delivery profile was not found.");
  const classId = classMap.get(Number(plan.profile.shipping_class_id));
  if (!classId) throw new Error("Delivery profile shipping class was not resolved.");
  const profileColumns = await writableColumns(source, dest, "shipping_store_profiles");
  const created = await insertRow(dest, "shipping_store_profiles", {
    ...plan.profile,
    shipping_class_id: classId,
  }, profileColumns);
  const profileId = Number(created.id);
  const zoneColumns = await writableColumns(source, dest, "shipping_store_zones");
  const zoneMap = new Map<number, number>();
  for (const zone of plan.zones) {
    const inserted = await insertRow(dest, "shipping_store_zones", { ...zone, store_profile_id: profileId }, zoneColumns);
    zoneMap.set(Number(zone.id), Number(inserted.id));
  }
  const rateColumns = await writableColumns(source, dest, "shipping_store_rates");
  for (const rate of plan.rates) {
    const zoneId = zoneMap.get(Number(rate.store_zone_id));
    if (!zoneId) throw new Error("A profile rate lost its zone.");
    await insertRow(dest, "shipping_store_rates", { ...rate, store_zone_id: zoneId }, rateColumns);
  }
  const memberColumns = await writableColumns(source, dest, "shipping_store_variants");
  for (const member of plan.membership) {
    await insertRow(dest, "shipping_store_variants", { ...member, store_profile_id: profileId }, memberColumns);
  }
}

const entry = process.argv[1] || "";
if (entry.includes("copy-petposterous-to-production")) {
  main().then(() => process.exit(0)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : "Copy failed");
    process.exit(1);
  });
}
