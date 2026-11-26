/**
 * A saved size/colour tick list is the catalogue for that product type.
 * The shell product, its Shopify option values, the variant id maps, and
 * variant_shipping all follow it. variantMap stays complete so a later
 * re-tick can mint the variant again.
 *
 * An empty tick list means "never configured" and keeps everything. A list
 * that matches no known id is drift, not a wipe.
 */
import { eq, inArray } from "drizzle-orm";
import {
  droppedSelectionNames,
  variantKeyIsOffered,
  variantMatchesDroppedSelection,
  withoutDroppedVariantKeys,
  type SelectionAxis,
} from "@shared/variantSelection";
import { productTypes, shippingStoreVariants, variantShipping } from "@shared/schema";
import { adminGraphql, shopToken } from "./checkout-guard";
import { db } from "./db";
import { mapVariantShippingForProductTypes } from "./shipping-tables";

const DELETE_CHUNK = 50;
const VARIANT_PAGE = 100;

export type VariantSelectionPrune = {
  productTypeId: number;
  shop: string | null;
  removed: number;
  changed: boolean;
};

type AxisRow = { sizes: string | null; frameColors: string | null; selectedSizeIds: string | null; selectedColorIds: string | null };

function parseAxes(raw: string | null | undefined): SelectionAxis[] {
  try {
    const list = JSON.parse(raw || "[]");
    if (!Array.isArray(list)) return [];
    return list
      .map((row) => ({ id: String(row?.id || "").trim(), name: String(row?.name || "").trim() }))
      .filter((row) => row.id && row.name);
  } catch {
    return [];
  }
}

