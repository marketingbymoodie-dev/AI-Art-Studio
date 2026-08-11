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

export type CreatorCartResult = {
  cartId: string;
  checkoutUrl: string;
};

/**
 * Create a cart with one line (shadow or base variant) and return checkout URL.
 */
export async function createCreatorCheckoutCart(params: {
  variantId: string;
  quantity?: number;
  attributes?: CartLineAttribute[];
}): Promise<CreatorCartResult> {
  const merchandiseId = toVariantGid(params.variantId);
  const quantity = Math.max(1, Math.min(99, params.quantity ?? 1));
  const attributes = (params.attributes || [])
    .filter((a) => a.key && a.value != null)
    .map((a) => ({ key: String(a.key).slice(0, 100), value: String(a.value).slice(0, 255) }));

  const data = await storefrontGraphql<{
    cartCreate: {
      cart: { id: string; checkoutUrl: string } | null;
      userErrors: Array<{ field?: string[]; message: string }>;
    };
  }>(
    `mutation CreatorCartCreate($input: CartInput!) {
      cartCreate(input: $input) {
        cart { id checkoutUrl }
        userErrors { field message }
      }
    }`,
    {
      input: {
        lines: [
          {
            merchandiseId,
            quantity,
            attributes,
          },
        ],
      },
    },
  );

  const errs = data.cartCreate?.userErrors || [];
  if (errs.length) {
    throw new Error(errs.map((e) => e.message).join("; "));
  }
  const cart = data.cartCreate?.cart;
  if (!cart?.id || !cart.checkoutUrl) {
    throw new Error("Storefront cartCreate did not return a checkout URL");
  }
  return { cartId: cart.id, checkoutUrl: cart.checkoutUrl };
}
