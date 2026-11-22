/**
 * Hourly shadow reaper and the 6-hour design-SKU cleanup.
 * Both confirm the live Shopify product is still a shadow before deleting it.
 */
import { storage } from "./storage";
import { db } from "./db";
import { designSkuMappings } from "@shared/schema";
import { eq } from "drizzle-orm";
import { lookupShadowOrderHold } from "./shadow-reaper-guard";
import { adminGraphql, shopToken } from "./checkout-guard";
import { ensureValidOfflineAccessToken } from "./shopify-offline-token";
import { shadowDeleteDecision, type LiveShadowProduct } from "./shadow-delete-guard";

const LOOKUP_CHUNK = 40;

/**
 * One GraphQL nodes query per chunk. A null node is a product Shopify no
 * longer has. Throws if the Admin call itself fails, so the caller leaves
 * those rows for the next run.
 */
export async function lookupProductsForShadowDelete(
  shop: string,
  token: string,
  productIds: string[],
): Promise<Map<string, LiveShadowProduct | null>> {
  const unique = [...new Set(productIds.map(numericId).filter(Boolean))];
  const out = new Map<string, LiveShadowProduct | null>();
  for (let i = 0; i < unique.length; i += LOOKUP_CHUNK) {
    const chunk = unique.slice(i, i + LOOKUP_CHUNK);
    const data = await adminGraphql<any>(
      shop,
      token,
      `query($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            title
            tags
            productType
            metafield(namespace: "ai_art_studio", key: "design_candidate_id") { value }
          }
        }
      }`,
      { ids: chunk.map((id) => `gid://shopify/Product/${id}`) },
    );
    const nodes: any[] = data?.nodes || [];
    chunk.forEach((id, index) => {
      const node = nodes[index];
      if (!node?.id) {
        out.set(id, null);
        return;
      }
      out.set(id, {
        id,
        title: String(node.title || ""),
        tags: Array.isArray(node.tags) ? node.tags.map(String) : [],
        productType: String(node.productType || ""),
        hasDesignCandidate: !!node.metafield?.value,
      });
    });
  }
  return out;
}

export type ShadowCleanupCounts = {
  deleted: number;
  errors: number;
  wouldDelete: number;
  skippedNotShadow: number;
  alreadyGone: number;
};

export type ShadowCleanupOptions = {
  dryRun?: boolean;
  /** Limit this invocation to these Shopify product ids. */
  onlyProductIds?: string[];
};

function numericId(id: string): string {
  return String(id || "").replace(/\D/g, "");
}

/** A stored token can be rejected while the clock still treats it as fresh. One refresh, then stop. */
async function usableToken(shop: string): Promise<string> {
  const token = await shopToken(shop);
  try {
    await adminGraphql(shop, token, `{ shop { name } }`);
    return token;
  } catch (err: any) {
    if (!/\b401\b/.test(String(err?.message || ""))) throw err;
    const inst = await storage.getShopifyInstallationByShop(shop);
    if (!inst) throw err;
    const refreshed = await ensureValidOfflineAccessToken(inst, { forceRefresh: true });
    if (!refreshed.ok) throw new Error(refreshed.error);
    return refreshed.accessToken;
  }
}

function emptyCounts(): ShadowCleanupCounts {
  return { deleted: 0, errors: 0, wouldDelete: 0, skippedNotShadow: 0, alreadyGone: 0 };
}

function logSkip(tag: string, rowId: string | number, product: LiveShadowProduct) {
  console.warn(
    `${tag} skipped_not_shadow row=${rowId} product=${product.id} title="${product.title}" tags=${product.tags.join(",")}`,
  );
}

async function deleteShopifyProduct(shop: string, token: string, productId: string): Promise<Response> {
  return fetch(`https://${shop}/admin/api/2025-10/products/${productId}.json`, {
    method: "DELETE",
    headers: { "X-Shopify-Access-Token": token },
  });
}