function parseIdList(raw: string | null | undefined): string[] {
  try {
    const list = JSON.parse(raw || "[]");
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

function asRecord(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return {};
}

function numericId(value: unknown): string {
  const id = String(value ?? "").replace(/\D/g, "");
  return id || "";
}

function productGid(id: string): string {
  return `gid://shopify/Product/${numericId(id)}`;
}

type LiveVariant = { id: string; selectedOptions: Array<{ name?: string | null; value?: string | null }> };

async function readLiveVariants(shop: string, token: string, productId: string): Promise<LiveVariant[] | null> {
  const gid = productGid(productId);
  const variants: LiveVariant[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 30; page++) {
    const data: {
      product?: {
        variants?: {
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
          nodes?: LiveVariant[];
        };
      } | null;
    } = await adminGraphql(shop, token, `query($id: ID!, $cursor: String) {
      product(id: $id) {
        variants(first: ${VARIANT_PAGE}, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes { id selectedOptions { name value } }
        }
      }
    }`, { id: gid, cursor });
    if (!data?.product) return null;
    const conn = data.product.variants;
    variants.push(...(conn?.nodes || []));
    if (!conn?.pageInfo?.hasNextPage) return variants;
    cursor = conn.pageInfo.endCursor || null;
    if (!cursor) return variants;
  }
  throw new Error("Shopify variant list did not finish");
}

async function deleteVariants(shop: string, token: string, productId: string, variantIds: string[]): Promise<void> {
  const gid = productGid(productId);
  for (let i = 0; i < variantIds.length; i += DELETE_CHUNK) {
    const chunk = variantIds.slice(i, i + DELETE_CHUNK);
    const deleted = await adminGraphql<{
      productVariantsBulkDelete?: { userErrors?: Array<{ message?: string }> };
    }>(shop, token, `mutation($productId: ID!, $variantsIds: [ID!]!) {
      productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
        userErrors { message }
      }
    }`, { productId: gid, variantsIds: chunk });
    const errors = deleted?.productVariantsBulkDelete?.userErrors || [];
    if (errors.length) {
      throw new Error(errors.map((err) => err.message).filter(Boolean).join("; ") || "Shopify did not remove the variants");
    }
  }
}

async function deleteUnusedOptionValues(
  shop: string,
  token: string,
  productId: string,
  droppedNames: string[],
): Promise<void> {
  const gid = productGid(productId);
  const dropped = new Set(droppedNames.map((name) => name.trim().toLowerCase()).filter(Boolean));
  if (!dropped.size) return;
  const data = await adminGraphql<{
    product?: {
      options?: Array<{
        id?: string;
        name?: string;
        optionValues?: Array<{ id?: string; name?: string; hasVariants?: boolean }>;
      }>;
    } | null;
  }>(shop, token, `query($id: ID!) {
    product(id: $id) {
      options { id name optionValues { id name hasVariants } }
    }
  }`, { id: gid });
  if (!data?.product) return;
  for (const option of data.product.options || []) {
    if (!option.id) continue;
    const values = option.optionValues || [];
    const leftover = values.filter((value) => dropped.has(String(value.name || "").trim().toLowerCase()) && value.hasVariants);
    if (leftover.length) {
      throw new Error(`Shopify still has variants for ${leftover.map((value) => value.name).filter(Boolean).join(", ")}`);
    }
    const unused = values
      .filter((value) => value.id && dropped.has(String(value.name || "").trim().toLowerCase()) && !value.hasVariants)
      .map((value) => String(value.id));
    if (!unused.length) continue;
    const updated = await adminGraphql<{
      productOptionUpdate?: { userErrors?: Array<{ message?: string }> };
    }>(shop, token, `mutation($productId: ID!, $option: OptionUpdateInput!, $values: [ID!]!) {
      productOptionUpdate(productId: $productId, option: $option, optionValuesToDelete: $values) {
        userErrors { message }
      }
    }`, { productId: gid, option: { id: option.id }, values: unused });
    const errors = updated?.productOptionUpdate?.userErrors || [];
    if (errors.length) {
      throw new Error(errors.map((err) => err.message).filter(Boolean).join("; ") || "Shopify did not remove the option value");
    }
  }
}

export async function pruneShellVariantsToSelection(productTypeId: number): Promise<VariantSelectionPrune> {
  const [row] = await db
    .select({
      id: productTypes.id,
      shop: productTypes.shopifyShopDomain,
      shopifyProductId: productTypes.shopifyProductId,
      sizes: productTypes.sizes,
      frameColors: productTypes.frameColors,
      selectedSizeIds: productTypes.selectedSizeIds,
      selectedColorIds: productTypes.selectedColorIds,
      shopifyVariantIds: productTypes.shopifyVariantIds,
      shopifyVariantIdsBoth: productTypes.shopifyVariantIdsBoth,
    })
    .from(productTypes)
    .where(eq(productTypes.id, productTypeId))
    .limit(1);
  if (!row) return { productTypeId, shop: null, removed: 0, changed: false };

  const sizes = parseAxes(row.sizes);
  const colors = parseAxes(row.frameColors);
  const selectedSizeIds = parseIdList(row.selectedSizeIds);
  const selectedColorIds = parseIdList(row.selectedColorIds);
  const droppedSizes = droppedSelectionNames(sizes, selectedSizeIds);
  const droppedColors = droppedSelectionNames(colors, selectedColorIds);
  if (!droppedSizes.length && !droppedColors.length) {
    return { productTypeId, shop: row.shop, removed: 0, changed: false };
  }

  let removed = 0;
  const removedShopifyIds = new Set<string>();
  if (row.shop && row.shopifyProductId) {
    const token = await shopToken(row.shop);
    const live = await readLiveVariants(row.shop, token, row.shopifyProductId);
    if (live) {
      const dropping = live.filter((variant) =>
        variantMatchesDroppedSelection(variant.selectedOptions || [], droppedSizes, droppedColors),
      );
      if (dropping.length && dropping.length === live.length) {
        throw new Error("Refusing to remove every variant on the store product");
      }
      if (dropping.length) {
        await deleteVariants(row.shop, token, row.shopifyProductId, dropping.map((variant) => variant.id));
        for (const variant of dropping) {
          const id = numericId(variant.id);
          if (id) removedShopifyIds.add(id);
        }
        removed = dropping.length;
      }
      await deleteUnusedOptionValues(row.shop, token, row.shopifyProductId, [...droppedSizes, ...droppedColors]);
    } else {
      console.warn(`[variant-selection] type ${productTypeId} store product ${row.shopifyProductId} was not found`);
    }
  }

  const front = asRecord(row.shopifyVariantIds);
  const both = asRecord(row.shopifyVariantIdsBoth);
  const nextFront = withoutDroppedVariantKeys(front, sizes, colors, selectedSizeIds, selectedColorIds);
  const nextBoth = withoutDroppedVariantKeys(both, sizes, colors, selectedSizeIds, selectedColorIds);
  const mapsStripped = Object.keys(nextFront).length !== Object.keys(front).length
    || Object.keys(nextBoth).length !== Object.keys(both).length;
  if (mapsStripped) {
    const kept = new Set<string>([...Object.values(nextFront), ...Object.values(nextBoth)].map(numericId));
    for (const value of [...Object.values(front), ...Object.values(both)]) {
      const id = numericId(value);
      if (id && !kept.has(id)) removedShopifyIds.add(id);
    }
    await db.update(productTypes).set({
      shopifyVariantIds: nextFront,
      shopifyVariantIdsBoth: Object.keys(nextBoth).length ? nextBoth : null,
    }).where(eq(productTypes.id, productTypeId));
  }

  const shippingRows = await db
    .select({ id: variantShipping.id, sizeColorKey: variantShipping.sizeColorKey })
    .from(variantShipping)
    .where(eq(variantShipping.productTypeId, productTypeId));
  const shippingDropIds = shippingRows
    .filter((entry) => !variantKeyIsOffered(entry.sizeColorKey, sizes, colors, selectedSizeIds, selectedColorIds))
    .map((entry) => entry.id);
  if (shippingDropIds.length) {
    await db.delete(variantShipping).where(inArray(variantShipping.id, shippingDropIds));
  }
  await mapVariantShippingForProductTypes([productTypeId]);

  if (removedShopifyIds.size) {
    await db.delete(shippingStoreVariants).where(inArray(
      shippingStoreVariants.shopifyVariantId,
      [...removedShopifyIds],
    ));
  }

  const changed = removed > 0 || mapsStripped || shippingDropIds.length > 0;
  if (changed) {
    console.log(`[variant-selection] type ${productTypeId}: removed ${removed} store variant(s), ${shippingDropIds.length} shipping row(s)`);
  }
  return { productTypeId, shop: row.shop, removed, changed };
}

function selectionDrifted(
  row: AxisRow & { shopifyVariantIds: unknown; shopifyVariantIdsBoth: unknown },
  shippingKeys: readonly string[],
): boolean {
  const sizes = parseAxes(row.sizes);
  const colors = parseAxes(row.frameColors);
  const selectedSizeIds = parseIdList(row.selectedSizeIds);
  const selectedColorIds = parseIdList(row.selectedColorIds);
  if (!droppedSelectionNames(sizes, selectedSizeIds).length && !droppedSelectionNames(colors, selectedColorIds).length) {
    return false;
  }
  const keys = [
    ...Object.keys(asRecord(row.shopifyVariantIds)),
    ...Object.keys(asRecord(row.shopifyVariantIdsBoth)),
    ...shippingKeys,
  ];
  return keys.some((key) => !variantKeyIsOffered(key, sizes, colors, selectedSizeIds, selectedColorIds));
}

/** Repair types whose saved ticks no longer match the shell map or shipping rows. */
export async function syncDriftedVariantSelections(): Promise<void> {
  const types = await db
    .select({
      id: productTypes.id,
      sizes: productTypes.sizes,
      frameColors: productTypes.frameColors,
      selectedSizeIds: productTypes.selectedSizeIds,
      selectedColorIds: productTypes.selectedColorIds,
      shopifyVariantIds: productTypes.shopifyVariantIds,
      shopifyVariantIdsBoth: productTypes.shopifyVariantIdsBoth,
    })
    .from(productTypes);
  const shipping = await db
    .select({ productTypeId: variantShipping.productTypeId, sizeColorKey: variantShipping.sizeColorKey })
    .from(variantShipping);
  const keysByType = new Map<number, string[]>();
  for (const entry of shipping) {
    const list = keysByType.get(entry.productTypeId) || [];
    list.push(entry.sizeColorKey);
    keysByType.set(entry.productTypeId, list);
  }
  for (const type of types) {
    if (!selectionDrifted(type, keysByType.get(type.id) || [])) continue;
    try {
      await pruneShellVariantsToSelection(type.id);
    } catch (err) {
      console.error(`[variant-selection] type ${type.id} sync failed:`, (err as Error)?.message || err);
    }
  }
}
