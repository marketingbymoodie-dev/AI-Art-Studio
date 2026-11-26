/**
 * The hourly shadow cleanup must not delete a variant that is still on an
 * order. Live carts are not listed by the Admin API; those are protected by
 * cart-added (cartAddedAt), which the expired-row query already excludes.
 */
const RECENT_FULFILLED_MS = 60 * 24 * 60 * 60 * 1000;

export type ShadowOrderHold = "hold" | "clear" | "unknown";

export type ShadowOrderRow = {
  cancelledAt?: string | null;
  displayFulfillmentStatus?: string | null;
  createdAt?: string | null;
};

export function decideShadowOrderHold(orders: ShadowOrderRow[], now = Date.now()): Exclude<ShadowOrderHold, "unknown"> {
  for (const order of orders) {
    if (order.cancelledAt) continue;
    const status = String(order.displayFulfillmentStatus || "").toUpperCase();
    if (status !== "FULFILLED") return "hold";
    const created = order.createdAt ? Date.parse(order.createdAt) : NaN;
    if (!Number.isFinite(created) || now - created < RECENT_FULFILLED_MS) return "hold";
  }
  return "clear";
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export async function lookupShadowOrderHold(args: {
  shop: string;
  token: string;
  variantId: string;
  fetchImpl?: FetchLike;
}): Promise<ShadowOrderHold> {
  const variantId = String(args.variantId || "").replace(/\D/g, "");
  if (!args.shop || !args.token || !variantId) return "unknown";
  const fetchImpl = args.fetchImpl || fetch;
  const query = `query ShadowOrders($q: String!) {
    orders(first: 10, query: $q) {
      edges { node { cancelledAt displayFulfillmentStatus createdAt } }
    }
  }`;
  try {
    const res = await fetchImpl(`https://${args.shop}/admin/api/2025-10/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": args.token,
      },
      body: JSON.stringify({ query, variables: { q: `variant_id:${variantId}` } }),
    });
    if (!res.ok) return "unknown";
    const json: any = await res.json().catch(() => null);
    if (!json || json.errors) return "unknown";
    const edges = json?.data?.orders?.edges;
    if (!Array.isArray(edges)) return "unknown";
    const orders: ShadowOrderRow[] = edges.map((edge: any) => edge?.node || {});
    return decideShadowOrderHold(orders);
  } catch {
    return "unknown";
  }
}

/** orders/paid: every shadow variant on the order is permanent. */
export async function protectShadowsOnPaidOrder(
  shop: string,
  order: any,
  deps: {
    findActiveShadowProduct: (shop: string, ids: { variantId: string }) => Promise<{ id: string } | undefined>;
    protectShadowProductOrder: (id: string) => Promise<void>;
  },
): Promise<number> {
  const items = Array.isArray(order?.line_items) ? order.line_items : [];
  const orderName = order?.name || order?.id || "";
  let protectedCount = 0;
  const seen = new Set<string>();
  for (const item of items) {
    const variantId = String(item?.variant_id || "").replace(/\D/g, "");
    if (!variantId || seen.has(variantId)) continue;
    seen.add(variantId);
    const row = await deps.findActiveShadowProduct(shop, { variantId });
    if (!row) continue;
    await deps.protectShadowProductOrder(row.id);
    protectedCount++;
    console.log(`[ShadowProduct] order-protected variant=${variantId} order=${orderName}`);
  }
  return protectedCount;
}
