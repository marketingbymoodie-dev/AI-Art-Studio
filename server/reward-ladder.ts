/**
 * Reward Ladder — Studio Credits earning rungs.
 *
 * Rung keys (Phase 1):
 *   - free_anonymous     : the storefront free-gen allowance (mirrors installation.storefrontFreeGensPerVisitor).
 *                          Not granted through this module (free gens are tracked on credit_balances.freeGenerationsUsed);
 *                          the rung row exists so the admin UI can display / disable it.
 *   - email_signup       : granted once per customer after Studio Art Class newsletter signup
 *                          (platform-funded pack credits — does not burn shop quota).
 *   - share_design       : one credit per distinct shared design that gets a
 *                          non-owner view. Keyed on shareId (not visitor/session).
 *   - purchase_threshold : granted after a paid Shopify order's USD-equivalent
 *                          (pinned shipping FX) clears `thresholdCents` (USD cents).
 *                          Repeatable per distinct order id. Kill switch:
 *                          PURCHASE_REWARDS_ENABLED=false.
 *
 * Grants are always idempotent:
 *   - email_signup: UNIQUE (shop, customer_id, rung_key) — once per customer per shop.
 *   - share_design / purchase_threshold: UNIQUE (…, related_entity_id) after the listed
 *     SQL in server/migrations/reward-grants-repeatable-rungs.sql (not auto-run).
 *   - credit_ledger idempotency_key includes related entity for those two rungs.
 */
import { and, eq, inArray, like, or } from "drizzle-orm";
import { db, pool } from "./db";
import { rewardGrants, rewardLadderRungs, type RewardLadderRung } from "@shared/schema";
import { grantStudioCredits, clawbackStudioCredits, type CreditSource } from "./studio-credits";
import { storage } from "./storage";
import { clampStorefrontFreeGens, STOREFRONT_FREE_GENERATION_DEFAULT } from "@shared/storefront-credits";
import { normalizeMyshopifyShopDomain } from "./shopDomain";
import {
  isRepeatableRewardRung,
  purchaseRelatedEntityId,
  shareDesignRelatedEntityId,
  shareGrantMatchesShareId,
  shopCentsToUsdCents,
} from "@shared/reward-grants";
import { readPinnedUsdToCurrency } from "./pinned-fx";

export type RewardRungKey =
  | "free_anonymous"
  | "email_signup"
  | "share_design"
  | "purchase_threshold";

export type RewardRungConfig = {
  rungKey: RewardRungKey;
  enabled: boolean;
  creditAmount: number;
  thresholdCents?: number | null;
  sortOrder: number;
};

/** Kill switch: unset or any value other than "false" means purchase rewards are available. */
const PURCHASE_REWARDS_ENABLED = () => process.env.PURCHASE_REWARDS_ENABLED !== "false";

export const DEFAULT_RUNGS: RewardRungConfig[] = [
  {
    rungKey: "free_anonymous",
    enabled: true,
    creditAmount: STOREFRONT_FREE_GENERATION_DEFAULT,
    sortOrder: 0,
  },
  {
    rungKey: "email_signup",
    enabled: true,
    creditAmount: 1,
    sortOrder: 10,
  },
  {
    rungKey: "share_design",
    enabled: true,
    creditAmount: 1,
    sortOrder: 20,
  },
  {
    rungKey: "purchase_threshold",
    enabled: false,
    creditAmount: 1,
    thresholdCents: 5000,
    sortOrder: 30,
  },
];

function normalizeShop(shop: string): string {
  return normalizeMyshopifyShopDomain(shop) || String(shop || "").trim().toLowerCase();
}

