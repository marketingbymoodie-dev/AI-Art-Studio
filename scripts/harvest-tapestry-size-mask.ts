/**
 * Harvest a per-size Indoor Wall Tapestry (241) droop mask via harvestFlatCalibration
 * and merge it into the existing canonical manifest (size-only geometryByBlank key).
 *
 *   npx tsx scripts/harvest-tapestry-size-mask.ts --size=50x60
 *   npx tsx scripts/harvest-tapestry-size-mask.ts --size=50x60 --productTypeId=28
 *
 * Does NOT wipe other harvest assets. Probe one size, eyeball, then repeat.
 */
import "../server/load-env";
import pg from "pg";
import { extractDimensionalKey } from "../shared/productVariantOptions";
import {
  CATALOG_SIZE_BLANK_BLUEPRINTS,
  CATALOG_SIZE_BLANK_STORAGE_PATHS,
} from "../shared/catalogSizeBlanks";
import { canonicalStorageKey, canonicalManifestPath } from "../shared/canonicalProducts";
import { DEFAULT_CANONICAL_VERSION } from "../server/canonicalFlatCalibration";

const BLUEPRINT_ID = CATALOG_SIZE_BLANK_BLUEPRINTS.indoorWallTapestry;
const SIZE_KEYS = Object.keys(CATALOG_SIZE_BLANK_STORAGE_PATHS[BLUEPRINT_ID]);

function argValue(name: string): string | undefined {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0) return process.argv[idx + 1];
  const inline = process.argv.find((a) => a.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : undefined;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function main() {
  const rawSize = argValue("size") || "50x60";
  const sizeKey = extractDimensionalKey(rawSize) || rawSize;
  if (!SIZE_KEYS.includes(sizeKey)) {
    throw new Error(`Unknown tapestry size ${rawSize}. Expected one of: ${SIZE_KEYS.join(", ")}`);
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL missing");

  const { harvestFlatCalibration } = await import("../server/flat-calibration");
  type FlatCalibrationManifest = import("../server/flat-calibration").FlatCalibrationManifest;
  const {
    loadCanonicalManifest,
    loadCanonicalPublishedMeta,
    merchantManifestFromCanonical,
  } = await import("../server/canonicalFlatCalibration");
  const { uploadToFlatCalibrationBucket } = await import("../server/supabaseFlatCalibration");
  const { storage } = await import("../server/storage");

  const pool = new pg.Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes("rlwy.net") ? { rejectUnauthorized: false } : false,
  });

  let productTypeId = argValue("productTypeId")
    ? Number(argValue("productTypeId"))
    : 0;
  let token = "";
  let shopId = "";
  let providerId = 0;
  let designerType: string | null = null;
  let sizes: unknown = [];
  let frameColors: unknown = [];
  let variantMap: unknown = {};
  let name = "Indoor Wall Tapestry";

  try {
    const { rows } = await pool.query(
      `SELECT pt.id, pt.name, pt.designer_type, pt.sizes, pt.frame_colors, pt.variant_map,
              pt.printify_provider_id, m.printify_api_token, m.printify_shop_id
         FROM product_types pt
         LEFT JOIN merchants m ON m.id = pt.merchant_id
         WHERE pt.printify_blueprint_id = $1
         ORDER BY pt.updated_at DESC NULLS LAST
         LIMIT 8`,
      [BLUEPRINT_ID],
    );
    const row = productTypeId
      ? rows.find((r) => Number(r.id) === productTypeId) || rows[0]
      : rows[0];
    if (!row) throw new Error(`No product_types row for blueprint ${BLUEPRINT_ID}`);
    productTypeId = Number(row.id);
    name = String(row.name || name);
    designerType = row.designer_type ? String(row.designer_type) : null;
    sizes = parseJson(row.sizes, []);
    frameColors = parseJson(row.frame_colors, []);
    variantMap = parseJson(row.variant_map, {});
    providerId = Number(row.printify_provider_id);
    token = String(row.printify_api_token || process.env.PRINTIFY_API_TOKEN || "");
    shopId = String(row.printify_shop_id || process.env.PRINTIFY_SHOP_ID || "");
  } finally {
    await pool.end();
  }

  if (!token || !shopId) {
    throw new Error("Printify token/shop missing on merchant (and no PRINTIFY_* env fallback)");
  }
  if (!providerId) throw new Error(`product type ${productTypeId} has no printify_provider_id`);

  const published = await loadCanonicalPublishedMeta(BLUEPRINT_ID);
  const version = published?.version || DEFAULT_CANONICAL_VERSION;
  const storageKey = canonicalStorageKey(BLUEPRINT_ID, version);
  const existing = await loadCanonicalManifest(BLUEPRINT_ID, version);

  console.log(
    `[tapestry-mask] harvesting ${sizeKey} via harvestFlatCalibration (pt ${productTypeId}, ${storageKey})`,
  );

  const result = await harvestFlatCalibration({
    productTypeId,
    name,
    blueprintId: BLUEPRINT_ID,
    providerId,
    token,
    shopId,
    designerType,
    sizes,
    frameColors,
    variantMap,
    onlyColorIds: [sizeKey],
    calibratorMode: true,
    wipeExisting: false,
    storageKey,
    forceFlatHarvest: true,
  });

  const harvested = result.manifest?.geometryByBlank?.[sizeKey];
  const maskUrl = harvested?.front?.maskUrl || harvested?.back?.maskUrl;
  if (!harvested || !maskUrl) {
    console.error(
      `[tapestry-mask] no geometryByBlank[${sizeKey}] mask. status=${result.status} error=${result.error || ""} keys=${Object.keys(result.manifest?.geometryByBlank || {}).join(",")}`,
    );
    process.exit(1);
  }

  const merged: FlatCalibrationManifest = existing
    ? {
        ...existing,
        geometryByBlank: {
          ...(existing.geometryByBlank || {}),
          [sizeKey]: harvested,
        },
        generatedAt: new Date().toISOString(),
      }
    : result.manifest;

  await uploadToFlatCalibrationBucket(
    canonicalManifestPath(BLUEPRINT_ID, version),
    Buffer.from(JSON.stringify(merged, null, 2), "utf-8"),
    "application/json",
  );
  console.log(`[tapestry-mask] merged ${sizeKey} mask into ${canonicalManifestPath(BLUEPRINT_ID, version)}`);
  console.log(`[tapestry-mask] maskUrl=${maskUrl}`);

  const pts = await storage.getProductTypes();
  let synced = 0;
  for (const pt of pts) {
    if (Number(pt.printifyBlueprintId) !== BLUEPRINT_ID) continue;
    await storage.updateProductType(pt.id, {
      onTheFlyTier: merged.tier,
      flatCalibrationStatus: "ready",
      flatCalibration: JSON.stringify(merchantManifestFromCanonical(merged, pt.id, pt.name)),
    });
    synced += 1;
    console.log(`[tapestry-mask] synced pt ${pt.id} (${pt.name})`);
  }
  console.log(`[tapestry-mask] done. ${sizeKey} mask ready on ${synced} product type(s). Eyeball 50x60 before harvesting more sizes.`);
}

main().catch((err) => {
  console.error("[tapestry-mask]", err?.message || err);
  process.exit(1);
});
