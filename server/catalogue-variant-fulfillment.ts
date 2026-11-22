/**
 * Catalogue (design product) Shopify variant → Printify variant.
 * The storefront colour name ("Blue") is not the Printify colour id ("sapphire").
 * The design product's variant_map is the source of truth for both.
 */
import { pool } from "./db";

export type CataloguePrintifyVariant = {
  sizeId: string;
  colorId: string;
  printifyVariantId: number;
};

export function readCataloguePrintifyVariant(entry: unknown): CataloguePrintifyVariant | null {
  if (!entry || typeof entry !== "object") return null;
  const row = entry as { sizeId?: unknown; colorId?: unknown; printifyVariantId?: unknown };
  const printifyVariantId = Number(row.printifyVariantId);
  const sizeId = String(row.sizeId || "").trim();
  const colorId = String(row.colorId || "").trim();
  if (!sizeId || !colorId || !Number.isFinite(printifyVariantId) || printifyVariantId <= 0) return null;
  return { sizeId, colorId, printifyVariantId };
}

function numericId(id: string): string {
  return String(id || "").replace(/\D/g, "");
}

export async function catalogueVariantForShopifyVariant(
  shop: string,
  shopifyVariantId: string,
): Promise<CataloguePrintifyVariant | null> {
  const variantId = numericId(shopifyVariantId);
  if (!shop || !variantId) return null;
  const result = await pool.query(
    `SELECT variant_map::jsonb -> $2 AS entry
       FROM design_products
      WHERE lower(shop) = lower($1)
        AND status = 'active'
        AND variant_map::jsonb ? $2
      LIMIT 1`,
    [shop, variantId],
  );
  return readCataloguePrintifyVariant(result.rows[0]?.entry);
}

/**
 * `ok` — this variant has a Printify id, or this product is not a catalogue design.
 * `refuse` — the catalogue product is known and this size×colour has no Printify variant.
 */
export async function catalogueVariantGate(
  shop: string,
  shopifyVariantId: string,
  shopifyProductId?: string | null,
): Promise<"ok" | "refuse"> {
  const variantId = numericId(shopifyVariantId);
  if (!shop || !variantId) return "ok";
  const byVariant = await pool.query(
    `SELECT variant_map::jsonb -> $2 AS entry
       FROM design_products
      WHERE lower(shop) = lower($1)
        AND status = 'active'
        AND variant_map::jsonb ? $2
      LIMIT 1`,
    [shop, variantId],
  );
  if (byVariant.rows[0]) {
    return readCataloguePrintifyVariant(byVariant.rows[0].entry) ? "ok" : "refuse";
  }
  const productId = numericId(String(shopifyProductId || ""));
  if (!productId) return "ok";
  const byProduct = await pool.query(
    `SELECT variant_map::jsonb -> $3 AS entry, (variant_map::jsonb ? $3) AS present
       FROM design_products
      WHERE lower(shop) = lower($1)
        AND status = 'active'
        AND shopify_product_id = $2
      LIMIT 1`,
    [shop, productId, variantId],
  );
  if (!byProduct.rows[0]) return "ok";
  if (!byProduct.rows[0].present) return "refuse";
  return readCataloguePrintifyVariant(byProduct.rows[0].entry) ? "ok" : "refuse";
}

export async function fulfillableCatalogueVariantIds(
  shop: string,
  shopifyProductId: string,
): Promise<{ catalogue: boolean; fulfillableVariantIds: string[] }> {
  const productId = numericId(shopifyProductId);
  if (!shop || !productId) return { catalogue: false, fulfillableVariantIds: [] };
  const result = await pool.query(
    `SELECT variant_map
       FROM design_products
      WHERE lower(shop) = lower($1)
        AND status = 'active'
        AND shopify_product_id = $2
      LIMIT 1`,
    [shop, productId],
  );
  const map = result.rows[0]?.variant_map;
  if (!map || typeof map !== "object") return { catalogue: false, fulfillableVariantIds: [] };
  const fulfillableVariantIds = Object.entries(map as Record<string, unknown>)
    .filter(([, entry]) => readCataloguePrintifyVariant(entry))
    .map(([id]) => id);
  return { catalogue: true, fulfillableVariantIds };
}
