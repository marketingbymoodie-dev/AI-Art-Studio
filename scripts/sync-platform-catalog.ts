/**
 * One-time (or occasional) copy of platform_catalog_blueprints
 * from production Postgres → staging Postgres.
 *
 * Does NOT re-harvest or re-map panels. Supabase assets stay shared;
 * this only copies the allowlist rows (labels, kind, status, template names).
 *
 * Usage (PowerShell):
 *   $env:SOURCE_DATABASE_URL = "<production DATABASE_URL>"
 *   $env:TARGET_DATABASE_URL = "<staging DATABASE_URL>"
 *   npx tsx scripts/sync-platform-catalog.ts
 *
 * Get URLs from Railway → each Postgres service → Variables → DATABASE_URL
 * (or DATABASE_PUBLIC_URL if connecting from your laptop).
 */
import pg from "pg";

const SOURCE = process.env.SOURCE_DATABASE_URL || process.env.PROD_DATABASE_URL;
const TARGET = process.env.TARGET_DATABASE_URL || process.env.STAGING_DATABASE_URL;

if (!SOURCE || !TARGET) {
  console.error(
    "Set SOURCE_DATABASE_URL (production) and TARGET_DATABASE_URL (staging).\n" +
      "Use DATABASE_PUBLIC_URL from Railway if the private DATABASE_URL fails from your PC.",
  );
  process.exit(1);
}

if (SOURCE === TARGET) {
  console.error("Source and target DATABASE_URL are the same — aborting.");
  process.exit(1);
}

type Row = {
  printify_blueprint_id: number;
  label: string;
  brand: string | null;
  category: string | null;
  kind: string;
  status: string;
  panel_mapping_template: string | null;
  storefront_mockup_mode: string | null;
  fulfillment_layout: string | null;
  force_flat_harvest: boolean;
  fabric_weave_texture: boolean | null;
  notes: string | null;
};

async function main() {
  const src = new pg.Pool({ connectionString: SOURCE, ssl: { rejectUnauthorized: false } });
  const dst = new pg.Pool({ connectionString: TARGET, ssl: { rejectUnauthorized: false } });

  try {
    const { rows } = await src.query<Row>(`
      SELECT
        printify_blueprint_id,
        label,
        brand,
        category,
        kind,
        status,
        panel_mapping_template,
        storefront_mockup_mode,
        fulfillment_layout,
        force_flat_harvest,
        fabric_weave_texture,
        notes
      FROM platform_catalog_blueprints
      ORDER BY printify_blueprint_id
    `);

    console.log(`Read ${rows.length} row(s) from source.`);

    let upserted = 0;
    for (const r of rows) {
      await dst.query(
        `
        INSERT INTO platform_catalog_blueprints (
          printify_blueprint_id, label, brand, category, kind, status,
          panel_mapping_template, storefront_mockup_mode, fulfillment_layout,
          force_flat_harvest, fabric_weave_texture, notes, tagged_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9,
          $10, $11, $12, NOW(), NOW()
        )
        ON CONFLICT (printify_blueprint_id) DO UPDATE SET
          label = EXCLUDED.label,
          brand = EXCLUDED.brand,
          category = EXCLUDED.category,
          kind = EXCLUDED.kind,
          status = EXCLUDED.status,
          panel_mapping_template = EXCLUDED.panel_mapping_template,
          storefront_mockup_mode = EXCLUDED.storefront_mockup_mode,
          fulfillment_layout = EXCLUDED.fulfillment_layout,
          force_flat_harvest = EXCLUDED.force_flat_harvest,
          fabric_weave_texture = EXCLUDED.fabric_weave_texture,
          notes = EXCLUDED.notes,
          updated_at = NOW()
        `,
        [
          r.printify_blueprint_id,
          r.label,
          r.brand,
          r.category,
          r.kind,
          r.status,
          r.panel_mapping_template,
          r.storefront_mockup_mode,
          r.fulfillment_layout,
          r.force_flat_harvest,
          r.fabric_weave_texture,
          r.notes,
        ],
      );
      upserted += 1;
    }

    console.log(`Upserted ${upserted} row(s) into target.`);
    console.log("Done. Refresh Platform Catalog on staging.");
  } finally {
    await src.end();
    await dst.end();
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
