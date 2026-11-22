/**
 * One-time title correction for the two published Husky listings.
 * Petposterous Softstyle (blueprint 145, provider 99) uses "Softstyle Tee".
 * Titles use an em dash. Handles, descriptions, and variants are left as they are.
 */
import { and, eq, inArray } from "drizzle-orm";
import { listingTitle, normaliseDesignName } from "@shared/listingCopy";
import { CATALOGUE_SHIRT_PROVIDER_ID, SOFTSTYLE_BLUEPRINT_ID } from "@shared/printPlacement";
import { designCandidates, designProducts, productTypes } from "@shared/schema";
import { db } from "./db";
import { ensureValidOfflineAccessToken } from "./shopify-offline-token";
import { storage } from "./storage";
import { paceVendor, shopifyThrottled, vendorRetryDelayMs } from "./vendor-backoff";

const SHOP = "h7epay-gh.myshopify.com";
const CANDIDATE_ID = "fe24de4e-c254-4a0d-a82c-6011b22c39eb";
const DESIGN_NAME = "Husky — Collector's Card";
const SOFTSTYLE_WORD = "Softstyle Tee";

const LISTINGS = [
  {
    shopifyProductId: "16484333944913",
    handle: "husky-collector-s-card-t-shirt-softstyle",
    title: "Husky — Collector's Card Softstyle Tee",
  },
  {
    shopifyProductId: "16484235608145",
    handle: "husky-collector-s-card",
    title: "Husky — Collector's Card T-Shirt",
  },
] as const;

const PREVIOUS_TITLES = new Set([
  "Husky -Collector's Card",
  "Husky -Collector's Card T-Shirt",
  "Husky — Collector's Card",
  "Husky — Collector's Card T-Shirt",
  "Husky — Collector's Card Softstyle Tee",
]);

export type ListingTitleChange = {
  productTypeId: number;
  shopifyProductId: string;
  handle: string;
  before: string;
  after: string;
  shopify: "updated" | "already" | "skipped";
  reason?: string;
};

async function adminGql(shop: string, token: string, query: string, variables: Record<string, unknown>) {
  for (let attempt = 0; ; attempt++) {
    await paceVendor("shopify");
    const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json().catch(() => ({}));
    const throttled = shopifyThrottled(json);
    const delay = vendorRetryDelayMs(throttled ? 429 : res.status, res.headers.get("retry-after"), attempt, throttled);
    if (delay != null) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    if (!res.ok || json?.errors) {
      const errors = json?.errors;
      const message = Array.isArray(errors)
        ? errors.map((err: { message?: string }) => err.message).filter(Boolean).join("; ")
        : typeof errors === "string"
          ? errors
          : "";
      throw new Error(message || `Shopify HTTP ${res.status}`);
    }
    return json.data;
  }
}

