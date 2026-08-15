/**
 * Shopify Storefront API client for Creator Marketplace carts/checkouts.
 * Uses CREATOR_STOREFRONT_API_TOKEN (or legacy CREATOR_PLATFORM_STOREFRONT_TOKEN)
 * on CREATOR_PLATFORM_SHOP_DOMAIN.
 */
import {
  getCreatorPlatformShopDomain,
  getCreatorPlatformStorefrontToken,
} from "./creator-config";

const STOREFRONT_API_VERSION = "2025-01";

type GqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

export function isCreatorStorefrontConfigured(): boolean {
  return !!(getCreatorPlatformShopDomain() && getCreatorPlatformStorefrontToken());
}

async function storefrontGraphql<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const shop = getCreatorPlatformShopDomain();
  const token = getCreatorPlatformStorefrontToken();
  if (!shop || !token) {
    throw new Error(
      "Creator Storefront API is not configured (CREATOR_PLATFORM_SHOP_DOMAIN + CREATOR_STOREFRONT_API_TOKEN).",
    );
  }

  const url = `https://${shop}/api/${STOREFRONT_API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Storefront API HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as GqlResponse<T>;
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  if (!json.data) {
    throw new Error("Storefront API returned no data");
  }
  return json.data;
}

function toVariantGid(variantId: string): string {
  const raw = String(variantId || "").trim();
  if (raw.startsWith("gid://")) return raw;
  const digits = raw.replace(/\D/g, "");
  if (!digits) throw new Error("Invalid variant id");
  return `gid://shopify/ProductVariant/${digits}`;
}

export type CartLineAttribute = { key: string; value: string };

export type CreatorCartLine = {
  id: string;
  quantity: number;
  title: string;
  imageUrl: string | null;
  merchandiseId: string | null;
  mockupUrl: string | null;
  jobId: string | null;
  baseVariantId: string | null;
  attributes: CartLineAttribute[];
};

export type CreatorCartResult = {
  cartId: string;
  checkoutUrl: string;
  shopCartUrl: string | null;
  itemCount: number;
  lines: CreatorCartLine[];
};

export function storefrontCartStoreUrl(shop: string, cartGid: string): string | null {
  const token = decodeURIComponent(String(cartGid || "")).split("/Cart/")[1]?.trim();
  const host = String(shop || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!token || !host) return null;
  return `https://${host}/cart/c/${token}`;
}

type StorefrontCartNode = {
  id: string;
  checkoutUrl: string;
  totalQuantity?: number | null;
  lines?: {
    nodes?: Array<{
      id: string;
      quantity: number;
      attributes?: Array<{ key: string; value: string }>;
      merchandise?: {
        id?: string;
        title?: string;
        image?: { url?: string } | null;
        product?: { title?: string; featuredImage?: { url?: string } | null };
      } | null;
    }>;
  } | null;
};

const CART_FIELDS = `
  id
  checkoutUrl
  totalQuantity
  lines(first: 50) {
    nodes {
      id
      quantity
      attributes { key value }
      merchandise {
        ... on ProductVariant {
          id
          title
          image { url }
          product { title featuredImage { url } }
        }
      }
    }
  }
`;

function mapCreatorCart(cart: StorefrontCartNode | null | undefined): CreatorCartResult | null {
  if (!cart?.id || !cart.checkoutUrl) return null;
  const nodes = cart.lines?.nodes || [];
  const lines: CreatorCartLine[] = nodes.map((node) => {
    const attrs = node.attributes || [];
    const mockup = attrs.find((a) => a.key === "_mockup_url")?.value || null;
    const merch = node.merchandise;
    const title =
      merch?.product?.title ||
      merch?.title ||
      attrs.find((a) => a.key === "Artwork")?.value ||
      "Custom design";
    const imageUrl =
      mockup ||
      merch?.image?.url ||
      merch?.product?.featuredImage?.url ||
      null;
    return {
      id: node.id,
      quantity: node.quantity,
      title,
      imageUrl,
      merchandiseId: merch?.id || null,
      mockupUrl: mockup,
      jobId: attrs.find((a) => a.key === "_appai_job_id")?.value || null,
      baseVariantId: attrs.find((a) => a.key === "_base_variant_id")?.value || null,
      attributes: attrs.map((a) => ({ key: a.key, value: a.value })),
    };
  });
  const itemCount =
    typeof cart.totalQuantity === "number"
      ? cart.totalQuantity
      : lines.reduce((sum, line) => sum + (line.quantity || 0), 0);
  return {
    cartId: cart.id,
    checkoutUrl: cart.checkoutUrl,
    shopCartUrl: storefrontCartStoreUrl(getCreatorPlatformShopDomain(), cart.id),
    itemCount,
    lines,
  };
}

