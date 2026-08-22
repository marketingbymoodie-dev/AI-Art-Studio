/**
 * Creator Marketplace runtime config.
 * Feature is off unless CREATOR_MARKETPLACE_ENABLED=true (or "1").
 */
import { eq } from "drizzle-orm";
import { db } from "./db";
import { platformConfig } from "@shared/schema";
import {
  DEFAULT_AI_GENERATION_COST_USD,
  DEFAULT_CREATOR_TRANSACTION_FEE_FIXED_CENTS,
  DEFAULT_CREATOR_TRANSACTION_FEE_PCT,
  PLATFORM_CONFIG_KEYS,
} from "@shared/creatorMarketplace";
import {
  DEFAULT_LANDING_CONTENT,
  mergeLandingContent,
  parseLandingContentJson,
  type LandingContent,
} from "@shared/landingContent";
import {
  DEFAULT_TERMS_CONTENT,
  parseTermsContentJson,
  stampTermsOnSave,
  type TermsContent,
} from "@shared/termsContent";

export function isCreatorMarketplaceEnabled(): boolean {
  const v = (process.env.CREATOR_MARKETPLACE_ENABLED || "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/** Staging/local only — lets the creator cart send a Printify DRAFT without Shopify Admin JWT. */
export function isCreatorCartPrintifyTestOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.NODE_ENV || "development").trim() !== "production") return true;
  const blob = [
    env.RAILWAY_ENVIRONMENT,
    env.RAILWAY_ENVIRONMENT_NAME,
    env.RAILWAY_SERVICE_NAME,
    env.RAILWAY_PUBLIC_DOMAIN,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (blob.includes("staging")) return true;
  const v = (env.CREATOR_CART_PRINTIFY_TEST_OPEN || "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export function requestLooksLikeStagingHost(req: {
  hostname?: string;
  headers?: { host?: unknown };
}): boolean {
  const host = String(req.hostname || req.headers?.host || "").toLowerCase();
  return host.includes("staging");
}

function normalizePlatformShop(shop: string | null | undefined): string {
  return String(shop || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
}

/** Original handle stays the OAuth / token key after the store was renamed. */
const CREATOR_PLATFORM_SHOP_RENAME_ALIASES: Record<string, string[]> = {
  "whi6jd-nv.myshopify.com": ["aiartstudio-creators.myshopify.com"],
  "aiartstudio-creators.myshopify.com": ["whi6jd-nv.myshopify.com"],
};

/** Platform Shopify shop that backs all creator storefront checkouts. */
export function getCreatorPlatformShopDomain(): string | null {
  const d = (process.env.CREATOR_PLATFORM_SHOP_DOMAIN || "").trim().toLowerCase();
  return d || null;
}

/** Env shop plus rename / CREATOR_PLATFORM_SHOP_ALIASES — used for token lookup and webhook shop matching. */
export function getCreatorPlatformShopCandidates(): string[] {
  const primary = normalizePlatformShop(getCreatorPlatformShopDomain());
  if (!primary) return [];
  const extras = (process.env.CREATOR_PLATFORM_SHOP_ALIASES || "")
    .split(",")
    .map((s) => normalizePlatformShop(s))
    .filter(Boolean);
  const known = CREATOR_PLATFORM_SHOP_RENAME_ALIASES[primary] || [];
  const out: string[] = [];
  for (const shop of [primary, ...known, ...extras]) {
    if (shop && !out.includes(shop)) out.push(shop);
    const handle = shop.replace(/\.myshopify\.com$/, "");
    if (handle && handle !== shop && !out.includes(handle)) out.push(handle);
  }
  return out;
}

/**
 * Storefront API access token for the platform shop (custom app on that shop).
 * Prefer CREATOR_STOREFRONT_API_TOKEN — Railway Railpack has intermittently failed
 * builds when only CREATOR_PLATFORM_STOREFRONT_TOKEN is present ("secret … not found").
 */
export function getCreatorPlatformStorefrontToken(): string | null {
  const t = (
    process.env.CREATOR_STOREFRONT_API_TOKEN ||
    process.env.CREATOR_PLATFORM_STOREFRONT_TOKEN ||
    ""
  ).trim();
  return t || null;
}

let cachedAiCost: { value: number; at: number } | null = null;
let cachedTxnFees: { pct: number; fixedCents: number; at: number } | null = null;
const AI_COST_CACHE_MS = 60_000;
const TXN_FEE_CACHE_MS = 60_000;

export async function getAiGenerationCostUsd(): Promise<number> {
  const now = Date.now();
  if (cachedAiCost && now - cachedAiCost.at < AI_COST_CACHE_MS) {
    return cachedAiCost.value;
  }
  try {
    const [row] = await db
      .select()
      .from(platformConfig)
      .where(eq(platformConfig.key, PLATFORM_CONFIG_KEYS.AI_GENERATION_COST_USD))
      .limit(1);
    const parsed = row ? Number(row.value) : NaN;
    const value =
      Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AI_GENERATION_COST_USD;
    cachedAiCost = { value, at: now };
    return value;
  } catch {
    return DEFAULT_AI_GENERATION_COST_USD;
  }
}

export function aiCostUsdToCents(costUsd: number): number {
  return Math.round(Math.max(0, costUsd) * 100);
}

export async function getCreatorTransactionFeeConfig(): Promise<{
  feePct: number;
  feeFixedCents: number;
}> {
  const now = Date.now();
  if (cachedTxnFees && now - cachedTxnFees.at < TXN_FEE_CACHE_MS) {
    return { feePct: cachedTxnFees.pct, feeFixedCents: cachedTxnFees.fixedCents };
  }
  let feePct = DEFAULT_CREATOR_TRANSACTION_FEE_PCT;
  let feeFixedCents = DEFAULT_CREATOR_TRANSACTION_FEE_FIXED_CENTS;
  try {
    const rows = await db
      .select()
      .from(platformConfig)
      .where(
        eq(platformConfig.key, PLATFORM_CONFIG_KEYS.CREATOR_TRANSACTION_FEE_PCT),
      )
      .limit(1);
    const pctRow = rows[0];
    if (pctRow) {
      const parsed = Number(pctRow.value);
      if (Number.isFinite(parsed) && parsed >= 0) feePct = parsed;
    }
    const [fixedRow] = await db
      .select()
      .from(platformConfig)
      .where(
        eq(platformConfig.key, PLATFORM_CONFIG_KEYS.CREATOR_TRANSACTION_FEE_FIXED_CENTS),
      )
      .limit(1);
    if (fixedRow) {
      const parsed = Number(fixedRow.value);
      if (Number.isFinite(parsed) && parsed >= 0) feeFixedCents = Math.round(parsed);
    }
  } catch {
    /* defaults */
  }
  cachedTxnFees = { pct: feePct, fixedCents: feeFixedCents, at: now };
  return { feePct, feeFixedCents };
}

export async function setPlatformConfig(key: string, value: string): Promise<void> {
  await db
    .insert(platformConfig)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: platformConfig.key,
      set: { value, updatedAt: new Date() },
    });
  if (key === PLATFORM_CONFIG_KEYS.AI_GENERATION_COST_USD) {
    cachedAiCost = null;
  }
  if (
    key === PLATFORM_CONFIG_KEYS.CREATOR_TRANSACTION_FEE_PCT ||
    key === PLATFORM_CONFIG_KEYS.CREATOR_TRANSACTION_FEE_FIXED_CENTS
  ) {
    cachedTxnFees = null;
  }
  if (key === PLATFORM_CONFIG_KEYS.LANDING_CONTENT) {
    cachedLanding = null;
  }
  if (key === PLATFORM_CONFIG_KEYS.TERMS_CONTENT) {
    cachedTerms = null;
  }
}