export function serializeRewardRung(r: RewardLadderRung) {
  return {
    id: r.id,
    shop: r.shop,
    rungKey: r.rungKey as RewardRungKey,
    enabled: !!r.enabled,
    creditAmount: Math.max(0, Math.floor(Number(r.creditAmount) || 0)),
    thresholdCents:
      r.thresholdCents == null ? null : Math.max(0, Math.floor(Number(r.thresholdCents))),
    sortOrder: Number(r.sortOrder) || 0,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** Move legacy shop-key rows onto the canonical `{handle}.myshopify.com`. */
async function migrateRewardLadderShopAliases(normShop: string, rawShop: string): Promise<void> {
  const aliases = Array.from(
    new Set(
      [rawShop, String(rawShop || "").trim().toLowerCase()]
        .map((s) => String(s || "").trim())
        .filter((s) => s && s !== normShop),
    ),
  );
  for (const alias of aliases) {
    await pool.query(
      `UPDATE reward_ladder_rungs AS src
          SET shop = $1, updated_at = NOW()
        WHERE src.shop = $2
          AND NOT EXISTS (
            SELECT 1 FROM reward_ladder_rungs dst
             WHERE dst.shop = $1 AND dst.rung_key = src.rung_key
          )`,
      [normShop, alias],
    );
  }
}

/** Small blocklist of common disposable inbox domains (best-effort spam guard). */
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "10minutemail.com",
  "10minutemail.net",
  "getnada.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.info",
  "guerrillamail.biz",
  "guerrillamail.org",
  "sharklasers.com",
  "mailinator.com",
  "mailinator.net",
  "maildrop.cc",
  "yopmail.com",
  "yopmail.net",
  "trashmail.com",
  "trashmail.net",
  "temp-mail.org",
  "tempmail.com",
  "tempmail.net",
  "tempinbox.com",
  "throwawaymail.com",
  "fakeinbox.com",
  "dispostable.com",
  "moakt.com",
  "mintemail.com",
  "spam4.me",
  "spambog.com",
  "spamgourmet.com",
]);

export function isDisposableEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  return DISPOSABLE_EMAIL_DOMAINS.has(email.slice(at + 1).trim().toLowerCase());
}

/**
 * Canonical email for dedupe:
 *   - lower-cased
 *   - strip +tag on local part
 *   - collapse gmail / googlemail dots
 * Returns null when the input is not a well-formed email.
 */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = String(email).trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;
  let local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const plusIdx = local.indexOf("+");
  if (plusIdx > 0) local = local.slice(0, plusIdx);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "");
  }
  if (!local) return null;
  return `${local}@${domain}`;
}

/** Ensure the four default rungs exist for a shop. Free-anonymous inherits the merchant's free-gen limit. */
export async function ensureRewardLadder(shop: string): Promise<RewardLadderRung[]> {
  const normShop = normalizeShop(shop);
  if (!normShop) return [];
  await migrateRewardLadderShopAliases(normShop, shop);

  const existing = await db.select().from(rewardLadderRungs).where(eq(rewardLadderRungs.shop, normShop));
  const existingKeys = new Set(existing.map((r) => r.rungKey));

  // Free-anonymous defaults to the merchant's configured free-gen quota so
  // enabling/disabling it stays in lock-step with the plan allotment.
  let freeAnonAmount = STOREFRONT_FREE_GENERATION_DEFAULT;
  try {
    const installation = await storage.getShopifyInstallationByShop(normShop);
    if (installation) {
      freeAnonAmount = clampStorefrontFreeGens(
        (installation as any).storefrontFreeGensPerVisitor ?? STOREFRONT_FREE_GENERATION_DEFAULT,
      );
    }
  } catch {
    // best-effort — fall back to platform default.
  }

  const toInsert = DEFAULT_RUNGS.filter((r) => !existingKeys.has(r.rungKey)).map((r) => ({
    shop: normShop,
    rungKey: r.rungKey,
    enabled: r.rungKey === "purchase_threshold" ? PURCHASE_REWARDS_ENABLED() && r.enabled : r.enabled,
    creditAmount: r.rungKey === "free_anonymous" ? freeAnonAmount : r.creditAmount,
    thresholdCents: r.thresholdCents ?? null,
    sortOrder: r.sortOrder,
  }));

  if (toInsert.length > 0) {
    await db
      .insert(rewardLadderRungs)
      .values(toInsert)
      .onConflictDoNothing();
  }

  return getRewardLadder(normShop);
}

