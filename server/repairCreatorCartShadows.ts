import { and, eq } from "drizzle-orm";
import { shadowDesignIdForCart } from "@shared/shadowDesignId";
import { publishedProducts } from "@shared/schema";
import { db } from "./db";
import { storage } from "./storage";
import {
  getCreatorCart,
  replaceCreatorCartLine,
  type CreatorCartResult,
} from "./shopify-storefront";
import { ensureVariantPublishedForStorefrontApi } from "./shopify-publications";

function numericId(value: string | null | undefined): string {
  return String(value || "").replace(/\D/g, "");
}

async function findPublishedByVariant(shop: string, variantId: string) {
  const numeric = numericId(variantId);
  if (!numeric) return undefined;
  const [row] = await db
    .select()
    .from(publishedProducts)
    .where(
      and(
        eq(publishedProducts.shop, shop),
        eq(publishedProducts.shopifyVariantId, numeric),
      ),
    )
    .limit(1);
  return row;
}

async function resolveShadowVariant(opts: {
  shop: string;
  accessToken: string;
  baseVariantId: string;
  designId: string;
  mockupUrl: string;
}): Promise<string | null> {
  const { shop, accessToken, designId, mockupUrl } = opts;
  const baseVariantId = numericId(opts.baseVariantId);
  if (!baseVariantId || !mockupUrl.startsWith("https://")) return null;

  const existing = await storage.getPublishedProduct(shop, designId);
  if (existing?.status === "active" && existing.shopifyVariantId) {
    const apiBase = `https://${shop}/admin/api/2025-10`;
    await fetch(`${apiBase}/products/${existing.shopifyProductId}/images.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        image: {
          src: mockupUrl,
          variant_ids: [Number(existing.shopifyVariantId)],
        },
      }),
    }).catch(() => {});
    await ensureVariantPublishedForStorefrontApi(
      shop,
      accessToken,
      existing.shopifyVariantId,
    );
    return existing.shopifyVariantId;
  }

  const apiBase = `https://${shop}/admin/api/2025-10`;
  const headers = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": accessToken,
  };
  const variantRes = await fetch(`${apiBase}/variants/${baseVariantId}.json`, { headers });
  if (!variantRes.ok) return null;
  const { variant: baseVariant } = (await variantRes.json()) as {
    variant?: {
      id?: number;
      product_id?: number;
      price?: string;
      compare_at_price?: string | null;
      taxable?: boolean;
      requires_shipping?: boolean;
      weight?: number;
      weight_unit?: string;
      option1?: string;
      option2?: string;
      option3?: string;
    };
  };
  if (!baseVariant?.id || !baseVariant.product_id) return null;

  let title = "Custom Design";
  try {
    const productRes = await fetch(`${apiBase}/products/${baseVariant.product_id}.json`, {
      headers,
    });
    if (productRes.ok) {
      const { product } = (await productRes.json()) as { product?: { title?: string } };
      if (product?.title) title = product.title;
    }
  } catch {
    /* keep default title */
  }
  const optionParts = [baseVariant.option1, baseVariant.option2, baseVariant.option3]
    .filter((o) => o && o !== "Default Title" && o !== "base")
    .join(" / ");
  const shadowTitle = optionParts ? `${title} — ${optionParts}` : title;

  const createRes = await fetch(`${apiBase}/products.json`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      product: {
        title: shadowTitle,
        status: "unlisted",
        published: false,
        tags: "appai-shadow",
        variants: [
          {
            price: baseVariant.price,
            compare_at_price: baseVariant.compare_at_price || null,
            taxable: baseVariant.taxable,
            requires_shipping: baseVariant.requires_shipping,
            weight: baseVariant.weight,
            weight_unit: baseVariant.weight_unit,
            inventory_management: null,
            inventory_policy: "continue",
            fulfillment_service: "manual",
          },
        ],
        images: [{ src: mockupUrl }],
      },
    }),
  });
  if (!createRes.ok) {
    const t = await createRes.text();
    console.warn("[CreatorCartRepair] shadow create failed:", createRes.status, t.slice(0, 200));
    return null;
  }
  const { product: shadowProduct } = (await createRes.json()) as {
    product?: {
      id?: number;
      handle?: string;
      variants?: Array<{ id?: number }>;
      images?: Array<{ id?: number }>;
    };
  };
  const shadowVariantId = shadowProduct?.variants?.[0]?.id
    ? String(shadowProduct.variants[0].id)
    : "";
  if (!shadowProduct?.id || !shadowVariantId) return null;

  if (shadowProduct.images?.[0]?.id) {
    await fetch(
      `${apiBase}/products/${shadowProduct.id}/images/${shadowProduct.images[0].id}.json`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({
          image: { id: shadowProduct.images[0].id, variant_ids: [Number(shadowVariantId)] },
        }),
      },
    ).catch(() => {});
  }

  await storage.createPublishedProduct({
    shop,
    designId,
    customerKey: null,
    shopifyProductId: String(shadowProduct.id),
    shopifyVariantId: shadowVariantId,
    shopifyProductHandle: shadowProduct.handle || null,
    baseVariantId,
    status: "active",
    expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
    cartAddedAt: null,
  } as any);
  await ensureVariantPublishedForStorefrontApi(shop, accessToken, shadowVariantId);
  return shadowVariantId;
}

/** Give each cart line with a unique mockup its own checkout variant. */
export async function repairCreatorCartShadowVariants(opts: {
  shop: string;
  accessToken: string;
  cartId: string;
}): Promise<CreatorCartResult | null> {
  let cart = await getCreatorCart(opts.cartId);
  if (!cart) return null;

  const snapshot = [...cart.lines];
  const seenVariant = new Map<string, string>();
  for (const line of snapshot) {
    const mockup = line.mockupUrl;
    if (!mockup || !mockup.startsWith("https://")) continue;

    let baseVariantId = line.baseVariantId;
    if (!baseVariantId && line.merchandiseId) {
      const published = await findPublishedByVariant(opts.shop, line.merchandiseId);
      baseVariantId = published?.baseVariantId || null;
    }
    if (!baseVariantId) continue;

    let designId = shadowDesignIdForCart(line.jobId || line.id, mockup);
    let nextVariantId = await resolveShadowVariant({
      shop: opts.shop,
      accessToken: opts.accessToken,
      baseVariantId,
      designId,
      mockupUrl: mockup,
    });
    if (!nextVariantId) continue;

    const alreadyUsedBy = seenVariant.get(numericId(nextVariantId));
    if (alreadyUsedBy && alreadyUsedBy !== mockup) {
      designId = shadowDesignIdForCart(line.id, mockup);
      nextVariantId = await resolveShadowVariant({
        shop: opts.shop,
        accessToken: opts.accessToken,
        baseVariantId,
        designId,
        mockupUrl: mockup,
      });
      if (!nextVariantId) continue;
    }
    seenVariant.set(numericId(nextVariantId), mockup);

    const current = numericId(line.merchandiseId);
    if (current && current === numericId(nextVariantId)) continue;
    cart = await replaceCreatorCartLine({
      cartId: cart.cartId,
      lineId: line.id,
      variantId: nextVariantId,
      quantity: line.quantity,
      attributes: line.attributes,
    });
  }

  return cart;
}
