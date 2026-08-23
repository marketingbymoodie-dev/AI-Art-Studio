/**
 * Reused shadows must re-read the live catalog (base) front price, then
 * optionally apply a both-tier override. Never write front over a both-tier
 * charge when Print Side is Both.
 */

export function resolveShadowSellPrice(
  frontPrice: string | number | null | undefined,
  bothOverride?: string | number | null,
): { front: string | null; written: string | null; source: "both" | "front" | null } {
  const frontN = parseFloat(String(frontPrice ?? ""));
  const front = Number.isFinite(frontN) && frontN > 0 ? frontN.toFixed(2) : null;
  const bothN = parseFloat(String(bothOverride ?? ""));
  const both = Number.isFinite(bothN) && bothN > 0 ? bothN.toFixed(2) : null;
  if (both) return { front, written: both, source: "both" };
  if (front) return { front, written: front, source: "front" };
  return { front, written: null, source: null };
}

export async function syncShadowVariantPrice(opts: {
  shop: string;
  token: string;
  shadowVariantId: string | number;
  baseVariantId: string | number;
  /** Both-tier / Print Side = Both. Applied AFTER the live front read. */
  priceOverride?: string | number | null;
}): Promise<{ front: string | null; written: string | null; source: "both" | "front" | null } | null> {
  const shop = String(opts.shop || "").trim();
  const token = String(opts.token || "").trim();
  const shadowVariantId = String(opts.shadowVariantId || "").replace(/\D/g, "");
  const baseVariantId = String(opts.baseVariantId || "").replace(/\D/g, "");
  if (!shop || !token || !shadowVariantId || !baseVariantId) return null;

  const apiBase = `https://${shop}/admin/api/2025-10`;
  const headers = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": token,
  };

  let liveFront: string | null = null;
  try {
    const res = await fetch(`${apiBase}/variants/${baseVariantId}.json`, { headers });
    if (res.ok) {
      const body = (await res.json()) as { variant?: { price?: string } };
      const n = parseFloat(String(body?.variant?.price ?? ""));
      if (Number.isFinite(n) && n > 0) liveFront = n.toFixed(2);
    } else {
      const t = await res.text();
      console.warn(
        `[ShadowProduct] Live base price fetch failed for ${baseVariantId}:`,
        res.status,
        t.substring(0, 160),
      );
    }
  } catch (e: any) {
    console.warn(
      `[ShadowProduct] Live base price fetch error for ${baseVariantId}:`,
      e?.message || e,
    );
  }

  const decided = resolveShadowSellPrice(liveFront, opts.priceOverride);
  if (!decided.written) {
    console.warn(
      `[ShadowProduct] Skip shadow price write — no live front and no both override (base=${baseVariantId} shadow=${shadowVariantId})`,
    );
    return decided;
  }

  try {
    const put = await fetch(`${apiBase}/variants/${shadowVariantId}.json`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        variant: { id: Number(shadowVariantId), price: decided.written },
      }),
    });
    if (!put.ok) {
      const t = await put.text();
      console.warn(
        `[ShadowProduct] Shadow price PUT failed for ${shadowVariantId}:`,
        put.status,
        t.substring(0, 200),
      );
      return null;
    }
    console.log(
      `[ShadowProduct] Synced shadow ${shadowVariantId} price=${decided.written} source=${decided.source} liveFront=${decided.front ?? "n/a"} base=${baseVariantId}`,
    );
    return decided;
  } catch (e: any) {
    console.warn(
      `[ShadowProduct] Shadow price PUT error for ${shadowVariantId}:`,
      e?.message || e,
    );
    return null;
  }
}