export async function getRewardLadder(shop: string): Promise<RewardLadderRung[]> {
  const normShop = normalizeShop(shop);
  if (!normShop) return [];
  return db.select().from(rewardLadderRungs).where(eq(rewardLadderRungs.shop, normShop));
}

export type RewardRungPatch = Partial<Pick<RewardLadderRung, "enabled" | "creditAmount" | "thresholdCents">>;

export async function patchRewardLadder(
  shop: string,
  updates: Array<{ rungKey: RewardRungKey; patch: RewardRungPatch }>,
): Promise<RewardLadderRung[]> {
  const normShop = normalizeShop(shop);
  if (!normShop) return [];
  await ensureRewardLadder(normShop);
  for (const { rungKey, patch } of updates) {
    const sanitized: RewardRungPatch = {};
    if (typeof patch.enabled === "boolean") sanitized.enabled = patch.enabled;
    if (typeof patch.creditAmount === "number" && Number.isFinite(patch.creditAmount)) {
      sanitized.creditAmount = Math.max(0, Math.min(50, Math.floor(patch.creditAmount)));
    }
    if (patch.thresholdCents === null) {
      sanitized.thresholdCents = null;
    } else if (typeof patch.thresholdCents === "number" && Number.isFinite(patch.thresholdCents)) {
      // $1–$1,000 (cents). Purchase threshold only; other rungs ignore this column.
      sanitized.thresholdCents = Math.max(100, Math.min(100_000, Math.floor(patch.thresholdCents)));
    }
    if (Object.keys(sanitized).length === 0) continue;

    // Purchase-threshold cannot be enabled while the platform flag is off.
    if (rungKey === "purchase_threshold" && sanitized.enabled === true && !PURCHASE_REWARDS_ENABLED()) {
      sanitized.enabled = false;
    }
    const sets: string[] = ["updated_at = NOW()"];
    const vals: unknown[] = [];
    if (sanitized.enabled !== undefined) {
      vals.push(sanitized.enabled);
      sets.push(`enabled = $${vals.length}`);
    }
    if (sanitized.creditAmount !== undefined) {
      vals.push(sanitized.creditAmount);
      sets.push(`credit_amount = $${vals.length}`);
    }
    if (sanitized.thresholdCents !== undefined) {
      vals.push(sanitized.thresholdCents);
      sets.push(`threshold_cents = $${vals.length}`);
    }
    vals.push(normShop, rungKey);
    const shopIdx = vals.length - 1;
    const keyIdx = vals.length;
    const updated = await pool.query<{ id: number; credit_amount: number }>(
      `UPDATE reward_ladder_rungs
          SET ${sets.join(", ")}
        WHERE shop = $${shopIdx} AND rung_key = $${keyIdx}
    RETURNING id, credit_amount`,
      vals,
    );
    if (updated.rowCount === 0) {
      const fallback = DEFAULT_RUNGS.find((r) => r.rungKey === rungKey);
      await pool.query(
        `INSERT INTO reward_ladder_rungs
           (shop, rung_key, enabled, credit_amount, threshold_cents, sort_order, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (shop, rung_key) DO UPDATE SET
           enabled = COALESCE($3, reward_ladder_rungs.enabled),
           credit_amount = COALESCE($4, reward_ladder_rungs.credit_amount),
           threshold_cents = COALESCE($5, reward_ladder_rungs.threshold_cents),
           updated_at = NOW()`,
        [
          normShop,
          rungKey,
          sanitized.enabled ?? fallback?.enabled ?? true,
          sanitized.creditAmount ?? fallback?.creditAmount ?? 1,
          sanitized.thresholdCents !== undefined
            ? sanitized.thresholdCents
            : (fallback?.thresholdCents ?? null),
          fallback?.sortOrder ?? 0,
        ],
      );
    }
  }
  return getRewardLadder(normShop);
}

