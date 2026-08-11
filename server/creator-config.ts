/**
 * Creator Marketplace runtime config.
 * Feature is off unless CREATOR_MARKETPLACE_ENABLED=true (or "1").
 */
import { eq } from "drizzle-orm";
import { db } from "./db";
import { platformConfig } from "@shared/schema";
import {
  DEFAULT_AI_GENERATION_COST_USD,
  PLATFORM_CONFIG_KEYS,
} from "@shared/creatorMarketplace";

export function isCreatorMarketplaceEnabled(): boolean {
  const v = (process.env.CREATOR_MARKETPLACE_ENABLED || "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/** Platform Shopify shop that backs all creator storefront checkouts. */
export function getCreatorPlatformShopDomain(): string | null {
  const d = (process.env.CREATOR_PLATFORM_SHOP_DOMAIN || "").trim().toLowerCase();
  return d || null;
}

let cachedAiCost: { value: number; at: number } | null = null;
const AI_COST_CACHE_MS = 60_000;

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
}
