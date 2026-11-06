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
