/**
 * Undo the short-lived hoist that put size M at variant position 1.
 * That hoist also rewrote the Size option, so the buttons rendered
 * M, XS, S, L… Restore XS, S, M, L, XL, 2XL, 3XL. The storefront
 * script selects M when the URL has no ?variant=.
 */
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { apparelSizeRank, catalogueVariantPositions } from "@shared/flywheelPromote";
import { designProducts } from "@shared/schema";
import { db } from "./db";
import { normalizeMyshopifyShopDomain } from "./shopDomain";
import { storage } from "./storage";
import { paceVendor, shopifyThrottled, vendorRetryDelayMs } from "./vendor-backoff";

const SHOPIFY_API = "2025-10";

type OptionValue = { id: string; name: string };
type ProductOption = { id: string; name: string; optionValues: OptionValue[] };
type VariantNode = {
  id: string;
  position: number;
  selectedOptions: Array<{ name: string; value: string }>;
};

async function adminGql(shop: string, token: string, query: string, variables: Record<string, unknown>) {
  for (let attempt = 0; ; attempt++) {
    await paceVendor("shopify");
    const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json().catch(() => ({}));
    const throttled = shopifyThrottled(json);
    const delay = vendorRetryDelayMs(throttled ? 429 : res.status, res.headers.get("retry-after"), attempt, throttled);
    if (delay != null) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    if (!res.ok || json?.errors?.length) {
      const message = json?.errors?.map((err: { message?: string }) => err.message).filter(Boolean).join("; ");
      throw new Error(message || `Shopify HTTP ${res.status}`);
    }
    return json.data;
  }
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export async function backfillDefaultSizeMedium(): Promise<{ updated: number; skipped: number; failed: number }> {
  const rows = await db
    .select({
      id: designProducts.id,
      shop: designProducts.shop,
      shopifyProductId: designProducts.shopifyProductId,
    })
    .from(designProducts)
    .where(and(
      eq(designProducts.sizeOrderRestored, false),
      eq(designProducts.defaultSizeBackfilled, true),
      isNotNull(designProducts.shopifyProductId),
      ne(designProducts.shopifyProductId, ""),
    ));
  const tokens = new Map<string, string | null>();
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows) {
    const shop = normalizeMyshopifyShopDomain(row.shop);
    const numeric = String(row.shopifyProductId || "").replace(/\D/g, "");
    if (!shop || !numeric) {
      skipped += 1;
      continue;
    }
    if (!tokens.has(shop)) {
      const installation = await storage.getShopifyInstallationByShop(shop);
      tokens.set(shop, installation?.accessToken || null);
    }
    const token = tokens.get(shop);
    if (!token) {
      failed += 1;
      continue;
    }
    try {
      const productGid = `gid://shopify/Product/${numeric}`;
      const data = await adminGql(shop, token, `
        query($id: ID!) {
          product(id: $id) {
            options { id name optionValues { id name } }
            variants(first: 100) { nodes { id position selectedOptions { name value } } }
          }
        }
      `, { id: productGid });
      const options = (data?.product?.options || []) as ProductOption[];
      const nodes = (data?.product?.variants?.nodes || []) as VariantNode[];
      if (!data?.product || !nodes.length) {
        await db.update(designProducts).set({ sizeOrderRestored: true }).where(eq(designProducts.id, row.id));
        skipped += 1;
        continue;
      }
      const positions = catalogueVariantPositions(nodes.map((variant) => ({
        id: variant.id,
        colour: variant.selectedOptions.find((option) => /^colou?r$/i.test(option.name))?.value || "",
        size: variant.selectedOptions.find((option) => option.name.toLowerCase() === "size")?.value || "",
      })));
      const currentIds = [...nodes].sort((a, b) => a.position - b.position).map((variant) => variant.id);
      const wantedIds = [...positions].sort((a, b) => a.position - b.position).map((variant) => variant.id);
      let changed = false;
      if (!sameIds(currentIds, wantedIds)) {
        const moved = await adminGql(shop, token, `
          mutation($productId: ID!, $positions: [ProductVariantPositionInput!]!) {
            productVariantsBulkReorder(productId: $productId, positions: $positions) {
              userErrors { message }
            }
          }
        `, { productId: productGid, positions });
        const errors = moved?.productVariantsBulkReorder?.userErrors || [];
        if (errors.length) {
          throw new Error(errors.map((err: { message?: string }) => err.message).filter(Boolean).join("; "));
        }
        changed = true;
      }
      const sizeOption = options.find((option) => option.name.toLowerCase() === "size");
      const sortedSize = sizeOption
        ? [...sizeOption.optionValues].sort((a, b) => apparelSizeRank(a.name) - apparelSizeRank(b.name) || a.name.localeCompare(b.name))
        : [];
      const sizeIds = sizeOption ? sizeOption.optionValues.map((value) => value.id) : [];
      const wantedSizeIds = sortedSize.map((value) => value.id);
      if (sizeOption && !sameIds(sizeIds, wantedSizeIds)) {
        const reordered = await adminGql(shop, token, `
          mutation($productId: ID!, $options: [OptionReorderInput!]!) {
            productOptionsReorder(productId: $productId, options: $options) {
              userErrors { message }
            }
          }
        `, {
          productId: productGid,
          options: options.map((option) => {
            const values = option.id === sizeOption.id ? sortedSize : option.optionValues;
            return { id: option.id, values: values.map((value) => ({ id: value.id })) };
          }),
        });
        const errors = reordered?.productOptionsReorder?.userErrors || [];
        if (errors.length) {
          throw new Error(errors.map((err: { message?: string }) => err.message).filter(Boolean).join("; "));
        }
        changed = true;
      }
      await db.update(designProducts).set({ sizeOrderRestored: true }).where(eq(designProducts.id, row.id));
      if (changed) updated += 1;
      else skipped += 1;
    } catch (err) {
      failed += 1;
      console.warn(`[size-order] ${numeric}:`, err instanceof Error ? err.message : err);
    }
  }
  return { updated, skipped, failed };
}
