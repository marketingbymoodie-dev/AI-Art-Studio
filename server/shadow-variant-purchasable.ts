/**
 * POD / shadow variants must stay purchasable. REST ProductVariant
 * inventory_management / inventory_policy are ignored on Admin API 2025-10
 * (default policy DENY, qty 0 → Ajax cart 422 "already sold out").
 *
 * Owner of the setting: GraphQL productVariantsBulkUpdate(inventoryPolicy: CONTINUE).
 * REST is not used. CONTINUE is written unconditionally — never gated on tracked.
 * The write is asserted: HTTP 200 with userErrors, or a returned policy other
 * than CONTINUE, throws. Do not fire-and-forget.
 *
 * Ajax /cart/add.js also requires the shadow product on the Online Store
 * channel. Publication is asserted here too — a CONTINUE-only write still
 * 422s as sold-out / not-found when the product is unpublished, and reuse
 * used to skip publish entirely (second tap stayed stuck).
 */

import {
  ShadowNotOnStorefrontError,
  ensureProductOnOnlineStore,
} from "./shopify-publications";

export class ShadowVariantNotPurchasableError extends Error {
  readonly code = "shadow_not_purchasable" as const;
  constructor(
    message: string,
    readonly variantId: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ShadowVariantNotPurchasableError";
  }
}

type GraphqlJson = {
  data?: any;
  errors?: Array<{ message?: string }>;
};

function formatGraphqlProblems(
  json: GraphqlJson,
  userErrors?: Array<{ field?: unknown; message?: string }>,
): string {
  const top = (json.errors ?? [])
    .map((e) => String(e?.message || "").trim())
    .filter(Boolean);
  const users = (userErrors ?? [])
    .map((e) => String(e?.message || "").trim())
    .filter(Boolean);
  return [...top, ...users].join("; ") || "unknown GraphQL failure";
}

async function shopifyGraphql(opts: {
  shop: string;
  token: string;
  variantId: string;
  query: string;
  variables: Record<string, unknown>;
}): Promise<GraphqlJson> {
  const res = await fetch(`https://${opts.shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": opts.token,
    },
    body: JSON.stringify({ query: opts.query, variables: opts.variables }),
  });
  const json = (await res.json().catch(() => ({}))) as GraphqlJson;
  if (!res.ok) {
    throw new ShadowVariantNotPurchasableError(
      `Shadow purchasable GraphQL HTTP ${res.status}`,
      opts.variantId,
      json,
    );
  }
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    throw new ShadowVariantNotPurchasableError(
      `Shadow purchasable GraphQL errors: ${formatGraphqlProblems(json)}`,
      opts.variantId,
      json.errors,
    );
  }
  return json;
}

/**
 * Write inventoryPolicy CONTINUE on this variant and assert it landed.
 * Also attempts to untrack inventory (non-fatal if CONTINUE already landed).
 */
export async function ensureShadowVariantPurchasable(opts: {
  shop: string;
  token: string;
  variantId: string | number;
}): Promise<void> {
  const shop = String(opts.shop || "").trim();
  const token = String(opts.token || "").trim();
  const variantId = String(opts.variantId || "").replace(/\D/g, "");
  if (!shop || !token || !variantId) {
    throw new ShadowVariantNotPurchasableError(
      "Shadow purchasable write skipped — missing shop, token, or variantId",
      variantId || "unknown",
    );
  }

  const variantGid = `gid://shopify/ProductVariant/${variantId}`;
  const lookup = await shopifyGraphql({
    shop,
    token,
    variantId,
    query: `query($id: ID!) {
      productVariant(id: $id) {
        id
        inventoryPolicy
        product { id }
        inventoryItem { id tracked }
      }
    }`,
    variables: { id: variantGid },
  });
  const variant = lookup?.data?.productVariant;
  const productGid = String(variant?.product?.id || "");
  if (!productGid) {
    throw new ShadowVariantNotPurchasableError(
      `Shadow purchasable lookup missed product id for variant ${variantId}`,
      variantId,
      lookup,
    );
  }

  // Unconditional CONTINUE — do not skip when inventoryItem.tracked is already false.
  const updated = await shopifyGraphql({
    shop,
    token,
    variantId,
    query: `mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id inventoryPolicy }
        userErrors { field message }
      }
    }`,
    variables: {
      productId: productGid,
      variants: [{ id: variantGid, inventoryPolicy: "CONTINUE" }],
    },
  });
  const bulk = updated?.data?.productVariantsBulkUpdate;
  const userErrors: Array<{ field?: unknown; message?: string }> = bulk?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new ShadowVariantNotPurchasableError(
      `Shadow inventoryPolicy CONTINUE rejected: ${formatGraphqlProblems(updated, userErrors)}`,
      variantId,
      userErrors,
    );
  }
  const writtenPolicy = String(bulk?.productVariants?.[0]?.inventoryPolicy || "").toUpperCase();
  if (writtenPolicy !== "CONTINUE") {
    throw new ShadowVariantNotPurchasableError(
      `Shadow inventoryPolicy write did not land (got ${writtenPolicy || "empty"})`,
      variantId,
      bulk,
    );
  }
  console.log(`[ShadowProduct] inventoryPolicy CONTINUE confirmed for variant ${variantId}`);

  const numericProductId = productGid.replace(/\D/g, "");
  try {
    await ensureProductOnOnlineStore({
      shop,
      accessToken: token,
      productId: numericProductId,
    });
  } catch (e: any) {
    if (e instanceof ShadowNotOnStorefrontError) {
      throw new ShadowVariantNotPurchasableError(e.message, variantId, e.details);
    }
    throw new ShadowVariantNotPurchasableError(
      `Shadow Online Store publish failed: ${e?.message || e}`,
      variantId,
    );
  }

  const itemId = variant?.inventoryItem?.id;
  if (!itemId) return;
  try {
    const untracked = await shopifyGraphql({
      shop,
      token,
      variantId,
      query: `mutation($id: ID!, $input: InventoryItemInput!) {
        inventoryItemUpdate(id: $id, input: $input) {
          inventoryItem { id tracked }
          userErrors { field message }
        }
      }`,
      variables: { id: itemId, input: { tracked: false } },
    });
    const untrackErrors = untracked?.data?.inventoryItemUpdate?.userErrors ?? [];
    if (untrackErrors.length > 0) {
      console.error(
        `[ShadowProduct] inventoryItem untrack userErrors for ${variantId}:`,
        JSON.stringify(untrackErrors).slice(0, 240),
      );
    }
  } catch (e: any) {
    console.error(
      `[ShadowProduct] inventoryItem untrack failed for ${variantId} (CONTINUE already confirmed):`,
      e?.message || e,
    );
  }
}

/** @deprecated Use ensureShadowVariantPurchasable */
export const ensureShadowVariantUntracked = ensureShadowVariantPurchasable;
