/**
 * Shopify sales-channel helpers for cart / Storefront API visibility.
 *
 * Theme `/cart/add.js` only needs Online Store. Creator checkout uses a
 * custom-app Storefront API token, which sees a *different* publication
 * (often named after the app, e.g. "AI Art Studio (Staging)").
 * Unpublishing that channel makes cartCreate return
 * "The merchandise with id gid://shopify/ProductVariant/… does not exist."
 */

export type PublicationNode = { id: string; name: string };

export function isPosPublication(name: string): boolean {
  const n = String(name || "").toLowerCase();
  return /point of sale|\bpos\b/.test(n);
}

/** Channels the Storefront API / checkout must be able to see. */
export function isCheckoutPublication(name: string): boolean {
  return !isPosPublication(name);
}

export function partitionPublications(publications: PublicationNode[]): {
  checkout: PublicationNode[];
  pos: PublicationNode[];
} {
  const checkout: PublicationNode[] = [];
  const pos: PublicationNode[] = [];
  for (const pub of publications) {
    if (isCheckoutPublication(pub.name)) checkout.push(pub);
    else pos.push(pub);
  }
  return { checkout, pos };
}

export function isMerchandiseMissingError(message: string): boolean {
  return /merchandise with id .* does not exist/i.test(String(message || ""));
}

export function creatorMerchandiseMissingMessage(): string {
  return "This product is not available for checkout yet. Please try Add to cart again in a moment.";
}

function adminHeaders(accessToken: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": accessToken,
  };
}

async function adminGraphql<T>(
  shop: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: adminHeaders(accessToken),
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (!res.ok) {
    throw new Error(`Admin GraphQL HTTP ${res.status}`);
  }
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  if (!json.data) throw new Error("Admin GraphQL returned no data");
  return json.data;
}

/**
 * Publish a product to Online Store + Storefront API / custom-app channels.
 * Only unpublish from Point of Sale so shadows stay hidden from POS.
 */
export async function publishProductToCheckoutChannels(
  shop: string,
  accessToken: string,
  productId: string | number,
): Promise<{ published: string[]; unpublished: string[] }> {
  const productGid = `gid://shopify/Product/${String(productId).replace(/\D/g, "")}`;
  const pubData = await adminGraphql<{
    publications: { edges: Array<{ node: PublicationNode }> };
  }>(shop, accessToken, `{ publications(first: 50) { edges { node { id name } } } }`);

  const nodes = (pubData.publications?.edges || []).map((e) => e.node);
  const { checkout, pos } = partitionPublications(nodes);
  const published: string[] = [];
  const unpublished: string[] = [];

  if (checkout.length > 0) {
    const result = await adminGraphql<{
      publishablePublish: { userErrors: Array<{ message: string }> };
    }>(
      shop,
      accessToken,
      `mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          userErrors { message }
        }
      }`,
      {
        id: productGid,
        input: checkout.map((c) => ({ publicationId: c.id })),
      },
    );
    const errs = result.publishablePublish?.userErrors || [];
    if (errs.length && !errs.some((e) => /already/i.test(e.message))) {
      console.warn(
        `[shopify-publications] publish userErrors for ${productId}:`,
        errs.map((e) => e.message).join("; "),
      );
    } else {
      published.push(...checkout.map((c) => c.name));
    }
  }

  for (const channel of pos) {
    try {
      await adminGraphql(
        shop,
        accessToken,
        `mutation publishableUnpublish($id: ID!, $input: [PublicationInput!]!) {
          publishableUnpublish(id: $id, input: $input) {
            userErrors { message }
          }
        }`,
        { id: productGid, input: [{ publicationId: channel.id }] },
      );
      unpublished.push(channel.name);
    } catch (e: any) {
      console.warn(
        `[shopify-publications] unpublish ${channel.name} failed:`,
        e?.message || e,
      );
    }
  }

  return { published, unpublished };
}

/** Look up a variant's product and publish it to checkout / Storefront API channels. */
export async function ensureVariantPublishedForStorefrontApi(
  shop: string,
  accessToken: string,
  variantId: string,
): Promise<{ productId: string | null; ok: boolean }> {
  const numeric = String(variantId || "").replace(/\D/g, "");
  if (!numeric) return { productId: null, ok: false };
  const res = await fetch(`https://${shop}/admin/api/2025-10/variants/${numeric}.json`, {
    headers: adminHeaders(accessToken),
  });
  if (!res.ok) {
    console.warn(
      `[shopify-publications] variant ${numeric} lookup ${res.status} on ${shop}`,
    );
    return { productId: null, ok: false };
  }
  const json = (await res.json()) as { variant?: { product_id?: number | string } };
  const productId = json.variant?.product_id ? String(json.variant.product_id) : null;
  if (!productId) return { productId: null, ok: false };
  await publishProductToCheckoutChannels(shop, accessToken, productId);
  return { productId, ok: true };
}
