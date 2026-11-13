/**
 * Push variant_availability onto the Shopify variants of catalogue design
 * products. CONTINUE while Printify is in stock, DENY while it is out.
 * Quantity is left at 0. Variants whose policy already matches are skipped.
 */
import { pool } from "./db";
import { adminGraphql, shopToken } from "./checkout-guard";

const TAG = "[catalogue-stock]";

export function desiredInventoryPolicy(status: string | undefined): "CONTINUE" | "DENY" | null {
  if (status === "in_stock") return "CONTINUE";
  if (status === "out_of_stock" || status === "removed") return "DENY";
  return null;
}

type DesignRow = {
  title: string;
  shop: string;
  shopify_product_id: string;
  variant_map: unknown;
};

function parseMap(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, any>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function numericId(id: string): string {
  return String(id || "").replace(/\D/g, "");
}

export async function applyCatalogueInventoryPolicy(productTypeId: number): Promise<{ changes: number }> {
  const typeRow = (
    await pool.query(`SELECT variant_availability FROM product_types WHERE id = $1`, [productTypeId])
  ).rows[0];
  const availability = parseMap(typeRow?.variant_availability);
  const products: DesignRow[] = (
    await pool.query(
      `SELECT title, shop, shopify_product_id, variant_map
         FROM design_products
        WHERE product_type_id = $1
          AND status = 'active'
          AND shopify_product_id IS NOT NULL`,
      [productTypeId],
    )
  ).rows;

  let changes = 0;
  for (const product of products) {
    try {
      changes += await applyProduct(product, availability);
    } catch (err: any) {
      console.error(`${TAG} product="${product.title}" failed:`, err?.message || err);
    }
  }
  console.log(`${TAG} productType=${productTypeId} policy changes=${changes}`);
  return { changes };
}

async function applyProduct(product: DesignRow, availability: Record<string, any>): Promise<number> {
  const productId = numericId(product.shopify_product_id);
  if (!productId) return 0;
  const variantMap = parseMap(product.variant_map);
  const desiredById = new Map<string, "CONTINUE" | "DENY">();
  for (const [variantId, entry] of Object.entries(variantMap)) {
    const key = `${entry?.sizeId || ""}:${entry?.colorId || ""}`;
    const desired = desiredInventoryPolicy(typeof availability[key] === "string" ? availability[key] : undefined);
    const id = numericId(variantId);
    if (!desired || !id) continue;
    desiredById.set(id, desired);
  }
  if (desiredById.size === 0) return 0;

  const token = await shopToken(product.shop);
  const data = await adminGraphql<any>(
    product.shop,
    token,
    `query($id: ID!) {
      product(id: $id) {
        variants(first: 100) { nodes { id inventoryPolicy } }
      }
    }`,
    { id: `gid://shopify/Product/${productId}` },
  );
  const nodes: Array<{ id?: string; inventoryPolicy?: string }> = data?.product?.variants?.nodes || [];
  if (!data?.product) {
    console.log(`${TAG} product="${product.title}" shopify product ${productId} missing`);
    return 0;
  }
  const current = new Map(nodes.map((node) => [numericId(node.id || ""), String(node.inventoryPolicy || "").toUpperCase()]));
  const updates: Array<{ id: string; inventoryPolicy: "CONTINUE" | "DENY" }> = [];
  const flips: Array<{ id: string; from: string; to: "CONTINUE" | "DENY" }> = [];
  for (const [id, desired] of desiredById) {
    const from = current.get(id);
    if (!from || from === desired) continue;
    updates.push({ id: `gid://shopify/ProductVariant/${id}`, inventoryPolicy: desired });
    flips.push({ id, from, to: desired });
  }
  if (updates.length === 0) {
    console.log(`${TAG} product="${product.title}" policy changes=0`);
    return 0;
  }

  const written = await adminGraphql<any>(
    product.shop,
    token,
    `mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id inventoryPolicy }
        userErrors { field message }
      }
    }`,
    { productId: `gid://shopify/Product/${productId}`, variants: updates },
  );
  const userErrors = written?.productVariantsBulkUpdate?.userErrors || [];
  if (userErrors.length) {
    throw new Error(userErrors.map((e: { message?: string }) => e.message || "userError").join("; "));
  }
  for (const flip of flips) {
    console.log(`${TAG} product="${product.title}" variant=${flip.id} ${flip.from}→${flip.to}`);
  }
  return flips.length;
}
