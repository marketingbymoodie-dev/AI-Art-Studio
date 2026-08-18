/**
 * Merchant-sold Studio Credit packs.
 * Customer pays the merchant store; credits are pack-funded (no plan quota).
 * Wholesale is billed to the merchant via Shopify usage charges when available.
 */
import { eq, inArray, like } from "drizzle-orm";
import {
  CREDIT_PACK_CATALOG,
  STUDIO_CREDIT_WHOLESALE_CENTS,
  getCreditPackDefinition,
  type CreditPackDefinition,
} from "@shared/storefront-credits";
import { merchantPackPurchases, merchantPackVariants } from "@shared/schema";
import { db } from "./db";
import { clawbackStudioCredits, grantStudioCredits } from "./studio-credits";
import { normalizeShopifyOrderLine } from "./flat-order-fulfillment";
import { storage } from "./storage";
import { emitOverageUsageCharge } from "./usage-billing";
import { getCreatorPlatformShopDomain } from "./creator-config";
import { normalizeMyshopifyShopDomain } from "./shopDomain";

const PACK_SKU_PREFIX = "studio-pack-";
const LEGACY_PACK_SKU_PREFIX = "appai-pack-";

export function isMerchantCreditPackLine(
  props: Record<string, string>,
  sku?: string | null,
): boolean {
  if (props._credit_pack_id) return true;
  const s = String(sku || "");
  return s.startsWith(PACK_SKU_PREFIX) || s.startsWith(LEGACY_PACK_SKU_PREFIX);
}

function normalizeShop(shop: string | null | undefined): string {
  return normalizeMyshopifyShopDomain(shop);
}

function isPlatformShop(shop: string): boolean {
  const platform = normalizeShop(getCreatorPlatformShopDomain());
  if (!platform) return false;
  const s = normalizeShop(shop);
  return s === platform || s === platform.replace(/\.myshopify\.com$/, "");
}

async function resolveInstallation(shop: string) {
  const installation = await storage.getShopifyInstallationByShop(shop);
  if (installation?.status === "active" && installation.accessToken) return installation;
  return null;
}

async function adminGraphql<T>(
  shop: string,
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`Admin GraphQL HTTP ${res.status}`);
  }
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  return json.data as T;
}

async function findVariantIdBySku(
  shop: string,
  token: string,
  sku: string,
): Promise<{ variantId: string; productId: string } | null> {
  const data = await adminGraphql<{
    productVariants: {
      edges: Array<{
        node: { id: string; sku: string | null; product: { id: string } };
      }>;
    };
  }>(
    shop,
    token,
    `query PackVariantBySku($q: String!) {
      productVariants(first: 5, query: $q) {
        edges { node { id sku product { id } } }
      }
    }`,
    { q: `sku:${sku}` },
  );
  const edge = (data.productVariants?.edges || []).find(
    (e) => String(e.node.sku || "") === sku,
  );
  if (!edge) return null;
  const variantId = String(edge.node.id).replace(/\D/g, "");
  const productId = String(edge.node.product.id).replace(/\D/g, "");
  if (!variantId) return null;
  return { variantId, productId };
}

async function publishProductToOnlineStore(
  shop: string,
  accessToken: string,
  productGid: string,
): Promise<void> {
  const pubData = await adminGraphql<{
    publications: { edges: Array<{ node: { id: string; name: string } }> };
  }>(shop, accessToken, `{ publications(first: 20) { edges { node { id name } } } }`);
  const onlineStore = (pubData?.publications?.edges || []).find((e) =>
    /online store/i.test(e.node.name),
  );
  if (!onlineStore) return;
  await adminGraphql(
    shop,
    accessToken,
    `
    mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        userErrors { message }
      }
    }
  `,
    {
      id: productGid,
      input: [{ publicationId: onlineStore.node.id }],
    },
  );
}

async function cachedVariant(
  shop: string,
  packId: string,
): Promise<{ variantId: string; productId: string | null } | null> {
  const rows = await db
    .select()
    .from(merchantPackVariants)
    .where(eq(merchantPackVariants.shopDomain, shop));
  const match = rows.find((r) => r.packId === packId);
  if (!match?.variantId) return null;
  return { variantId: match.variantId, productId: match.productId };
}

async function saveVariant(
  shop: string,
  packId: string,
  variantId: string,
  productId: string | null,
): Promise<void> {
  const existing = (
    await db
      .select()
      .from(merchantPackVariants)
      .where(eq(merchantPackVariants.shopDomain, shop))
  ).find((r) => r.packId === packId);
  if (existing) {
    await db
      .update(merchantPackVariants)
      .set({ variantId, productId, updatedAt: new Date() })
      .where(eq(merchantPackVariants.id, existing.id));
    return;
  }
  await db.insert(merchantPackVariants).values({
    shopDomain: shop,
    packId,
    variantId,
    productId,
  });
}

export async function ensureMerchantPackVariants(shopRaw: string): Promise<
  Array<CreditPackDefinition & { variantId: string }>
