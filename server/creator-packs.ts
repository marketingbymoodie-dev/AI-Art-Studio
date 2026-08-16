/**
 * Creator Marketplace Phase 8 — generation credit packs on the platform shop.
 */
import { eq, inArray, like } from "drizzle-orm";
import {
  CREDIT_PACK_CATALOG,
  getCreditPackDefinition,
  type CreditPackDefinition,
} from "@shared/storefront-credits";
import { creatorPackPurchases, platformConfig } from "@shared/schema";
import { normalizeCreatorUsername } from "@shared/creatorMarketplace";
import { db } from "./db";
import {
  getCreatorPlatformShopDomain,
  isCreatorMarketplaceEnabled,
  setPlatformConfig,
} from "./creator-config";
import { createCreatorCheckoutCart, isCreatorStorefrontConfigured } from "./shopify-storefront";
import { clawbackStudioCredits, grantStudioCredits } from "./studio-credits";
import { creatorReturnCheckoutAttributes, lookupCreatorByUsername } from "./creator-host";
import { normalizeShopifyOrderLine } from "./flat-order-fulfillment";
import { storage } from "./storage";

const VARIANT_CONFIG_PREFIX = "CREATOR_PACK_VARIANT_";
const PACK_SKU_PREFIX = "appai-pack-";