async function loadEnabledRung(shop: string, rungKey: RewardRungKey): Promise<RewardLadderRung | null> {
  const rungs = await ensureRewardLadder(shop);
  return rungs.find((r) => r.rungKey === rungKey && r.enabled) ?? null;
}

export type GrantRungInput = {
  shop: string;
  customerId: string;
  rungKey: RewardRungKey;
  relatedEntityId?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Default earned (burns merchant/creator quota). Newsletter uses pack (platform-funded). */
  creditSource?: CreditSource;
  /** When set, earned rewards stay on this creator shop. */
  creatorId?: string | null;
};

export type GrantRungResult = {
  granted: boolean;
  duplicate: boolean;
  amount: number;
  reason?: string;
};

/**
 * Grant a rung to a customer.
 * Newsletter: once per shop+customer+rung.
 * Share / purchase: once per shop+customer+rung+relatedEntityId (shareId or order id).
 */
export async function grantRungIfEligible(input: GrantRungInput): Promise<GrantRungResult> {
  const shop = normalizeShop(input.shop);
  if (!shop || !input.customerId) {
    return { granted: false, duplicate: false, amount: 0, reason: "missing shop or customer" };
  }
  const rung = await loadEnabledRung(shop, input.rungKey);
  if (!rung) return { granted: false, duplicate: false, amount: 0, reason: "rung disabled" };
  const amount = Math.max(0, rung.creditAmount || 0);
  if (amount <= 0) return { granted: false, duplicate: false, amount: 0, reason: "amount is zero" };

  const { rewardGrantShopScope } = await import("./creator-earned");
  const source = input.creditSource ?? "earned";
  const isolateToCreator = !!input.creatorId && source === "earned";
  const grantShop = isolateToCreator ? rewardGrantShopScope(shop, input.creatorId) : shop;

  const relatedEntityId = input.relatedEntityId ?? null;
  if (isRepeatableRewardRung(input.rungKey) && !relatedEntityId) {
    return { granted: false, duplicate: false, amount: 0, reason: "missing related entity" };
  }
  const idempotencySuffix =
    isRepeatableRewardRung(input.rungKey) && relatedEntityId ? `:${relatedEntityId}` : "";
  const idempotencyKey = `reward:${input.rungKey}:${grantShop}:${input.customerId}${idempotencySuffix}`;

  const existingGrant = await findExistingRewardGrant({
    grantShop,
    customerId: input.customerId,
    rungKey: input.rungKey,
    relatedEntityId,
  });
  if (existingGrant) {
    return { granted: false, duplicate: true, amount: existingGrant.creditsGranted, reason: "already granted" };
  }

  // Insert reward_grants first (unique / onConflictDoNothing is the race guard).
  const [inserted] = await db
    .insert(rewardGrants)
    .values({
      shop: grantShop,
      customerId: input.customerId,
      rungKey: input.rungKey,
      creditsGranted: amount,
      relatedEntityId,
      idempotencyKey,
    })
    .onConflictDoNothing()
    .returning();
  if (!inserted) {
    return { granted: false, duplicate: true, amount, reason: "grant race lost" };
  }

  if (isolateToCreator && input.creatorId) {
    const { grantCreatorEarned } = await import("./creator-earned");
    const grant = await grantCreatorEarned({
      creatorId: input.creatorId,
      customerId: input.customerId,
      amount,
      idempotencyKey,
      shop: grantShop,
      reason: `reward:${input.rungKey}`,
      relatedEntityId,
      metadata: { ...(input.metadata ?? { rungKey: input.rungKey }), creatorId: input.creatorId },
    });
    return { granted: true, duplicate: !grant.inserted, amount };
  }

  const grant = await grantStudioCredits({
    customerId: input.customerId,
    amount,
    source,
    shop,
    reason: `reward:${input.rungKey}`,
    idempotencyKey,
    relatedEntityId,
    metadata: input.metadata ?? { rungKey: input.rungKey },
  });

  return { granted: true, duplicate: !grant.inserted, amount };
}

