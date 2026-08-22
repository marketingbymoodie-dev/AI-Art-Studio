/**
 * Shop-specific HTTPS webhooks for the creator checkout shop.
 *
 * The Creators clone's Dev Dashboard "Create version" form only sets
 * webhooks.api_version — it cannot edit [[webhooks.subscriptions]].
 * Pushing shopify.app.creators.toml via `shopify:deploy:creators` would also
 * ship checkout UI. Register these on the platform shop with Admin REST instead.
 *
 * Do not call this for merchant shops on the public App Store app (PCD).
 */
import { isCreatorMarketplaceEnabled, getCreatorPlatformShopCandidates } from "./creator-config";
import { isCreatorPlatformShop } from "./creator-host";
import { normalizeMyshopifyShopDomain } from "./shopDomain";
import { ensureValidOfflineAccessToken } from "./shopify-offline-token";
import { storage } from "./storage";

const ADMIN_API_VERSION = "2026-07";

export const CREATOR_CHECKOUT_WEBHOOKS = [
  { topic: "orders/paid", path: "/shopify/webhooks/orders-paid" },
  { topic: "refunds/create", path: "/shopify/webhooks/refunds-create" },
  { topic: "orders/cancelled", path: "/shopify/webhooks/orders-cancelled" },
  { topic: "app/uninstalled", path: "/shopify/webhooks/uninstall" },
] as const;

export type CreatorCheckoutWebhookSpec = (typeof CREATOR_CHECKOUT_WEBHOOKS)[number];

export type EnsureCreatorCheckoutWebhooksResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  shop?: string;
  created: string[];
  existing: string[];
  errors: string[];
};

type ShopifyWebhookRow = {
  id?: number;
  topic?: string;
  address?: string;
};

