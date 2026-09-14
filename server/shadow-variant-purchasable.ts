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
 *
 * Table-mode shops also require the shadow in the *base* delivery profile.
 * A shadow left on General (US-only) 422s "already sold out" for non-US
 * buyers even when CONTINUE + tracked:false + Ajax-visible all pass.
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

function gidNumeric(id: string | null | undefined): string {
  return String(id || "").replace(/\D/g, "");
}

export function deliveryProfileIdsEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = gidNumeric(a);
  const right = gidNumeric(b);
  return !!left && left === right;
}

type DeliveryProfileRef = { id: string | null; name: string | null };

async function readVariantDeliveryProfile(opts: {
  shop: string;
  token: string;
  variantId: string;
}): Promise<DeliveryProfileRef> {
  const json = await shopifyGraphql({
    shop: opts.shop,
    token: opts.token,
    variantId: opts.variantId,
    query: `query($id: ID!) {
      productVariant(id: $id) {
        id
        deliveryProfile { id name default }
      }
    }`,
    variables: { id: `gid://shopify/ProductVariant/${opts.variantId}` },
  });
  const profile = json?.data?.productVariant?.deliveryProfile;
  return {
    id: profile?.id ? String(profile.id) : null,
    name: profile?.name ? String(profile.name) : null,
  };
}

/**
 * Shopify associates a variant with exactly one delivery profile.
 * `variantsToAssociate` moves it — it does not leave the General/US-only
 * profile evaluable alongside the destination.
 */
export async function ensureShadowDeliveryProfileParity(opts: {
  shop: string;
  token: string;
  variantId: string;
  baseVariantId: string;
}): Promise<void> {
  const shop = String(opts.shop || "").trim();
  const token = String(opts.token || "").trim();
  const variantId = gidNumeric(opts.variantId);
  const baseVariantId = gidNumeric(opts.baseVariantId);
  if (!shop || !token || !variantId || !baseVariantId) {
    throw new ShadowVariantNotPurchasableError(
      "Shadow delivery-profile parity skipped — missing shop, token, variant, or base",
      variantId || "unknown",
    );
  }

  const [shadowBefore, base] = await Promise.all([
    readVariantDeliveryProfile({ shop, token, variantId }),
    readVariantDeliveryProfile({ shop, token, variantId: baseVariantId }),
  ]);
  if (!base.id) {
    throw new ShadowVariantNotPurchasableError(
      `Shadow delivery-profile parity missed base profile for ${baseVariantId}`,
      variantId,
      { shadow: shadowBefore, base },
    );
  }

  if (deliveryProfileIdsEqual(shadowBefore.id, base.id)) {
    console.log(
      `[ShadowProduct] deliveryProfile parity ok variant=${variantId} profile=${gidNumeric(base.id)} (${base.name || "unnamed"})`,
    );
    return;
  }

  const fromLabel = `${gidNumeric(shadowBefore.id) || "none"} (${shadowBefore.name || "none"})`;
  const toLabel = `${gidNumeric(base.id)} (${base.name || "unnamed"})`;
  console.log(
    `[ShadowProduct] deliveryProfile repairing variant=${variantId} ${fromLabel} -> ${toLabel}`,
  );

  const moved = await shopifyGraphql({
    shop,
    token,
    variantId,
    query: `mutation($id: ID!, $profile: DeliveryProfileInput!) {
      deliveryProfileUpdate(id: $id, profile: $profile) {
        profile { id }
        userErrors { field message }
      }
    }`,
    variables: {
      id: base.id,
      profile: { variantsToAssociate: [`gid://shopify/ProductVariant/${variantId}`] },
    },
  });
  const payload = moved?.data?.deliveryProfileUpdate;
  const userErrors: Array<{ field?: unknown; message?: string }> = payload?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new ShadowVariantNotPurchasableError(
      `Shadow deliveryProfile associate rejected: ${formatGraphqlProblems(moved, userErrors)}`,
      variantId,
      userErrors,
    );
  }

  const after = await readVariantDeliveryProfile({ shop, token, variantId });
  if (!deliveryProfileIdsEqual(after.id, base.id)) {
    throw new ShadowVariantNotPurchasableError(
      `Shadow delivery profile did not land (wanted ${gidNumeric(base.id)}, got ${gidNumeric(after.id) || "none"})`,
      variantId,
      { wanted: base, got: after },
    );
  }
  console.log(
    `[ShadowProduct] deliveryProfile repaired ${fromLabel} -> ${toLabel} variant=${variantId}`,
  );
}

async function attachShadowShippingBestEffort(opts: {
  shop: string;
  shopifyVariantId: string;
  sourceVariantId: string;
}): Promise<void> {
  try {
    const { attachVariantToShipping } = await import("./shipping-reconciler");
    await attachVariantToShipping({
      shop: opts.shop,
      shopifyVariantId: opts.shopifyVariantId,
      sourceVariantId: opts.sourceVariantId,
      source: "shadow",
    });
  } catch (e: any) {
    console.warn(
      `[ShadowProduct] shipping attach failed for ${opts.shopifyVariantId}:`,
      e?.message || e,
    );
  }
}

/**
 * Write inventoryPolicy CONTINUE on this variant and assert it landed.
 * Also attempts to untrack inventory (non-fatal if CONTINUE already landed).
 * When baseVariantId is set, the shadow must end in exactly the base's
 * delivery profile (Shopify moves the variant; General is not left additive).
 */
export async function ensureShadowVariantPurchasable(opts: {
  shop: string;
  token: string;
  variantId: string | number;
  baseVariantId?: string | number;
}): Promise<void> {
  const shop = String(opts.shop || "").trim();
  const token = String(opts.token || "").trim();
  const variantId = String(opts.variantId || "").replace(/\D/g, "");
  const baseVariantId = String(opts.baseVariantId || "").replace(/\D/g, "");
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
  if (itemId) {
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

  if (baseVariantId) {
    await ensureShadowDeliveryProfileParity({
      shop,
      token,
      variantId,
      baseVariantId,
    });
    await attachShadowShippingBestEffort({
      shop,
      shopifyVariantId: variantId,
      sourceVariantId: baseVariantId,
    });
  }
}

/** @deprecated Use ensureShadowVariantPurchasable */
export const ensureShadowVariantUntracked = ensureShadowVariantPurchasable;