async function findExistingRewardGrant(params: {
  grantShop: string;
  customerId: string;
  rungKey: RewardRungKey;
  relatedEntityId: string | null;
}) {
  const base = and(
    eq(rewardGrants.shop, params.grantShop),
    eq(rewardGrants.customerId, params.customerId),
    eq(rewardGrants.rungKey, params.rungKey),
  );
  if (params.rungKey === "share_design" && params.relatedEntityId) {
    const shareId = shareDesignRelatedEntityId(params.relatedEntityId);
    const rows = await db
      .select()
      .from(rewardGrants)
      .where(
        and(
          base,
          or(
            eq(rewardGrants.relatedEntityId, shareId),
            like(rewardGrants.relatedEntityId, `${shareId}:%`),
          ),
        ),
      );
    return rows.find((r) => shareGrantMatchesShareId(r.relatedEntityId, shareId)) ?? null;
  }
  if (params.rungKey === "purchase_threshold" && params.relatedEntityId) {
    const [row] = await db
      .select()
      .from(rewardGrants)
      .where(and(base, eq(rewardGrants.relatedEntityId, params.relatedEntityId)));
    return row ?? null;
  }
  const [row] = await db.select().from(rewardGrants).where(base);
  return row ?? null;
}

export async function tryGrantEmailSignup(
  shop: string,
  customerId: string,
  email: string | null | undefined,
): Promise<GrantRungResult> {
  const normEmail = normalizeEmail(email);
  if (!normEmail) return { granted: false, duplicate: false, amount: 0, reason: "invalid email" };
  if (isDisposableEmail(normEmail)) {
    return { granted: false, duplicate: false, amount: 0, reason: "disposable email" };
  }
  return grantRungIfEligible({
    shop,
    customerId,
    rungKey: "email_signup",
    relatedEntityId: normEmail,
    metadata: { email: normEmail, platformFunded: true },
    creditSource: "pack",
  });
}

/**
 * Grant share_design to the sharer when a *different* visitor opens the share link.
 * The sharer is identified by ownerCustomerId stored on the shared_designs row
 * (set at share-create time, see /api/designs/share).
 */
export async function tryGrantShareDesign(params: {
  shop: string;
  ownerCustomerId: string | null | undefined;
  visitorCustomerId?: string | null;
  visitorKey: string | null | undefined;
  shareId: string;
  creatorId?: string | null;
}): Promise<GrantRungResult> {
  const { shop, ownerCustomerId, visitorCustomerId, visitorKey, shareId } = params;
  if (!ownerCustomerId) return { granted: false, duplicate: false, amount: 0, reason: "no owner" };
  if (!visitorKey && !visitorCustomerId) {
    return { granted: false, duplicate: false, amount: 0, reason: "no visitor identity" };
  }
  // Reject if visitor is the sharer.
  if (visitorCustomerId && visitorCustomerId === ownerCustomerId) {
    return { granted: false, duplicate: false, amount: 0, reason: "visitor is owner" };
  }
  if (visitorKey && visitorKey === ownerCustomerId) {
    return { granted: false, duplicate: false, amount: 0, reason: "visitor is owner" };
  }
  // Keyed on shareId only. shareId:visitor would pay per incognito/self-session.
  return grantRungIfEligible({
    shop,
    customerId: ownerCustomerId,
    rungKey: "share_design",
    relatedEntityId: shareDesignRelatedEntityId(shareId),
    metadata: { shareId, visitorCustomerId: visitorCustomerId ?? null, visitorKey: visitorKey ?? null },
    creatorId: params.creatorId,
  });
}

/**
 * Grant purchase_threshold when an order clears the merchant threshold.
 * Kill-switch with PURCHASE_REWARDS_ENABLED=false.
 */
