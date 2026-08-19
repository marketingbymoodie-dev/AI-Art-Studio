/**
 * Delete disposable Printify test-order drafts + leftover temp products after 7 days.
 *
 * Does NOT touch:
 *  - merchant Saved Designs / generation_jobs mockup URLs (those live in our DB + storage)
 *  - published design_products.printify_product_id listings
 *  - any Printify order already sent to production / in production / fulfilled
 */
import { pool } from "./db";

const TAG = "[Printify Test Cleanup]";
const PRINTIFY_API_BASE = "https://api.printify.com/v1";
const RETAIN_MS = 7 * 24 * 60 * 60 * 1000;
const PAGE_LIMIT = 50;
const REQUEST_GAP_MS = 200;

const PRODUCTION_ORDER_STATUSES = new Set([
  "sending-to-production",
  "in-production",
  "fulfilled",
  "partial",
  "payment-not-received",
]);

export type PrintifyTestCleanupResult = {
  shops: number;
  ordersCanceled: number;
  productsDeleted: number;
  skippedProtected: number;
  errors: number;
};

type PrintifyCreds = { shopId: string; token: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Titles we create (or Printify auto-names from our test-order external_id). */
export function isDisposablePrintifyTitle(title: string | null | undefined): boolean {
  const t = String(title || "").trim();
  if (!t) return false;
  if (/^Mockup Preview - \d+/i.test(t)) return true;
  if (/^_cost_probe_\d+/i.test(t)) return true;
  if (/^__appai_calibration_/i.test(t)) return true;
  if (/^__appai_mapper_blank_/i.test(t)) return true;
  if (/flat-test-order/i.test(t) || /cart-test-order/i.test(t)) return true;
  if (/^API Shopify /i.test(t) && /test-order/i.test(t)) return true;
  if (/AppAI Test$/i.test(t) && /test-order/i.test(t)) return true;
  return false;
}

function isOlderThanRetention(createdAt: string | Date | null | undefined, now: Date): boolean {
  if (!createdAt) return false;
  const ts = createdAt instanceof Date ? createdAt.getTime() : Date.parse(String(createdAt));
  if (!Number.isFinite(ts)) return false;
  return now.getTime() - ts >= RETAIN_MS;
}

async function printifyFetch<T = any>(
  token: string,
  pathname: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: T | null; text: string }> {
  const res = await fetch(`${PRINTIFY_API_BASE}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let json: T | null = null;
  if (text) {
    try {
      json = JSON.parse(text) as T;
    } catch {
      json = null;
    }
  }
  return { ok: res.ok, status: res.status, json, text };
}

async function loadPrintifyShops(): Promise<PrintifyCreds[]> {
  const result = await pool.query<{ printify_shop_id: string; printify_api_token: string }>(
    `SELECT DISTINCT printify_shop_id, printify_api_token
       FROM merchants
      WHERE COALESCE(TRIM(printify_shop_id), '') <> ''
        AND COALESCE(TRIM(printify_api_token), '') <> ''`,
  );
  const seen = new Set<string>();
  const shops: PrintifyCreds[] = [];
  for (const row of result.rows) {
    const shopId = String(row.printify_shop_id).trim();
    if (seen.has(shopId)) continue;
    seen.add(shopId);
    shops.push({ shopId, token: String(row.printify_api_token).trim() });
  }
  return shops;
}

async function loadProtectedProductIds(): Promise<Set<string>> {
  const result = await pool.query<{ printify_product_id: string }>(
    `SELECT printify_product_id
       FROM design_products
      WHERE COALESCE(TRIM(printify_product_id), '') <> ''`,
  );
  return new Set(result.rows.map((r) => String(r.printify_product_id).trim()));
}

async function loadExpiredTestOrders(): Promise<
  Array<{ id: number; printifyOrderId: string; printifyShopId: string }>
> {
  const result = await pool.query<{
    id: number;
    printify_order_id: string;
    printify_shop_id: string;
  }>(
    `SELECT id, printify_order_id, printify_shop_id
       FROM flat_order_submissions
      WHERE is_test = TRUE
        AND sent_to_production = FALSE
        AND printify_order_id IS NOT NULL
        AND COALESCE(TRIM(printify_shop_id), '') <> ''
        AND status IN ('submitted', 'duplicate')
        AND created_at < NOW() - INTERVAL '7 days'`,
  );
  return result.rows.map((r) => ({
    id: r.id,
    printifyOrderId: String(r.printify_order_id),
    printifyShopId: String(r.printify_shop_id),
  }));
}

async function markSubmissionCleaned(id: number): Promise<void> {
  await pool.query(
    `UPDATE flat_order_submissions
        SET status = 'cleaned',
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('cleanedAt', $2::text),
            updated_at = NOW()
      WHERE id = $1`,
    [id, new Date().toISOString()],
  );
}

function collectOrderProductIds(order: any): string[] {
  const ids = new Set<string>();
  for (const line of order?.line_items || []) {
    const id = String(line?.product_id || "").trim();
    if (id) ids.add(id);
  }
  if (order?.metadata?.product_id) ids.add(String(order.metadata.product_id));
  return [...ids];
}

async function cancelOrderIfDraft(
  creds: PrintifyCreds,
  orderId: string,
): Promise<"canceled" | "already-gone" | "protected" | "error"> {
  const got = await printifyFetch<any>(creds.token, `/shops/${creds.shopId}/orders/${orderId}.json`);
  if (got.status === 404) return "already-gone";
  if (!got.ok || !got.json) return "error";
  const status = String(got.json.status || "").toLowerCase();
  if (PRODUCTION_ORDER_STATUSES.has(status)) return "protected";
  if (status === "canceled" || status === "cancelled") return "canceled";
  const cancel = await printifyFetch(
    creds.token,
    `/shops/${creds.shopId}/orders/${orderId}/cancel.json`,
    { method: "POST", body: "{}" },
  );
  if (cancel.ok || cancel.status === 404) return "canceled";
  // Already canceled / not cancellable as draft
  if (cancel.status === 400 && /cancel/i.test(cancel.text)) return "canceled";
  console.warn(`${TAG} cancel order ${orderId} failed: ${cancel.status} ${cancel.text.slice(0, 160)}`);
  return "error";
}

async function deleteProductIfAllowed(
  creds: PrintifyCreds,
  productId: string,
  protectedIds: Set<string>,
  title?: string,
): Promise<"deleted" | "protected" | "error"> {
  if (protectedIds.has(productId)) return "protected";
  if (title && !isDisposablePrintifyTitle(title)) return "protected";
  const del = await printifyFetch(
    creds.token,
    `/shops/${creds.shopId}/products/${productId}.json`,
    { method: "DELETE" },
  );
  if (del.ok || del.status === 404) return "deleted";
  console.warn(`${TAG} delete product ${productId} failed: ${del.status} ${del.text.slice(0, 160)}`);
  return "error";
}

async function sweepLeftoverProducts(
  creds: PrintifyCreds,
  protectedIds: Set<string>,
  now: Date,
): Promise<{ deleted: number; skippedProtected: number; errors: number }> {
  let deleted = 0;
  let skippedProtected = 0;
  let errors = 0;
  for (let page = 1; page <= 40; page++) {
    const list = await printifyFetch<any>(
      creds.token,
      `/shops/${creds.shopId}/products.json?limit=${PAGE_LIMIT}&page=${page}`,
    );
    if (!list.ok) {
      if (list.status !== 404) {
        console.warn(`${TAG} list products shop ${creds.shopId} page ${page}: ${list.status}`);
        errors++;
      }
      break;
    }
    const rows: any[] = Array.isArray(list.json?.data)
      ? list.json.data
      : Array.isArray(list.json)
        ? list.json
        : [];
    if (rows.length === 0) break;
    for (const p of rows) {
      const id = String(p?.id || "").trim();
      const title = String(p?.title || "");
      if (!id || !isDisposablePrintifyTitle(title)) continue;
      if (protectedIds.has(id)) {
        skippedProtected++;
        continue;
      }
      if (!isOlderThanRetention(p.created_at, now)) continue;
      await sleep(REQUEST_GAP_MS);
      const result = await deleteProductIfAllowed(creds, id, protectedIds, title);
      if (result === "deleted") deleted++;
      else if (result === "protected") skippedProtected++;
      else errors++;
    }
    const lastPage = Number(list.json?.last_page || page);
    if (page >= lastPage || rows.length < PAGE_LIMIT) break;
    await sleep(REQUEST_GAP_MS);
  }
  return { deleted, skippedProtected, errors };
}

export async function runPrintifyTestArtifactCleanup(
  now = new Date(),
): Promise<PrintifyTestCleanupResult> {
  const result: PrintifyTestCleanupResult = {
    shops: 0,
    ordersCanceled: 0,
    productsDeleted: 0,
    skippedProtected: 0,
    errors: 0,
  };

  let shops: PrintifyCreds[];
  let protectedIds: Set<string>;
  let expiredOrders: Array<{ id: number; printifyOrderId: string; printifyShopId: string }>;
  try {
    shops = await loadPrintifyShops();
    protectedIds = await loadProtectedProductIds();
    expiredOrders = await loadExpiredTestOrders();
  } catch (e: any) {
    console.error(`${TAG} failed to load cleanup inputs:`, e?.message || e);
    result.errors++;
    return result;
  }

  result.shops = shops.length;
  const credsByShop = new Map(shops.map((s) => [s.shopId, s]));

  for (const row of expiredOrders) {
    const creds = credsByShop.get(row.printifyShopId);
    if (!creds) {
      result.errors++;
      continue;
    }
    try {
      const orderGot = await printifyFetch<any>(
        creds.token,
        `/shops/${creds.shopId}/orders/${row.printifyOrderId}.json`,
      );
      const productIds =
        orderGot.ok && orderGot.json ? collectOrderProductIds(orderGot.json) : [];
      const cancel = await cancelOrderIfDraft(creds, row.printifyOrderId);
      if (cancel === "protected") {
        result.skippedProtected++;
        continue;
      }
      if (cancel === "error") {
        result.errors++;
        continue;
      }
      result.ordersCanceled++;
      for (const productId of productIds) {
        await sleep(REQUEST_GAP_MS);
        const titleGot = await printifyFetch<any>(
          creds.token,
          `/shops/${creds.shopId}/products/${productId}.json`,
        );
        const title = titleGot.json?.title as string | undefined;
        const del = await deleteProductIfAllowed(creds, productId, protectedIds, title);
        if (del === "deleted") result.productsDeleted++;
        else if (del === "protected") result.skippedProtected++;
        else result.errors++;
      }
      await markSubmissionCleaned(row.id);
    } catch (e: any) {
      console.warn(`${TAG} order ${row.printifyOrderId}:`, e?.message || e);
      result.errors++;
    }
    await sleep(REQUEST_GAP_MS);
  }

  for (const creds of shops) {
    try {
      const leftover = await sweepLeftoverProducts(creds, protectedIds, now);
      result.productsDeleted += leftover.deleted;
      result.skippedProtected += leftover.skippedProtected;
      result.errors += leftover.errors;
    } catch (e: any) {
      console.warn(`${TAG} leftover sweep shop ${creds.shopId}:`, e?.message || e);
      result.errors++;
    }
    await sleep(REQUEST_GAP_MS);
  }

  console.log(
    `${TAG} Done: shops=${result.shops} ordersCanceled=${result.ordersCanceled} ` +
      `productsDeleted=${result.productsDeleted} skippedProtected=${result.skippedProtected} errors=${result.errors}`,
  );
  return result;
}
