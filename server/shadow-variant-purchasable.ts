/**
 * Shopify REST still creates InventoryItems as tracked=true (qty 0) even when
 * we send inventory_management: null. Force untracked + continue so a second
 * add of the same shadow cannot 422 as "already sold out".
 */
export async function ensureShadowVariantUntracked(opts: {
  shop: string;
  token: string;
  variantId: string | number;
}): Promise<void> {
  const shop = String(opts.shop || "").trim();
  const token = String(opts.token || "").trim();
  const variantId = String(opts.variantId || "").replace(/\D/g, "");
  if (!shop || !token || !variantId) return;

  const apiBase = `https://${shop}/admin/api/2025-10`;
  const restHeaders = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": token,
  };

  try {
    await fetch(`${apiBase}/variants/${variantId}.json`, {
      method: "PUT",
      headers: restHeaders,
      body: JSON.stringify({
        variant: {
          id: Number(variantId),
          inventory_management: null,
          inventory_policy: "continue",
        },
      }),
    });
  } catch (e: any) {
    console.warn(
      `[ShadowProduct] REST untrack failed for ${variantId}:`,
      e?.message || e,
    );
  }

  try {
    const gqlEndpoint = `${apiBase}/graphql.json`;
    const gid = `gid://shopify/ProductVariant/${variantId}`;
    const lookup = await fetch(gqlEndpoint, {
      method: "POST",
      headers: restHeaders,
      body: JSON.stringify({
        query: `query($id: ID!) {
          node(id: $id) {
            ... on ProductVariant { id inventoryItem { id tracked } }
          }
        }`,
        variables: { id: gid },
      }),
    });
    const lookupJson = (await lookup.json()) as any;
    const itemId = lookupJson?.data?.node?.inventoryItem?.id;
    const tracked = lookupJson?.data?.node?.inventoryItem?.tracked;
    if (!itemId) return;
    if (tracked === false) return;
    const updated = await fetch(gqlEndpoint, {
      method: "POST",
      headers: restHeaders,
      body: JSON.stringify({
        query: `mutation($id: ID!, $input: InventoryItemInput!) {
          inventoryItemUpdate(id: $id, input: $input) {
            inventoryItem { id tracked }
            userErrors { field message }
          }
        }`,
        variables: { id: itemId, input: { tracked: false } },
      }),
    });
    const updatedJson = (await updated.json()) as any;
    const userErrors = updatedJson?.data?.inventoryItemUpdate?.userErrors ?? [];
    if (userErrors.length > 0) {
      console.warn(
        `[ShadowProduct] GraphQL untrack userErrors for ${variantId}:`,
        JSON.stringify(userErrors).slice(0, 240),
      );
    } else {
      console.log(`[ShadowProduct] Forced untracked inventory for variant ${variantId}`);
    }
  } catch (e: any) {
    console.warn(
      `[ShadowProduct] GraphQL untrack failed for ${variantId}:`,
      e?.message || e,
    );
  }
}
