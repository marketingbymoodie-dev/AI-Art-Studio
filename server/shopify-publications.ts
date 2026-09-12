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

export function isOnlineStorePublication(name: string): boolean {
  return String(name || "").trim().toLowerCase() === "online store";
}

export class ShadowNotOnStorefrontError extends Error {
  readonly code = "shadow_not_on_storefront" as const;
  constructor(
    message: string,
    readonly productId: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ShadowNotOnStorefrontError";
  }
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

async function restPublishProduct(
  shop: string,
  accessToken: string,
  productId: string,
): Promise<void> {
  const res = await fetch(`https://${shop}/admin/api/2025-10/products/${productId}.json`, {
    method: "PUT",
    headers: adminHeaders(accessToken),
    body: JSON.stringify({ product: { id: Number(productId), published: true } }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new ShadowNotOnStorefrontError(
      `REST published:true failed HTTP ${res.status}`,
      productId,
      t.slice(0, 240),
    );
  }
}

async function readOnlineStorePublication(
  shop: string,
  accessToken: string,
): Promise<PublicationNode> {
  const pubData = await adminGraphql<{
    publications: { edges: Array<{ node: PublicationNode }> };
  }>(shop, accessToken, `{ publications(first: 50) { edges { node { id name } } } }`);
  const nodes = (pubData.publications?.edges || []).map((e) => e.node);
  const onlineStore = nodes.find((n) => isOnlineStorePublication(n.name));
  if (!onlineStore) {
    throw new ShadowNotOnStorefrontError("Shop has no Online Store publication", "unknown", nodes);
  }
  return onlineStore;
}

/**
 * Publish to checkout channels and ASSERT the product is on Online Store.
 * GraphQL publishablePublish is primary; REST published:true is the fallback
 * the old ensureProductPublishedToOnlineStore docstring promised but never ran.
 */
export async function ensureProductOnOnlineStore(opts: {
  shop: string;
  accessToken: string;
  productId: string | number;
}): Promise<{ published: string[] }> {
  const productId = String(opts.productId || "").replace(/\D/g, "");
  if (!productId) {
    throw new ShadowNotOnStorefrontError("Shadow publish skipped — missing productId", "unknown");
  }
  const productGid = `gid://shopify/Product/${productId}`;
  const published = await publishProductToCheckoutChannels(opts.shop, opts.accessToken, productId);

  const checkPublished = async () => {
    const onlineStore = await readOnlineStorePublication(opts.shop, opts.accessToken);
    return adminGraphql<{
      product: { publishedOnPublication: boolean; status: string } | null;
    }>(
      opts.shop,
      opts.accessToken,
      `query($id: ID!, $pub: ID!) {
        product(id: $id) {
          status
          publishedOnPublication(publicationId: $pub)
        }
      }`,
      { id: productGid, pub: onlineStore.id },
    );
  };

  let check = await checkPublished();
  if (!check.product?.publishedOnPublication) {
    console.warn(
      `[shopify-publications] GraphQL publish did not land for ${productId} — REST published:true fallback`,
    );
    await restPublishProduct(opts.shop, opts.accessToken, productId);
    await publishProductToCheckoutChannels(opts.shop, opts.accessToken, productId);
    check = await checkPublished();
  }
  if (!check.product?.publishedOnPublication) {
    throw new ShadowNotOnStorefrontError(
      `Shadow product ${productId} is not on the Online Store channel (status=${check.product?.status || "unknown"})`,
      productId,
      check,
    );
  }
  console.log(
    `[shopify-publications] Online Store confirmed for product ${productId} status=${check.product.status}`,
  );
  return { published: published.published };
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
