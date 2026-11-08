/**
 * Pinned `ai_art_studio.my_pet_enabled` product metafield definition.
 *
 * Created once per shop (idempotent — Shopify returns a TAKEN userError on
 * repeat calls, which this treats as success) so the field shows as a
 * checkbox on the product admin page and can be toggled any time after
 * publishing, per design-candidate product, without redeploy.
 */
import { paceVendor, shopifyThrottled, vendorRetryDelayMs } from "./vendor-backoff";

const SHOPIFY_API = "2025-10";

async function adminGql(shop: string, token: string, query: string, variables: Record<string, unknown> = {}) {
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
      console.warn(`[my-pet-metafields] Shopify ${res.status} — retry in ${delay}ms`);
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

function productGid(shopifyProductId: string): string {
  const numeric = String(shopifyProductId).replace(/\D/g, "");
  if (!numeric) throw new Error("Missing Shopify product id");
  return `gid://shopify/Product/${numeric}`;
}

/** Writes the product boolean. Does not change the database row. */
export async function setProductMyPetEnabled(
  shop: string,
  token: string,
  shopifyProductId: string,
  enabled: boolean,
): Promise<void> {
  await ensureMyPetMetafieldDefinition(shop, token);
  const data = await adminGql(shop, token, `
    mutation($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { message }
      }
    }
  `, {
    metafields: [{
      ownerId: productGid(shopifyProductId),
      namespace: "ai_art_studio",
      key: "my_pet_enabled",
      type: "boolean",
      value: enabled ? "true" : "false",
    }],
  });
  const errors = data?.metafieldsSet?.userErrors || [];
  if (errors.length) {
    throw new Error(errors.map((err: { message?: string }) => err.message).filter(Boolean).join("; "));
  }
}

/** null when the product has no value yet. */
export async function readProductMyPetEnabled(
  shop: string,
  token: string,
  shopifyProductId: string,
): Promise<boolean | null> {
  const data = await adminGql(shop, token, `
    query($id: ID!) {
      product(id: $id) {
        metafield(namespace: "ai_art_studio", key: "my_pet_enabled") { value }
      }
    }
  `, { id: productGid(shopifyProductId) });
  const value = data?.product?.metafield?.value;
  if (value == null || value === "") return null;
  return String(value) === "true";
}

/**
 * Existing Petposterous listings were created before the storefront required
 * an explicit true. Set the metafield only where it is still unset, so an
 * admin false is left alone on later boots.
 */
export async function backfillUnsetMyPetEnabled(): Promise<{ set: number; skipped: number; failed: number }> {
  const { and, isNotNull, ne } = await import("drizzle-orm");
  const { designProducts } = await import("@shared/schema");
  const { db } = await import("./db");
  const { normalizeMyshopifyShopDomain } = await import("./shopDomain");
  const { storage } = await import("./storage");
  const rows = await db
    .select({
      shop: designProducts.shop,
      shopifyProductId: designProducts.shopifyProductId,
    })
    .from(designProducts)
    .where(and(isNotNull(designProducts.shopifyProductId), ne(designProducts.shopifyProductId, "")));
  const tokens = new Map<string, string | null>();
  let set = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows) {
    const productId = String(row.shopifyProductId || "");
    const shop = normalizeMyshopifyShopDomain(row.shop);
    if (!productId || !shop) {
      skipped += 1;
      continue;
    }
    if (!tokens.has(shop)) {
      const installation = await storage.getShopifyInstallationByShop(shop);
      tokens.set(shop, installation?.accessToken || null);
    }
    const token = tokens.get(shop);
    if (!token) {
      skipped += 1;
      continue;
    }
    try {
      const current = await readProductMyPetEnabled(shop, token, productId);
      if (current != null) {
        skipped += 1;
        continue;
      }
      await setProductMyPetEnabled(shop, token, productId, true);
      set += 1;
    } catch (err) {
      failed += 1;
      console.warn(`[my-pet-metafields] backfill ${productId}:`, err instanceof Error ? err.message : err);
    }
  }
  return { set, skipped, failed };
}

/** Idempotent — safe to call on every product publish. Never throws on "already exists". */
export async function ensureMyPetMetafieldDefinition(shop: string, token: string): Promise<void> {
  try {
    const data = await adminGql(
      shop,
      token,
      `mutation CreateMyPetMetafieldDefinition($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition { id }
          userErrors { field message code }
        }
      }`,
      {
        definition: {
          name: "My Pet enabled",
          namespace: "ai_art_studio",
          key: "my_pet_enabled",
          type: "boolean",
          ownerType: "PRODUCT",
          pin: true,
          description: "Shows the \"My Pet\" button on this product page. On by default for new designs.",
        },
      },
    );
    const userErrors = data?.metafieldDefinitionCreate?.userErrors || [];
    const hardErrors = userErrors.filter((e: { code?: string }) => e.code !== "TAKEN");
    if (hardErrors.length) {
      console.warn(`[my-pet-metafields] definition create userErrors for ${shop}:`, JSON.stringify(hardErrors));
    }
  } catch (err) {
    // Best-effort: a missing pinned definition only affects the admin checkbox UI, not
    // the metafield read/write itself (Liquid/Admin can still set+read an unpinned one).
    console.warn(`[my-pet-metafields] ensureMyPetMetafieldDefinition failed for ${shop}:`, (err as Error)?.message);
  }
}
