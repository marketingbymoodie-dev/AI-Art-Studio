/**
 * Webhook HMAC is accepted only from the app that shop installed.
 * A shop with no recorded app still accepts any configured secret, then
 * records the secret that matched so the next call is bound.
 */
import type { Request } from "express";
import { storage } from "./storage";
import {
  matchAppByBase64Hmac,
  shopAcceptsApp,
  type ShopifyAppCredentials,
} from "./shopify-app-credentials";

function rawBody(req: Request): Buffer {
  const raw = (req as { rawBody?: Buffer | string }).rawBody;
  if (Buffer.isBuffer(raw)) return raw;
  if (typeof raw === "string") return Buffer.from(raw, "utf8");
  return Buffer.from(JSON.stringify(req.body ?? {}), "utf8");
}

function headerShop(req: Request): string {
  const header = req.headers["x-shopify-shop-domain"];
  const shop = Array.isArray(header) ? header[0] : header;
  return String(shop || "").trim().toLowerCase();
}

export async function acceptShopifyWebhook(req: Request): Promise<ShopifyAppCredentials | null> {
  const hmacHeader = req.headers["x-shopify-hmac-sha256"];
  const hmac = Array.isArray(hmacHeader) ? hmacHeader[0] : hmacHeader;
  if (!hmac) return null;
  const matched = matchAppByBase64Hmac(rawBody(req), hmac);
  if (!matched) return null;

  const shop = headerShop(req);
  if (!shop) return matched;

  const installation = await storage.getShopifyInstallationByShop(shop);
  if (!installation) return matched;
  if (!shopAcceptsApp(installation.shopifyApp, matched.label)) return null;
  if (!installation.shopifyApp) {
    await storage.updateShopifyInstallation(installation.id, { shopifyApp: matched.label });
  }
  return matched;
}