> {
  const shop = normalizeShop(shopRaw);
  if (!shop) throw new Error("Shop is required");
  if (isPlatformShop(shop)) {
    throw new Error("Use creator pack checkout on the platform shop");
  }

  const installation = await resolveInstallation(shop);
  if (!installation?.accessToken) {
    throw new Error("This shop is not authorized — reconnect Shopify");
  }
  const token = installation.accessToken;
  const out: Array<CreditPackDefinition & { variantId: string }> = [];

  for (const pack of CREDIT_PACK_CATALOG) {
    const cached = await cachedVariant(shop, pack.packId);
    if (cached?.variantId) {
      out.push({ ...pack, variantId: cached.variantId });
      continue;
    }

    const sku = `${PACK_SKU_PREFIX}${pack.packId}`;
    const existing = await findVariantIdBySku(shop, token, sku).catch(() => null);
    if (existing?.variantId) {
      await saveVariant(shop, pack.packId, existing.variantId, existing.productId);
      out.push({ ...pack, variantId: existing.variantId });
      continue;
    }

    const price = (pack.priceInCents / 100).toFixed(2);
    const createRes = await fetch(`https://${shop}/admin/api/2025-10/products.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({
        product: {
          title: pack.label,
          status: "active",
          published: true,
          vendor: "AI Art Studio",
          product_type: "Credit Pack",
          tags: "studio-credit-pack",
          variants: [
            {
              price,
              sku,
              inventory_management: null,
              inventory_policy: "continue",
              requires_shipping: false,
              taxable: true,
            },
          ],
        },
      }),
    });
    if (!createRes.ok) {
      const t = await createRes.text();
      throw new Error(`Failed to create pack product ${pack.packId}: ${t.slice(0, 200)}`);
    }
    const { product } = await createRes.json();
    const vid = String(product?.variants?.[0]?.id || "").replace(/\D/g, "");
    const pid = product?.id != null ? String(product.id) : null;
    const productGid =
      product?.admin_graphql_api_id ||
      (pid ? `gid://shopify/Product/${pid}` : "");
    if (!vid) throw new Error(`Pack product ${pack.packId} created without variant`);
    await saveVariant(shop, pack.packId, vid, pid);
    if (productGid) {
      await publishProductToOnlineStore(shop, token, productGid).catch((e) =>
        console.warn("[merchant-packs] publish failed:", e?.message || e),
      );
    }
    out.push({ ...pack, variantId: vid });
  }
  return out;
}

export async function listMerchantPacksForSale(shopRaw: string): Promise<
  Array<CreditPackDefinition & { variantReady: boolean }>
> {
  const shop = normalizeShop(shopRaw);
  const cached = shop
    ? await db.select().from(merchantPackVariants).where(eq(merchantPackVariants.shopDomain, shop))
    : [];
  return CREDIT_PACK_CATALOG.map((pack) => ({
    ...pack,
    variantReady: cached.some((r) => r.packId === pack.packId && r.variantId),
  }));
}

export async function createMerchantPackCheckout(params: {
  shop: string;
  packId: string;
  customerId: string;
}): Promise<{ checkoutUrl: string; pack: CreditPackDefinition }> {
  const shop = normalizeShop(params.shop);
  if (!shop) throw new Error("Shop is required");
  if (!params.customerId?.trim()) throw new Error("customerId is required");
  const pack = getCreditPackDefinition(params.packId);
  if (!pack) throw new Error("Unknown credit pack");

  const variants = await ensureMerchantPackVariants(shop);
  const matched = variants.find((v) => v.packId === pack.packId);
  if (!matched?.variantId) throw new Error("Pack variant is not available");

  const props = new URLSearchParams({
    checkout: "",
    "properties[_credit_pack_id]": pack.packId,
    "properties[_appai_customer_id]": params.customerId,
    "properties[_appai_pack_credits]": String(pack.credits),
  });
  const checkoutUrl = `https://${shop}/cart/${matched.variantId}:1?${props.toString()}`;
  return { checkoutUrl, pack };
}

function orderIdKey(order: any): string {
  if (order?.admin_graphql_api_id) return String(order.admin_graphql_api_id);
  if (order?.id != null) return String(order.id);
  return "";
}

export async function grantMerchantPacksFromPaidOrder(
  shopRaw: string,
  order: any,
): Promise<{ granted: number }> {
  const shop = normalizeShop(shopRaw);
  if (!shop || isPlatformShop(shop)) return { granted: 0 };
  if (!Array.isArray(order?.line_items)) return { granted: 0 };

  const orderKey = orderIdKey(order);
  if (!orderKey) return { granted: 0 };

  const installation = await resolveInstallation(shop);
  let granted = 0;

  for (const raw of order.line_items) {
    const line = normalizeShopifyOrderLine(raw);
    const props = line.properties;
    const packId = props._credit_pack_id || "";
    const pack = getCreditPackDefinition(packId);
    const sku = String(raw.sku || "");
    const packFromSku = sku.startsWith(PACK_SKU_PREFIX)
      ? getCreditPackDefinition(sku.slice(PACK_SKU_PREFIX.length))
      : sku.startsWith(LEGACY_PACK_SKU_PREFIX)
        ? getCreditPackDefinition(sku.slice(LEGACY_PACK_SKU_PREFIX.length))
        : null;
    const resolved = pack || packFromSku;
    if (!resolved) continue;
    if (props._creator_id) continue;

    const customerId = props._appai_customer_id || "";
    if (!customerId) {
      console.warn("[merchant-packs] pack line missing customer id", {
        orderKey,
        lineId: raw.id,
      });
      continue;
    }

    const lineId = raw.id != null ? String(raw.id) : `${orderKey}:${resolved.packId}`;
    const qty = Math.max(1, Number(raw.quantity) || 1);
    const credits = resolved.credits * qty;
    const priceCents = Math.round(Number(raw.price || 0) * 100) * qty;
    const wholesaleCents = STUDIO_CREDIT_WHOLESALE_CENTS * credits;

    try {
      await db.insert(merchantPackPurchases).values({
        shopDomain: shop,
        customerId,
        shopifyOrderId: orderKey,
        shopifyLineId: lineId,
        packId: resolved.packId,
        credits,
        priceCents,
        wholesaleCents,
        creditsClawed: 0,
        status: "paid",
      });
    } catch (e: any) {
      if (String(e?.message || e).includes("unique") || e?.code === "23505") {
        continue;
      }
      throw e;
    }

    const grant = await grantStudioCredits({
      customerId,
      amount: credits,
      source: "pack",
      reason: `merchant_pack:${resolved.packId}`,
      idempotencyKey: `merchant-pack-grant:${orderKey}:${lineId}`,
      shop,
      relatedEntityId: shop,
      externalRef: orderKey,
      metadata: {
        packId: resolved.packId,
        shopifyLineId: lineId,
      },
    });
    if (grant.inserted) granted++;

    if (installation && wholesaleCents > 0) {
      const priceUsd = wholesaleCents / 100;
      await emitOverageUsageCharge({
        installation,
        bucketKey: `merchant-pack:${orderKey}:${lineId}`,
        overageSeq: 1,
        priceUsd,
        description: `Studio Credit pack wholesale (${credits} credits) for ${shop}`,
      }).catch((e: any) =>
        console.warn("[merchant-packs] wholesale usage charge failed:", e?.message || e),
      );
    }

    console.log(
      `[merchant-packs] granted ${credits} pack credits to ${customerId} on ${shop} order ${orderKey}`,
    );
  }
  return { granted };
}

export async function clawbackMerchantPacksForOrder(params: {
  shop: string;
  orderId: string;
  creditsToClaw?: number;
}): Promise<{ clawed: number }> {
  const shop = normalizeShop(params.shop);
  if (!shop || isPlatformShop(shop)) return { clawed: 0 };

  const keys = [
    String(params.orderId),
    params.orderId.startsWith("gid://")
      ? params.orderId
      : `gid://shopify/Order/${String(params.orderId).replace(/\D/g, "")}`,
  ];
  let rows = await db
    .select()
    .from(merchantPackPurchases)
    .where(inArray(merchantPackPurchases.shopifyOrderId, keys));

  if (rows.length === 0) {
    const digits = String(params.orderId).replace(/\D/g, "");
    if (digits) {
      rows = await db
        .select()
        .from(merchantPackPurchases)
        .where(like(merchantPackPurchases.shopifyOrderId, `%${digits}%`))
        .limit(20);
    }
  }
  rows = rows.filter((r) => normalizeShop(r.shopDomain) === shop);
  if (rows.length === 0) return { clawed: 0 };

  let remaining = params.creditsToClaw;
  let clawed = 0;
  for (const row of rows) {
    const available = Math.max(0, row.credits - row.creditsClawed);
    if (available <= 0) continue;
    const amount =
      remaining != null ? Math.min(available, Math.max(0, remaining)) : available;
    if (amount <= 0) continue;

    const r = await clawbackStudioCredits({
      customerId: row.customerId,
      amount,
      preferSource: "pack",
      reason: "merchant_pack_refund",
      idempotencyKey: `merchant-pack-clawback:${row.shopifyOrderId}:${row.shopifyLineId}:${row.creditsClawed + amount}`,
      shop,
      relatedEntityId: shop,
      externalRef: row.shopifyOrderId,
      metadata: { packId: row.packId, purchaseId: row.id },
    });
    if (r.inserted) {
      const nextClawed = row.creditsClawed + amount;
      await db
        .update(merchantPackPurchases)
        .set({
          creditsClawed: nextClawed,
          status: nextClawed >= row.credits ? "refunded" : "partially_refunded",
          updatedAt: new Date(),
        })
        .where(eq(merchantPackPurchases.id, row.id));
      clawed += amount;
      if (remaining != null) remaining -= amount;
    }
  }
  return { clawed };
}