export function packGensBurnCreatorAllowance(): boolean {
  const v = (process.env.CREATOR_PACK_GENS_BURN_ALLOWANCE || "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export function isCreatorCreditPackLine(props: Record<string, string>, sku?: string | null): boolean {
  if (props._credit_pack_id) return true;
  return String(sku || "").startsWith(PACK_SKU_PREFIX);
}

function normalizeShop(shop: string | null | undefined): string {
  return String(shop || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
}

function isPlatformShop(shop: string): boolean {
  const platform = normalizeShop(getCreatorPlatformShopDomain());
  if (!platform) return false;
  const s = normalizeShop(shop);
  return s === platform || s === platform.replace(/\.myshopify\.com$/, "");
}

/** Env override: CREATOR_PACK_VARIANTS_JSON={"5":"123456","10":"789"} */
function variantIdFromEnv(packId: string): string | null {
  const raw = (process.env.CREATOR_PACK_VARIANTS_JSON || "").trim();
  if (!raw) return null;
  try {
    const map = JSON.parse(raw) as Record<string, string>;
    const v = map[packId];
    return v ? String(v).replace(/\D/g, "") || null : null;
  } catch {
    return null;
  }
}

async function variantIdFromConfig(packId: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(platformConfig)
    .where(eq(platformConfig.key, `${VARIANT_CONFIG_PREFIX}${packId}`))
    .limit(1);
  const digits = row?.value ? String(row.value).replace(/\D/g, "") : "";
  return digits || null;
}

async function resolveInstallation(shop: string) {
  const installations = await storage.getShopifyInstallationsByShop(shop);
  return installations.find((i) => i.status === "active" && i.accessToken) || null;
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
  await adminGraphql(shop, accessToken, `
    mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        userErrors { message }
      }
    }
  `, {
    id: productGid,
    input: [{ publicationId: onlineStore.node.id }],
  });
}

/**
 * Ensure each catalog pack has a Shopify variant on the platform shop.
 * Creates products when missing; caches variant ids in platform_config.
 */
export async function ensureCreatorPackVariants(): Promise<
  Array<CreditPackDefinition & { variantId: string }>
> {
  const shop = getCreatorPlatformShopDomain();
  if (!shop) throw new Error("CREATOR_PLATFORM_SHOP_DOMAIN is not set");

  const out: Array<CreditPackDefinition & { variantId: string }> = [];
  let installationToken: string | null = null;

  for (const pack of CREDIT_PACK_CATALOG) {
    const fromEnv = variantIdFromEnv(pack.packId);
    if (fromEnv) {
      out.push({ ...pack, variantId: fromEnv });
      continue;
    }
    const fromCfg = await variantIdFromConfig(pack.packId);
    if (fromCfg) {
      out.push({ ...pack, variantId: fromCfg });
      continue;
    }

    if (!installationToken) {
      const installation = await resolveInstallation(shop);
      if (!installation?.accessToken) {
        throw new Error("Platform shop is not authorized — reconnect the staging app");
      }
      installationToken = installation.accessToken;
    }
    const token = installationToken;
    const sku = `${PACK_SKU_PREFIX}${pack.packId}`;

    const existing = await findVariantIdBySku(shop, token, sku).catch(() => null);
    if (existing?.variantId) {
      await setPlatformConfig(`${VARIANT_CONFIG_PREFIX}${pack.packId}`, existing.variantId);
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
          vendor: "AppAI",
          product_type: "Credit Pack",
          tags: "appai-credit-pack,appai-shadow",
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
    const vid = String(product?.variants?.[0]?.id || "");
    const productGid =
      product?.admin_graphql_api_id ||
      (product?.id != null ? `gid://shopify/Product/${product.id}` : "");
    if (!vid) throw new Error(`Pack product ${pack.packId} created without variant`);
    await setPlatformConfig(`${VARIANT_CONFIG_PREFIX}${pack.packId}`, vid);
    if (productGid) {
      await publishProductToOnlineStore(shop, token, productGid).catch((e) =>
        console.warn("[creator-packs] publish failed:", e?.message || e),
      );
    }
    out.push({ ...pack, variantId: vid });
  }
  return out;
}

export async function listCreatorPacksForSale(): Promise<
  Array<CreditPackDefinition & { variantReady: boolean }>
> {
  const packs = [];
  for (const pack of CREDIT_PACK_CATALOG) {
    const vid =
      variantIdFromEnv(pack.packId) || (await variantIdFromConfig(pack.packId));
    packs.push({ ...pack, variantReady: !!vid });
  }
  return packs;
}

export async function createCreatorPackCheckout(params: {
  packId: string;
  creatorUsername: string;
  customerId: string;
  creatorSessionId?: string | null;
  returnUrl?: string | null;
}): Promise<{ checkoutUrl: string; cartId: string; pack: CreditPackDefinition }> {
  if (!isCreatorMarketplaceEnabled()) {
    throw new Error("Creator Marketplace is not enabled");
  }
  if (!isCreatorStorefrontConfigured()) {
    throw new Error("Creator Storefront API is not configured");
  }
  const pack = getCreditPackDefinition(params.packId);
  if (!pack) throw new Error("Unknown credit pack");
  if (!params.customerId?.trim()) throw new Error("customerId is required");

  const username = normalizeCreatorUsername(params.creatorUsername);
  if (!username) throw new Error("Invalid creator username");
  const creator = await lookupCreatorByUsername(username);
  if (!creator) throw new Error("Creator not found");
  if (["paused", "suspended", "archived"].includes(creator.status)) {
    throw new Error("This creator shop is not accepting pack purchases");
  }

  const variants = await ensureCreatorPackVariants();
  const matched = variants.find((v) => v.packId === pack.packId);
  if (!matched?.variantId) throw new Error("Pack variant is not available");

  const returnAttrs = creatorReturnCheckoutAttributes(creator, params.returnUrl);
  const cart = await createCreatorCheckoutCart({
    variantId: matched.variantId,
    quantity: 1,
    attributes: [
      { key: "_creator_id", value: creator.id },
      { key: "_creator_username", value: creator.username },
      { key: "_credit_pack_id", value: pack.packId },
      { key: "_appai_customer_id", value: params.customerId },
      { key: "_appai_pack_credits", value: String(pack.credits) },
      ...returnAttrs,
      ...(params.creatorSessionId
        ? [{ key: "_creator_session", value: String(params.creatorSessionId) }]
        : []),
    ],
    cartAttributes: returnAttrs,
  });

  return { checkoutUrl: cart.checkoutUrl, cartId: cart.cartId, pack };
}

function orderIdKey(order: any): string {
  if (order?.admin_graphql_api_id) return String(order.admin_graphql_api_id);
  if (order?.id != null) return String(order.id);
  return "";
}

/** Grant pack credits from a paid platform-shop order (idempotent per line). */
export async function grantCreatorPacksFromPaidOrder(
  shop: string,
  order: any,
): Promise<{ granted: number }> {
  if (!isCreatorMarketplaceEnabled() || !isPlatformShop(shop)) {
    return { granted: 0 };
  }
  if (!Array.isArray(order?.line_items)) return { granted: 0 };

  const orderKey = orderIdKey(order);
  if (!orderKey) return { granted: 0 };

  let granted = 0;
  for (const raw of order.line_items) {
    const line = normalizeShopifyOrderLine(raw);
    const props = line.properties;
    const packId = props._credit_pack_id || "";
    const pack = getCreditPackDefinition(packId);
    const sku = String(raw.sku || "");
    const packFromSku = sku.startsWith(PACK_SKU_PREFIX)
      ? getCreditPackDefinition(sku.slice(PACK_SKU_PREFIX.length))
      : null;
    const resolved = pack || packFromSku;
    if (!resolved) continue;

    const customerId = props._appai_customer_id || "";
    const creatorId = props._creator_id || "";
    if (!customerId || !creatorId) {
      console.warn("[creator-packs] pack line missing customer/creator attrs", {
        orderKey,
        lineId: raw.id,
      });
      continue;
    }

    const lineId = raw.id != null ? String(raw.id) : `${orderKey}:${resolved.packId}`;
    const qty = Math.max(1, Number(raw.quantity) || 1);
    const credits = resolved.credits * qty;
    const priceCents = Math.round(Number(raw.price || 0) * 100) * qty;

    try {
      await db.insert(creatorPackPurchases).values({
        creatorId,
        customerId,
        sessionId: props._creator_session || null,
        shopifyOrderId: orderKey,
        shopifyLineId: lineId,
        packId: resolved.packId,
        credits,
        priceCents,
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
      reason: `creator_pack:${resolved.packId}`,
      idempotencyKey: `creator-pack-grant:${orderKey}:${lineId}`,
      shop: normalizeShop(shop),
      relatedEntityId: creatorId,
      externalRef: orderKey,
      metadata: {
        packId: resolved.packId,
        creatorId,
        shopifyLineId: lineId,
      },
    });
    if (grant.inserted) granted++;
    console.log(
      `[creator-packs] granted ${credits} pack credits to ${customerId} for creator ${creatorId} order ${orderKey}`,
    );
  }
  return { granted };
}

/** Claw back pack credits for a refunded/cancelled order. */
export async function clawbackCreatorPacksForOrder(params: {
  shop: string;
  orderId: string;
  creditsToClaw?: number;
}): Promise<{ clawed: number }> {
  if (!isCreatorMarketplaceEnabled() || !isPlatformShop(params.shop)) {
    return { clawed: 0 };
  }

  const keys = [
    String(params.orderId),
    params.orderId.startsWith("gid://")
      ? params.orderId
      : `gid://shopify/Order/${String(params.orderId).replace(/\D/g, "")}`,
  ];
  let rows = await db
    .select()
    .from(creatorPackPurchases)
    .where(inArray(creatorPackPurchases.shopifyOrderId, keys));

  if (rows.length === 0) {
    const digits = String(params.orderId).replace(/\D/g, "");
    if (digits) {
      rows = await db
        .select()
        .from(creatorPackPurchases)
        .where(like(creatorPackPurchases.shopifyOrderId, `%${digits}%`))
        .limit(20);
    }
  }
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
      reason: "creator_pack_refund",
      idempotencyKey: `creator-pack-clawback:${row.shopifyOrderId}:${row.shopifyLineId}:${row.creditsClawed + amount}`,
      shop: normalizeShop(params.shop),
      relatedEntityId: row.creatorId,
      externalRef: row.shopifyOrderId,
      metadata: { packId: row.packId, purchaseId: row.id },
    });
    if (r.inserted) {
      const nextClawed = row.creditsClawed + amount;
      await db
        .update(creatorPackPurchases)
        .set({
          creditsClawed: nextClawed,
          status: nextClawed >= row.credits ? "refunded" : "partially_refunded",
          updatedAt: new Date(),
        })
        .where(eq(creatorPackPurchases.id, row.id));
      clawed += amount;
      if (remaining != null) remaining -= amount;
    }
  }
  return { clawed };
}