export async function runShadowProductCleanup(opts: ShadowCleanupOptions = {}): Promise<ShadowCleanupCounts> {
  const counts = emptyCounts();
  const only = opts.onlyProductIds ? new Set(opts.onlyProductIds.map(numericId)) : null;
  try {
    let expired = await storage.getExpiredShadowProducts();
    if (only) expired = expired.filter((row) => only.has(numericId(row.shopifyProductId)));
    if (expired.length === 0) {
      console.log(`[ShadowProduct Cleanup] wouldDelete=0 skippedNotShadow=0 alreadyGone=0`);
      return counts;
    }
    console.log(`[ShadowProduct Cleanup] Found ${expired.length} expired shadow products to clean up`);

    const byShop: Record<string, typeof expired> = {};
    for (const row of expired) {
      if (!byShop[row.shop]) byShop[row.shop] = [];
      byShop[row.shop].push(row);
    }

    for (const shopDomain of Object.keys(byShop)) {
      const rows = byShop[shopDomain];
      let token: string;
      try {
        token = await usableToken(shopDomain);
      } catch (err: any) {
        console.error(`[ShadowProduct Cleanup] token unavailable for ${shopDomain}:`, err?.message || err);
        counts.errors += rows.length;
        continue;
      }
      const clearRows = [];
      for (const row of rows) {
        const hold = await lookupShadowOrderHold({
          shop: shopDomain,
          token,
          variantId: row.shopifyVariantId,
        });
        if (hold !== "clear") {
          if (hold === "hold") {
            if (!opts.dryRun) await storage.protectShadowProductOrder(row.id);
            console.log(`[ShadowProduct Cleanup] kept variant=${row.shopifyVariantId} reason=order`);
          } else {
            console.warn(`[ShadowProduct Cleanup] kept variant=${row.shopifyVariantId} reason=unverified`);
          }
          continue;
        }
        clearRows.push(row);
      }
      if (clearRows.length === 0) continue;

      let live: Map<string, LiveShadowProduct | null>;
      try {
        live = await lookupProductsForShadowDelete(
          shopDomain,
          token,
          clearRows.map((row) => row.shopifyProductId),
        );
      } catch (err: any) {
        console.error(`[ShadowProduct Cleanup] product lookup failed for ${shopDomain}:`, err?.message || err);
        counts.errors += clearRows.length;
        continue;
      }

      for (const row of clearRows) {
        const id = numericId(row.shopifyProductId);
        const product = live.get(id);
        const decision = shadowDeleteDecision(product, { requireProductType: false });
        if (decision === "skip" && product) {
          logSkip("[ShadowProduct Cleanup]", row.id, product);
          counts.skippedNotShadow++;
          if (!opts.dryRun) await storage.updatePublishedProduct(row.id, { status: "skipped_not_shadow" });
          continue;
        }
        if (decision === "missing") {
          counts.alreadyGone++;
          if (!opts.dryRun) await storage.updatePublishedProduct(row.id, { status: "archived" });
          continue;
        }
        if (opts.dryRun) {
          counts.wouldDelete++;
          continue;
        }
        try {
          const delRes = await deleteShopifyProduct(shopDomain, token, id);
          if (delRes.ok || delRes.status === 404) {
            await storage.updatePublishedProduct(row.id, { status: "archived" });
            if (delRes.status === 404) counts.alreadyGone++;
            else counts.deleted++;
          } else {
            const errText = await delRes.text();
            console.warn(`[ShadowProduct Cleanup] Shopify DELETE failed (${delRes.status}) for product ${id}: ${errText.substring(0, 150)}`);
            counts.errors++;
          }
        } catch (e: any) {
          console.warn(`[ShadowProduct Cleanup] Error deleting product ${id}:`, e?.message);
          counts.errors++;
        }
      }
    }
  } catch (e: any) {
    console.error("[ShadowProduct Cleanup] Unexpected error:", e);
    counts.errors++;
  }
  console.log(
    `[ShadowProduct Cleanup] wouldDelete=${counts.wouldDelete} skippedNotShadow=${counts.skippedNotShadow} alreadyGone=${counts.alreadyGone} deleted=${counts.deleted} errors=${counts.errors}`,
  );
  return counts;
}

