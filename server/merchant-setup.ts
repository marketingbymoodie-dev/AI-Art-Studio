/**
 * Merchant setup rail — shop readiness flags, silent trial activation, and
 * signed merchant-preview links for customizer pages that aren't public yet.
 *
 * See docs/merchant-setup-rail.md and the "Merchant setup rail" plan for the
 * full flow. Locked rule: a customizer page is never publicly mountable, and
 * generation is capped to the trial/tester bucket, until Printify is
 * connected (isPrintifyConnected below) — "Not now" only dismisses the nag
 * modal, it never unlocks manual-fulfillment mode.
 */
import jwt from "jsonwebtoken";
import { storage } from "./storage";
import { getEffectivePlan } from "./customizer-plans";
import { peekMerchantGenerationQuota } from "./generation-quota";
import { isPrintifyConnected } from "./printify-connection";
import type { Merchant, ShopifyInstallation } from "@shared/schema";

export { isPrintifyConnected };

const PREVIEW_TOKEN_TTL_SECONDS = 60 * 20; // 20 minutes — long enough to load + generate a preview

function getSetupSecret(): string {
  const secret = process.env.APPAI_IDENTITY_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("APPAI_IDENTITY_SECRET or SESSION_SECRET must be set");
    }
    return "appai-dev-identity-secret";
  }
  return secret;
}

/** Loose shop-domain compare: bare handle and *.myshopify.com both match. */
function normalizeShopForCompare(shop: string): string {
  return shop.toLowerCase().replace(/^https?:\/\//, "").replace(/\.myshopify\.com$/, "");
}

/** Sign a short-lived merchant-preview token scoping a single customizer page. */
export function signPreviewToken(shop: string, handle: string): string {
  return jwt.sign({ shop, handle, typ: "appai_preview" }, getSetupSecret(), {
    expiresIn: PREVIEW_TOKEN_TTL_SECONDS,
  });
}

/** Verify a preview token was minted for this exact shop + page handle and hasn't expired. */
export function verifyPreviewToken(
  token: string | undefined | null,
  shop: string,
  handle: string,
): boolean {
  if (!token) return false;
  try {
    const payload = jwt.verify(token, getSetupSecret()) as jwt.JwtPayload;
    if (payload?.typ !== "appai_preview") return false;
    if (typeof payload.shop !== "string" || typeof payload.handle !== "string") return false;
    return (
      normalizeShopForCompare(payload.shop) === normalizeShopForCompare(shop) &&
      payload.handle === handle
    );
  } catch {
    return false;
  }
}

/** Full storefront URL the merchant can open ("See your page") that bypasses the Printify gate. */
export function buildPreviewUrl(shop: string, handle: string): string {
  const token = signPreviewToken(shop, handle);
  return `https://${shop}/pages/${handle}?appai_preview=${encodeURIComponent(token)}`;
}

/** Idempotently start the no-card trial the first time a shop is seen. */
export async function ensureTrialStarted(
  installation: ShopifyInstallation,
): Promise<ShopifyInstallation> {
  const plan = getEffectivePlan(installation as any, installation.shopDomain);
  if (plan.isActive || installation.planName) return installation;

  const updated = await storage.updateShopifyInstallation(installation.id, {
    planName: "trial",
    planStatus: "trialing",
    trialStartedAt: new Date(),
  } as Partial<ShopifyInstallation>);
  return updated ?? installation;
}

export type SetupNextStep = "connect_shopify" | "enable_embed" | "choose_product" | "connect_printify" | "done";

export interface MerchantSetupStatus {
  trialActive: boolean;
  embedEnabledGuess: boolean;
  printifyConnected: boolean;
  pagesCount: number;
  activePagesCount: number;
  /** Imported product types (in-app Preview) — unlocks Setup step 3 without a Live page. */
  productTypesCount: number;
  planName: string | null;
  planStatus: string | null;
  quota: { used: number; limit: number | null; plan: string | null };
  nextStep: SetupNextStep;
  /** False when we only have a placeholder install row (no offline OAuth token yet). */
  shopAuthorized: boolean;
  /** Absolute URL to complete classic OAuth and store an Admin API token. */
  reconnectUrl: string | null;
}

function isShopAuthorized(installation: ShopifyInstallation): boolean {
  const token = installation.accessToken || "";
  return (
    installation.status === "active" &&
    !!token &&
    token !== "NEEDS_RECONNECT"
  );
}

function buildReconnectUrl(shop: string): string {
  const base = (process.env.PUBLIC_APP_URL || process.env.APP_URL || "").replace(/\/$/, "");
  const path = `/shopify/install?shop=${encodeURIComponent(shop)}`;
  return base ? `${base}${path}` : path;
}

/** Aggregate the setup rail's readiness flags for a shop. */
export async function getMerchantSetupStatus(
  installation: ShopifyInstallation,
  merchant: Merchant | null | undefined,
): Promise<MerchantSetupStatus> {
  const plan = getEffectivePlan(installation as any, installation.shopDomain);
  const printifyConnected = isPrintifyConnected(merchant);
  const embedEnabledGuess = !!(installation as any).embedConfirmedAt;
  const shopAuthorized = isShopAuthorized(installation);

  const productTypes = merchant
    ? await storage.getProductTypesByMerchant(merchant.id)
    : [];
  const productTypesCount = productTypes.length;

  const [pagesCount, activePagesCount, quota] = await Promise.all([
    storage.countCustomizerPages(installation.shopDomain),
    storage.countActiveCustomizerPages(installation.shopDomain),
    peekMerchantGenerationQuota(installation),
  ]);

  // Preview / catalogue is not a setup step — after embed + Printify, point merchants to Products.
  let nextStep: SetupNextStep = "done";
  if (!shopAuthorized) nextStep = "connect_shopify";
  else if (!embedEnabledGuess) nextStep = "enable_embed";
  else if (!printifyConnected) nextStep = "connect_printify";

  return {
    trialActive: plan.isActive,
    embedEnabledGuess,
    printifyConnected,
    pagesCount,
    activePagesCount,
    productTypesCount,
    planName: plan.planName,
    planStatus: plan.planStatus,
    quota: {
      used: quota.used,
      limit: Number.isFinite(quota.hardCap) ? quota.hardCap : null,
      plan: quota.planName,
    },
    nextStep,
    shopAuthorized,
    reconnectUrl: shopAuthorized ? null : buildReconnectUrl(installation.shopDomain),
  };
}