function lineInput(params: {
  variantId: string;
  quantity?: number;
  attributes?: CartLineAttribute[];
}) {
  const merchandiseId = toVariantGid(params.variantId);
  const quantity = Math.max(1, Math.min(99, params.quantity ?? 1));
  const attributes = (params.attributes || [])
    .filter((a) => a.key && a.value != null)
    .map((a) => ({ key: String(a.key).slice(0, 100), value: String(a.value).slice(0, 255) }));
  return { merchandiseId, quantity, attributes };
}

/**
 * Create a cart with one line (shadow or base variant) and return checkout URL.
 */
export async function createCreatorCheckoutCart(params: {
  variantId: string;
  quantity?: number;
  attributes?: CartLineAttribute[];
  cartAttributes?: CartLineAttribute[];
}): Promise<CreatorCartResult> {
  const data = await storefrontGraphql<{
    cartCreate: {
      cart: StorefrontCartNode | null;
      userErrors: Array<{ field?: string[]; message: string }>;
    };
  }>(
    `mutation CreatorCartCreate($input: CartInput!) {
      cartCreate(input: $input) {
        cart { ${CART_FIELDS} }
        userErrors { field message }
      }
    }`,
    {
      input: {
        lines: [lineInput(params)],
        attributes: (params.cartAttributes || [])
          .filter((a) => a.key && a.value != null)
          .map((a) => ({
            key: String(a.key).slice(0, 100),
            value: String(a.value).slice(0, 255),
          })),
      },
    },
  );

  const errs = data.cartCreate?.userErrors || [];
  if (errs.length) {
    throw new Error(errs.map((e) => e.message).join("; "));
  }
  const mapped = mapCreatorCart(data.cartCreate?.cart);
  if (!mapped) {
    throw new Error("Storefront cartCreate did not return a checkout URL");
  }
  return mapped;
}

export async function getCreatorCart(cartId: string): Promise<CreatorCartResult | null> {
  const id = String(cartId || "").trim();
  if (!id) return null;
  const data = await storefrontGraphql<{ cart: StorefrontCartNode | null }>(
    `query CreatorCart($id: ID!) {
      cart(id: $id) { ${CART_FIELDS} }
    }`,
    { id },
  );
  return mapCreatorCart(data.cart);
}

export async function updateCreatorCartAttributes(params: {
  cartId: string;
  attributes: CartLineAttribute[];
}): Promise<void> {
  const attributes = (params.attributes || [])
    .filter((a) => a.key && a.value != null)
    .map((a) => ({
      key: String(a.key).slice(0, 100),
      value: String(a.value).slice(0, 255),
    }));
  if (!params.cartId || attributes.length === 0) return;
  const data = await storefrontGraphql<{
    cartAttributesUpdate: {
      userErrors: Array<{ field?: string[]; message: string }>;
    };
  }>(
    `mutation CreatorCartAttributesUpdate($cartId: ID!, $attributes: [AttributeInput!]!) {
      cartAttributesUpdate(cartId: $cartId, attributes: $attributes) {
        userErrors { field message }
      }
    }`,
    { cartId: params.cartId, attributes },
  );
  const errs = data.cartAttributesUpdate?.userErrors || [];
  if (errs.length) {
    throw new Error(errs.map((e) => e.message).join("; "));
  }
}

export async function addLinesToCreatorCart(params: {
  cartId: string;
  variantId: string;
  quantity?: number;
  attributes?: CartLineAttribute[];
  cartAttributes?: CartLineAttribute[];
}): Promise<CreatorCartResult> {
  const data = await storefrontGraphql<{
    cartLinesAdd: {
      cart: StorefrontCartNode | null;
      userErrors: Array<{ field?: string[]; message: string }>;
    };
  }>(
    `mutation CreatorCartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
      cartLinesAdd(cartId: $cartId, lines: $lines) {
        cart { ${CART_FIELDS} }
        userErrors { field message }
      }
    }`,
    {
      cartId: params.cartId,
      lines: [lineInput(params)],
    },
  );

  const errs = data.cartLinesAdd?.userErrors || [];
  if (errs.length) {
    throw new Error(errs.map((e) => e.message).join("; "));
  }
  const mapped = mapCreatorCart(data.cartLinesAdd?.cart);
  if (!mapped) {
    throw new Error("Storefront cartLinesAdd did not return a cart");
  }
  if (params.cartAttributes?.length) {
    try {
      await updateCreatorCartAttributes({
        cartId: mapped.cartId,
        attributes: params.cartAttributes,
      });
    } catch (attrErr: any) {
      console.warn(
        "[creators] cartAttributesUpdate after lines add failed:",
        attrErr?.message || attrErr,
      );
    }
  }
  return mapped;
}