export async function runDesignSkuCleanup(opts: ShadowCleanupOptions = {}): Promise<ShadowCleanupCounts> {
  const counts = emptyCounts();
  const only = opts.onlyProductIds ? new Set(opts.onlyProductIds.map(numericId)) : null;
  try {
    let expired = await storage.getExpiredDesignSkuMappings(new Date());
    if (only) expired = expired.filter((row) => only.has(numericId(row.shadowShopifyProductId)));
    if (expired.length === 0) {
      console.log(`[Design SKU Cleanup] wouldDelete=0 skippedNotShadow=0 alreadyGone=0`);
      return counts;
    }

    const byShop: Record<string, typeof expired> = {};
    for (const row of expired) {
      if (!byShop[row.shopDomain]) byShop[row.shopDomain] = [];
      byShop[row.shopDomain].push(row);
    }

    for (const shopDomain of Object.keys(byShop)) {
      const rows = byShop[shopDomain];
      let token: string;
      try {
        token = await usableToken(shopDomain);
      } catch (err: any) {
        console.error(`[Design SKU Cleanup] token unavailable for ${shopDomain}:`, err?.message || err);
        counts.errors += rows.length;
        continue;
      }
      let live: Map<string, LiveShadowProduct | null>;
      try {
        live = await lookupProductsForShadowDelete(
          shopDomain,
          token,
          rows.map((row) => row.shadowShopifyProductId),
        );
      } catch (err: any) {
        console.error(`[Design SKU Cleanup] product lookup failed for ${shopDomain}:`, err?.message || err);
        counts.errors += rows.length;
        continue;
      }

      for (const row of rows) {
        const id = numericId(row.shadowShopifyProductId);
        const product = live.get(id);
        const decision = shadowDeleteDecision(product, { requireProductType: true });
        if (decision === "skip" && product) {
          logSkip("[Design SKU Cleanup]", row.id, product);
          counts.skippedNotShadow++;
          if (!opts.dryRun) {
            await db.update(designSkuMappings)
              .set({ cleanupStatus: "skipped_not_shadow" })
              .where(eq(designSkuMappings.id, row.id));
          }
          continue;
        }
        if (decision === "missing") {
          counts.alreadyGone++;
          if (!opts.dryRun) await storage.deleteDesignSkuMapping(row.id);
          continue;
        }
        if (opts.dryRun) {
          counts.wouldDelete++;
          continue;
        }
        try {
          const delRes = await deleteShopifyProduct(shopDomain, token, id);
          if (delRes.ok || delRes.status === 404) {
            await storage.deleteDesignSkuMapping(row.id);
            if (delRes.status === 404) counts.alreadyGone++;
            else counts.deleted++;
          } else {
            const errText = await delRes.text();
            console.warn(`[Design SKU Cleanup] Shopify DELETE failed (${delRes.status}) for product ${id}: ${errText.substring(0, 150)}`);
            counts.errors++;
          }
        } catch (e: any) {
          console.warn(`[Design SKU Cleanup] Failed for product ${id}:`, e?.message);
          counts.errors++;
        }
      }
    }
  } catch (e: any) {
    console.error("[Design SKU Cleanup] Unexpected error:", e);
    counts.errors++;
  }
  console.log(
    `[Design SKU Cleanup] wouldDelete=${counts.wouldDelete} skippedNotShadow=${counts.skippedNotShadow} alreadyGone=${counts.alreadyGone} deleted=${counts.deleted} errors=${counts.errors}`,
  );
  return counts;
}