let cachedLanding: { value: LandingContent; at: number } | null = null;
const LANDING_CACHE_MS = 15_000;

export async function getLandingContent(): Promise<LandingContent> {
  const now = Date.now();
  if (cachedLanding && now - cachedLanding.at < LANDING_CACHE_MS) {
    return cachedLanding.value;
  }
  try {
    const [row] = await db
      .select()
      .from(platformConfig)
      .where(eq(platformConfig.key, PLATFORM_CONFIG_KEYS.LANDING_CONTENT))
      .limit(1);
    const value = parseLandingContentJson(row?.value);
    cachedLanding = { value, at: now };
    return value;
  } catch {
    return structuredClone(DEFAULT_LANDING_CONTENT);
  }
}

export async function saveLandingContent(raw: unknown): Promise<LandingContent> {
  const value = mergeLandingContent(raw);
  await setPlatformConfig(PLATFORM_CONFIG_KEYS.LANDING_CONTENT, JSON.stringify(value));
  cachedLanding = { value, at: Date.now() };
  return value;
}

let cachedTerms: { value: TermsContent; at: number } | null = null;
const TERMS_CACHE_MS = 15_000;

export async function getTermsContent(): Promise<TermsContent> {
  const now = Date.now();
  if (cachedTerms && now - cachedTerms.at < TERMS_CACHE_MS) {
    return cachedTerms.value;
  }
  try {
    const [row] = await db
      .select()
      .from(platformConfig)
      .where(eq(platformConfig.key, PLATFORM_CONFIG_KEYS.TERMS_CONTENT))
      .limit(1);
    const value = parseTermsContentJson(row?.value);
    cachedTerms = { value, at: now };
    return value;
  } catch {
    return structuredClone(DEFAULT_TERMS_CONTENT);
  }
}

export async function saveTermsContent(raw: unknown): Promise<TermsContent> {
  const previous = await getTermsContent();
  const value = stampTermsOnSave(raw, previous);
  await setPlatformConfig(PLATFORM_CONFIG_KEYS.TERMS_CONTENT, JSON.stringify(value));
  cachedTerms = { value, at: Date.now() };
  return value;
}