/** Storefront carts often cannot change a line's variant in place — add the new SKU, then drop the old line. */
export async function replaceCreatorCartLine(params: {
  cartId: string;
  lineId: string;
  variantId: string;
  quantity?: number;
  attributes?: CartLineAttribute[];
}): Promise<CreatorCartResult> {
  const added = await addLinesToCreatorCart({
    cartId: params.cartId,
    variantId: params.variantId,
    quantity: params.quantity,
    attributes: params.attributes,
  });
  return removeCreatorCartLines({
    cartId: added.cartId,
    lineIds: [params.lineId],
  });
}

export function isCreatorCartLineId(lineId: string): boolean {
  return String(lineId || "").startsWith("gid://shopify/CartLine/");
}

export async function updateCreatorCartLineMerchandise(params: {
  cartId: string;
  lineId: string;
  variantId: string;
}): Promise<CreatorCartResult> {
  const data = await storefrontGraphql<{
    cartLinesUpdate: {
      cart: StorefrontCartNode | null;
      userErrors: Array<{ field?: string[]; message: string }>;
    };
  }>(
    `mutation CreatorCartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
      cartLinesUpdate(cartId: $cartId, lines: $lines) {
        cart { ${CART_FIELDS} }
        userErrors { field message }
      }
    }`,
    {
      cartId: params.cartId,
      lines: [{ id: params.lineId, merchandiseId: toVariantGid(params.variantId) }],
    },
  );
  const errs = data.cartLinesUpdate?.userErrors || [];
  if (errs.length) {
    throw new Error(errs.map((e) => e.message).join("; "));
  }
  const mapped = mapCreatorCart(data.cartLinesUpdate?.cart);
  if (!mapped) {
    throw new Error("Storefront cartLinesUpdate did not return a cart");
  }
  return mapped;
}

export async function updateCreatorCartLine(params: {
  cartId: string;
  lineId: string;
  quantity: number;
}): Promise<CreatorCartResult> {
  const n = Math.floor(Number(params.quantity));
  const quantity = Number.isFinite(n) ? Math.max(0, Math.min(99, n)) : 0;
  if (quantity <= 0) {
    return removeCreatorCartLines({ cartId: params.cartId, lineIds: [params.lineId] });
  }
  const data = await storefrontGraphql<{
    cartLinesUpdate: {
      cart: StorefrontCartNode | null;
      userErrors: Array<{ field?: string[]; message: string }>;
    };
  }>(
    `mutation CreatorCartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
      cartLinesUpdate(cartId: $cartId, lines: $lines) {
        cart { ${CART_FIELDS} }
        userErrors { field message }
      }
    }`,
    {
      cartId: params.cartId,
      lines: [{ id: params.lineId, quantity }],
    },
  );
  const errs = data.cartLinesUpdate?.userErrors || [];
  if (errs.length) {
    throw new Error(errs.map((e) => e.message).join("; "));
  }
  const mapped = mapCreatorCart(data.cartLinesUpdate?.cart);
  if (!mapped) {
    throw new Error("Storefront cartLinesUpdate did not return a cart");
  }
  return mapped;
}

export async function removeCreatorCartLines(params: {
  cartId: string;
  lineIds: string[];
}): Promise<CreatorCartResult> {
  const lineIds = params.lineIds.filter((id) => isCreatorCartLineId(id));
  if (lineIds.length === 0) {
    throw new Error("A valid cart line is required.");
  }
  const data = await storefrontGraphql<{
    cartLinesRemove: {
      cart: StorefrontCartNode | null;
      userErrors: Array<{ field?: string[]; message: string }>;
    };
  }>(
    `mutation CreatorCartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
      cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
        cart { ${CART_FIELDS} }
        userErrors { field message }
      }
    }`,
    { cartId: params.cartId, lineIds },
  );
  const errs = data.cartLinesRemove?.userErrors || [];
  if (errs.length) {
    throw new Error(errs.map((e) => e.message).join("; "));
  }
  const mapped = mapCreatorCart(data.cartLinesRemove?.cart);
  if (!mapped) {
    throw new Error("Storefront cartLinesRemove did not return a cart");
  }
  return mapped;
}
