/**
 * Orders with AppAI lines we did not send to Printify. Instead of a silent skip,
 * the Shopify order gets a visible tag + note (needs write_orders — staging TOML
 * only for now) and the submission row carries `metadata.needsAttention`, which
 * the platform-admin list below reads.
 */
import { pool } from "./db";
import { adminGraphql, grantedScopes, shopToken } from "./checkout-guard";
import { normalizeMyshopifyShopDomain } from "./shopDomain";

export const NEEDS_ATTENTION_TAG = "appai-needs-attention";
const NOTE_MAX = 4500;

export type AttentionLine = {
  lineId: string;
  variantId: string | null;
  quantity: number;
  reason: string;
};

export type ShopifyAttentionFlag = {
  state: "tagged" | "already-tagged" | "skipped-test" | "no-order-id" | "missing-scope" | "error";
  error?: string;
};

function orderGid(order: any): string | null {
  const gid = String(order?.admin_graphql_api_id || "");
  if (gid.startsWith("gid://shopify/Order/")) return gid;
  const id = String(order?.id ?? "");
  return /^\d+$/.test(id) ? `gid://shopify/Order/${id}` : null;
}

function attentionNote(lines: AttentionLine[]): string {
  const body = lines
    .map((l) => `• line ${l.lineId} (qty ${l.quantity}): ${l.reason}`)
    .join("\n");
  return `AppAI did not send ${lines.length} item(s) to Printify — fulfil manually or contact support:\n${body}`;
}

export async function flagOrderNeedsAttention(args: {
  shop: string;
  shopifyOrder: any;
  lines: AttentionLine[];
  isTest: boolean;
}): Promise<ShopifyAttentionFlag> {
  const shop = normalizeMyshopifyShopDomain(args.shop);
  console.error(
    `[fulfillment-attention] ${shop || "(no shop)"} order ${args.shopifyOrder?.id ?? "?"}: ${args.lines.length} AppAI line(s) not sent — ${args.lines.map((l) => l.reason).join(" | ")}`,
  );
  if (args.isTest) return { state: "skipped-test" };
  const gid = orderGid(args.shopifyOrder);
  if (!gid || !shop) return { state: "no-order-id" };

  try {
    const token = await shopToken(shop);
    const scopes = await grantedScopes(shop, token);
    if (!scopes.includes("write_orders")) return { state: "missing-scope" };

    const read = await adminGraphql<any>(shop, token, `query($id: ID!) { order(id: $id) { note tags } }`, { id: gid });
    const order = read?.order;
    if (!order) return { state: "error", error: "order not found" };
    // Webhook retries re-run a skipped order; the tag marks it already noted.
    if ((order.tags ?? []).includes(NEEDS_ATTENTION_TAG)) return { state: "already-tagged" };

    const existing = String(order.note || "").trim();
    const note = [existing, attentionNote(args.lines)].filter(Boolean).join("\n\n").slice(0, NOTE_MAX);
    const res = await adminGraphql<any>(
      shop,
      token,
      `mutation($id: ID!, $tags: [String!]!, $input: OrderInput!) {
        tagsAdd(id: $id, tags: $tags) { userErrors { message } }
        orderUpdate(input: $input) { userErrors { message } }
      }`,
      { id: gid, tags: [NEEDS_ATTENTION_TAG], input: { id: gid, note } },
    );
    const errs = [...(res?.tagsAdd?.userErrors ?? []), ...(res?.orderUpdate?.userErrors ?? [])]
      .map((e: any) => e?.message)
      .filter(Boolean);
    if (errs.length) return { state: "error", error: errs.join("; ") };
    return { state: "tagged" };
  } catch (e: any) {
    return { state: "error", error: String(e?.message || e).slice(0, 300) };
  }
}

export type AttentionSubmission = {
  id: number;
  shop: string | null;
  shopifyOrderId: string | null;
  status: string;
  isTest: boolean;
  printifyOrderId: string | null;
  needsAttention: AttentionLine[];
  shopifyFlag: ShopifyAttentionFlag | null;
  createdAt: string;
};

export async function listNeedsAttentionSubmissions(opts: {
  shop?: string | null;
  includeTests?: boolean;
  limit?: number;
}): Promise<AttentionSubmission[]> {
  const shop = opts.shop ? normalizeMyshopifyShopDomain(opts.shop) : null;
  const limit = Math.max(1, Math.min(500, Number(opts.limit) || 100));
  const r = await pool.query(
    `SELECT id, shop, shopify_order_id, status, is_test, printify_order_id, metadata, created_at
       FROM flat_order_submissions
      WHERE jsonb_typeof(metadata->'needsAttention') = 'array'
        AND jsonb_array_length(metadata->'needsAttention') > 0
        AND ($1::text IS NULL OR lower(shop) = $1)
        AND ($2::boolean OR is_test = false)
      ORDER BY created_at DESC
      LIMIT $3`,
    [shop, opts.includeTests === true, limit],
  );
  return r.rows.map((row: any) => ({
    id: row.id,
    shop: row.shop,
    shopifyOrderId: row.shopify_order_id,
    status: row.status,
    isTest: !!row.is_test,
    printifyOrderId: row.printify_order_id,
    needsAttention: row.metadata?.needsAttention ?? [],
    shopifyFlag: row.metadata?.shopifyFlag ?? null,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}