export async function tryGrantPurchaseThreshold(params: {
  shop: string;
  customerId: string;
  orderId: string;
  subtotalCents: number;
  /** Shopify shop/presentment currency of subtotalCents. */
  currency?: string | null;
  creatorId?: string | null;
}): Promise<GrantRungResult> {
  if (!PURCHASE_REWARDS_ENABLED()) {
    return { granted: false, duplicate: false, amount: 0, reason: "purchase rewards disabled" };
  }
  const shop = normalizeShop(params.shop);
  const rung = await loadEnabledRung(shop, "purchase_threshold");
  if (!rung) return { granted: false, duplicate: false, amount: 0, reason: "rung disabled" };
  const thresholdUsdCents = rung.thresholdCents ?? 5000;
  const currency = String(params.currency || "USD").trim().toUpperCase() || "USD";
  const pinnedRate = await readPinnedUsdToCurrency({ currency, shop });
  const usdCents =
    currency === "USD"
      ? Math.round(Number(params.subtotalCents) || 0)
      : shopCentsToUsdCents(params.subtotalCents, pinnedRate);
  if (usdCents == null) {
    return { granted: false, duplicate: false, amount: 0, reason: "no pinned fx" };
  }
  if (usdCents < thresholdUsdCents) {
    return { granted: false, duplicate: false, amount: 0, reason: "below threshold" };
  }
  const orderId = purchaseRelatedEntityId(params.orderId);
  return grantRungIfEligible({
    shop,
    customerId: params.customerId,
    rungKey: "purchase_threshold",
    relatedEntityId: orderId,
    metadata: {
      orderId,
      subtotalCents: params.subtotalCents,
      currency,
      usdCents,
      pinnedRate,
    },
    creatorId: params.creatorId,
  });
}

/**
 * Reverse purchase_threshold grants for a cancelled / refunded order.
 * Idempotent via caller-provided idempotencyKey (e.g. `clawback:order-cancel:<orderId>`).
 *
 * Finds any reward_grant for purchase_threshold that references the order in `related_entity_id`
 * and issues an equal-amount clawback via studio-credits.
 */
export async function clawbackPurchaseThresholdForOrder(params: {
  shop: string;
  orderId: string;
  reason: string;
  idempotencyKey: string;
}): Promise<{ clawedGrants: number }> {
  const shop = normalizeShop(params.shop);
  const orderId = purchaseRelatedEntityId(params.orderId);
  const raw = String(params.orderId || "").trim();
  const orderKeys = Array.from(
    new Set([orderId, raw, orderId ? `gid://shopify/Order/${orderId}` : ""].filter(Boolean)),
  );
  const grants = await db
    .select()
    .from(rewardGrants)
    .where(
      and(
        eq(rewardGrants.rungKey, "purchase_threshold"),
        inArray(rewardGrants.relatedEntityId, orderKeys),
      ),
    );
  let clawed = 0;
  for (const g of grants) {
    if ((g.creditsGranted ?? 0) <= 0) continue;
    const { creatorIdFromRewardGrantShop, clawbackCreatorEarned } = await import("./creator-earned");
    const creatorId = creatorIdFromRewardGrantShop(g.shop);
    if (creatorId) {
      await clawbackCreatorEarned({
        creatorId,
        customerId: g.customerId,
        amount: g.creditsGranted,
        idempotencyKey: `${params.idempotencyKey}:${g.customerId}`,
        shop: g.shop,
        reason: params.reason,
        relatedEntityId: orderId,
      });
      clawed++;
      continue;
    }
    if (g.shop !== shop) continue;
    await clawbackStudioCredits({
      customerId: g.customerId,
      amount: g.creditsGranted,
      preferSource: "earned",
      reason: params.reason,
      idempotencyKey: `${params.idempotencyKey}:${g.customerId}`,
      shop,
      relatedEntityId: orderId,
      metadata: { rungKey: "purchase_threshold", grantId: g.id },
    });
    clawed++;
  }
  return { clawedGrants: clawed };
}