export function creatorCheckoutWebhookOrigin(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = (env.APP_URL || env.PUBLIC_APP_URL || "").trim();
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

/** Staging/localhost must not rewrite the live checkout shop's webhook URLs. */
export function canRegisterCreatorCheckoutWebhookOrigin(origin: string): boolean {
  const host = origin.replace(/^https?:\/\//, "").split("/")[0] || "";
  if (!host || host === "localhost" || host.startsWith("127.")) return false;
  if (/staging/i.test(host)) return false;
  return origin.startsWith("https://");
}

export function creatorCheckoutWebhookAddress(origin: string, path: string): string {
  const base = origin.replace(/\/$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

export function webhookAlreadyRegistered(
  existing: ShopifyWebhookRow[],
  topic: string,
  address: string,
): boolean {
  const wanted = normalizeWebhookAddress(address);
  return existing.some(
    (row) =>
      String(row.topic || "").toLowerCase() === topic.toLowerCase() &&
      normalizeWebhookAddress(String(row.address || "")) === wanted,
  );
}

function normalizeWebhookAddress(address: string): string {
  try {
    const url = new URL(address);
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/$/, "") || "/";
    return url.toString();
  } catch {
    return address.trim().replace(/\/$/, "");
  }
}

function adminHeaders(accessToken: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": accessToken,
  };
}

async function listWebhooks(shop: string, accessToken: string): Promise<ShopifyWebhookRow[]> {
  const res = await fetch(
    `https://${shop}/admin/api/${ADMIN_API_VERSION}/webhooks.json?limit=250`,
    { headers: adminHeaders(accessToken) },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`List webhooks HTTP ${res.status}: ${text.slice(0, 240)}`);
  }
  const json = JSON.parse(text) as { webhooks?: ShopifyWebhookRow[] };
  return Array.isArray(json.webhooks) ? json.webhooks : [];
}

async function createWebhook(
  shop: string,
  accessToken: string,
  topic: string,
  address: string,
): Promise<void> {
  const res = await fetch(`https://${shop}/admin/api/${ADMIN_API_VERSION}/webhooks.json`, {
    method: "POST",
    headers: adminHeaders(accessToken),
    body: JSON.stringify({
      webhook: { topic, address, format: "json" },
    }),
  });
  const text = await res.text();
  if (res.ok || res.status === 201) return;
  // Duplicate address+topic is already subscribed.
  if (res.status === 422 && /already|taken|been taken/i.test(text)) return;
  throw new Error(`Create ${topic} HTTP ${res.status}: ${text.slice(0, 240)}`);
}

export async function ensureCreatorCheckoutWebhooks(params: {
  shop: string;
  accessToken: string;
  origin?: string | null;
}): Promise<EnsureCreatorCheckoutWebhooksResult> {
  const empty = { created: [] as string[], existing: [] as string[], errors: [] as string[] };
  const shop = normalizeMyshopifyShopDomain(params.shop);
  if (!isCreatorMarketplaceEnabled()) {
    return { ok: true, skipped: true, reason: "marketplace_disabled", ...empty };
  }
  if (!shop || !isCreatorPlatformShop(shop)) {
    return { ok: true, skipped: true, reason: "not_platform_shop", shop, ...empty };
  }

  const origin = (params.origin ?? creatorCheckoutWebhookOrigin()) || "";
  if (!origin || !canRegisterCreatorCheckoutWebhookOrigin(origin)) {
    return { ok: true, skipped: true, reason: "unsafe_origin", shop, ...empty };
  }

  let existing: ShopifyWebhookRow[] = [];
  try {
    existing = await listWebhooks(shop, params.accessToken);
  } catch (e: any) {
    const message = e?.message || String(e);
    console.warn(`[creator-webhooks] list failed for ${shop}:`, message);
    return { ok: false, shop, ...empty, errors: [message] };
  }

  const created: string[] = [];
  const already: string[] = [];
  const errors: string[] = [];

  for (const spec of CREATOR_CHECKOUT_WEBHOOKS) {
    const address = creatorCheckoutWebhookAddress(origin, spec.path);
    if (webhookAlreadyRegistered(existing, spec.topic, address)) {
      already.push(spec.topic);
      continue;
    }
    try {
      await createWebhook(shop, params.accessToken, spec.topic, address);
      created.push(spec.topic);
      existing.push({ topic: spec.topic, address });
    } catch (e: any) {
      const message = `${spec.topic}: ${e?.message || e}`;
      errors.push(message);
      console.warn(`[creator-webhooks] ${shop} ${message}`);
    }
  }

  if (created.length) {
    console.log(`[creator-webhooks] registered on ${shop}:`, created.join(", "));
  }
  if (already.length && !created.length && !errors.length) {
    console.log(`[creator-webhooks] already present on ${shop}:`, already.join(", "));
  }

  return {
    ok: errors.length === 0,
    shop,
    created,
    existing: already,
    errors,
  };
}

export async function ensureCreatorCheckoutWebhooksForPlatformShop(): Promise<EnsureCreatorCheckoutWebhooksResult> {
  const empty = { created: [] as string[], existing: [] as string[], errors: [] as string[] };
  if (!isCreatorMarketplaceEnabled()) {
    return { ok: true, skipped: true, reason: "marketplace_disabled", ...empty };
  }

  const candidates = getCreatorPlatformShopCandidates()
    .map((s) => normalizeMyshopifyShopDomain(s))
    .filter((s) => s.endsWith(".myshopify.com"));
  if (candidates.length === 0) {
    return { ok: true, skipped: true, reason: "platform_shop_missing", ...empty };
  }

  let installation = null;
  for (const candidate of candidates) {
    const row = await storage.getShopifyInstallationByShop(candidate);
    if (row?.accessToken && row.accessToken !== "NEEDS_RECONNECT") {
      installation = row;
      break;
    }
  }
  if (!installation) {
    console.warn(
      `[creator-webhooks] no active install for ${candidates.join(" / ")} — open Setup or reinstall ?app=creators`,
    );
    return { ok: false, skipped: true, reason: "no_install", shop: candidates[0], ...empty };
  }

  const tokenReady = await ensureValidOfflineAccessToken(installation);
  if (!tokenReady.ok) {
    console.warn(`[creator-webhooks] token not ready for ${installation.shopDomain}:`, tokenReady.error);
    return {
      ok: false,
      skipped: true,
      reason: "token_invalid",
      shop: installation.shopDomain,
      ...empty,
      errors: [tokenReady.error],
    };
  }

  return ensureCreatorCheckoutWebhooks({
    shop: installation.shopDomain,
    accessToken: tokenReady.accessToken,
  });
}