export async function backfillHuskyListingTitles(): Promise<ListingTitleChange[]> {
  await db
    .update(productTypes)
    .set({ listingGarmentWord: SOFTSTYLE_WORD })
    .where(and(
      eq(productTypes.shopifyShopDomain, SHOP),
      eq(productTypes.printifyBlueprintId, SOFTSTYLE_BLUEPRINT_ID),
      eq(productTypes.printifyProviderId, CATALOGUE_SHIRT_PROVIDER_ID),
      eq(productTypes.listingGarmentWord, "T-Shirt"),
    ));

  const [candidate] = await db
    .select({ id: designCandidates.id, title: designCandidates.title })
    .from(designCandidates)
    .where(eq(designCandidates.id, CANDIDATE_ID))
    .limit(1);
  if (candidate && normaliseDesignName(candidate.title) === DESIGN_NAME && candidate.title !== DESIGN_NAME) {
    await db
      .update(designCandidates)
      .set({ title: DESIGN_NAME, updatedAt: new Date() })
      .where(eq(designCandidates.id, CANDIDATE_ID));
  }

  const rows = await db
    .select({
      productTypeId: designProducts.productTypeId,
      shopifyProductId: designProducts.shopifyProductId,
      handle: designProducts.handle,
      title: designProducts.title,
      shop: designProducts.shop,
      garmentWord: productTypes.listingGarmentWord,
    })
    .from(designProducts)
    .innerJoin(productTypes, eq(productTypes.id, designProducts.productTypeId))
    .where(inArray(designProducts.shopifyProductId, LISTINGS.map((row) => row.shopifyProductId)));

  const installation = await storage.getShopifyInstallationByShop(SHOP);
  const tokenResult = installation ? await ensureValidOfflineAccessToken(installation) : { ok: false as const, error: "Shop is not installed" };
  const token = tokenResult.ok ? tokenResult.accessToken : null;

  const changes: ListingTitleChange[] = [];
  for (const spec of LISTINGS) {
    const row = rows.find((item) => item.shopifyProductId === spec.shopifyProductId);
    const before = row?.title || "";
    const garmentWord = String(row?.garmentWord || "").trim();
    const expected = listingTitle(DESIGN_NAME, garmentWord);
    const loggedTypeId = row?.productTypeId ?? 0;
    if (!row || row.shop !== SHOP || row.handle !== spec.handle || expected !== spec.title) {
      changes.push({
        productTypeId: loggedTypeId,
        shopifyProductId: spec.shopifyProductId,
        handle: row?.handle || spec.handle,
        before,
        after: before,
        shopify: "skipped",
        reason: !row ? "listing row missing" : expected !== spec.title ? `garment word composed "${expected}"` : "handle or shop does not match",
      });
      continue;
    }
    if (!token) {
      changes.push({
        productTypeId: loggedTypeId,
        shopifyProductId: spec.shopifyProductId,
        handle: spec.handle,
        before,
        after: before,
        shopify: "skipped",
        reason: tokenResult.ok ? "no token" : tokenResult.error || "no token",
      });
      continue;
    }
    const gid = `gid://shopify/Product/${spec.shopifyProductId}`;
    const current = await adminGql(SHOP, token, `query($id: ID!) { product(id: $id) { title handle } }`, { id: gid });
    const liveTitle = String(current?.product?.title || "");
    const liveHandle = String(current?.product?.handle || "");
    if (liveHandle !== spec.handle || !PREVIOUS_TITLES.has(liveTitle)) {
      changes.push({
        productTypeId: loggedTypeId,
        shopifyProductId: spec.shopifyProductId,
        handle: liveHandle || spec.handle,
        before: liveTitle || before,
        after: liveTitle || before,
        shopify: "skipped",
        reason: liveHandle !== spec.handle ? "Shopify handle differs" : "Shopify title was edited",
      });
      continue;
    }
    if (liveTitle !== spec.title) {
      const updated = await adminGql(
        SHOP,
        token,
        `mutation($product: ProductUpdateInput!) {
          productUpdate(product: $product) { product { title handle } userErrors { message } }
        }`,
        { product: { id: gid, title: spec.title, handle: spec.handle } },
      );
      const errors = updated?.productUpdate?.userErrors || [];
      if (errors.length) {
        changes.push({
          productTypeId: loggedTypeId,
          shopifyProductId: spec.shopifyProductId,
          handle: spec.handle,
          before: liveTitle,
          after: liveTitle,
          shopify: "skipped",
          reason: errors.map((err: { message?: string }) => err.message).filter(Boolean).join("; "),
        });
        continue;
      }
      const written = updated?.productUpdate?.product;
      if (written?.handle !== spec.handle || written?.title !== spec.title) {
        changes.push({
          productTypeId: loggedTypeId,
          shopifyProductId: spec.shopifyProductId,
          handle: String(written?.handle || liveHandle),
          before: liveTitle,
          after: String(written?.title || liveTitle),
          shopify: "skipped",
          reason: "Shopify returned a different title or handle",
        });
        continue;
      }
    }
    if (before !== spec.title) {
      await db.update(designProducts).set({ title: spec.title, updatedAt: new Date() }).where(and(
        eq(designProducts.shopifyProductId, spec.shopifyProductId),
        eq(designProducts.handle, spec.handle),
      ));
    }
    changes.push({
      productTypeId: loggedTypeId,
      shopifyProductId: spec.shopifyProductId,
      handle: spec.handle,
      before: liveTitle,
      after: spec.title,
      shopify: liveTitle === spec.title ? "already" : "updated",
    });
  }
  return changes;
}
