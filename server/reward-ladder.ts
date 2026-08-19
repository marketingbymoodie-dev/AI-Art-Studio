/**
 * Reward Ladder — Studio Credits earning rungs.
 *
 * Rung keys (Phase 1):
 *   - free_anonymous     : the storefront free-gen allowance (mirrors installation.storefrontFreeGensPerVisitor).
 *                          Not granted through this module (free gens are tracked on credit_balances.freeGenerationsUsed);
 *                          the rung row exists so the admin UI can display / disable it.
 *   - email_signup       : granted once per customer after Studio Art Class newsletter signup
 *                          (platform-funded pack credits — does not burn shop quota).
 *   - share_design       : granted to the sharer once a *different* visitor opens the share link.
 *   - purchase_threshold : granted after a paid Shopify order clears `thresholdCents`.
 *                          On by default once order webhooks are available; set
 *                          PURCHASE_REWARDS_ENABLED=false as a kill switch.
 *
 * Grants are always idempotent:
 *   - reward_grants has UNIQUE (shop, customer_id, rung_key) so a rung is granted at most once per customer.
 *   - credit_ledger idempotency_key is derived from the rung + customer + shop (+ related entity when relevant),
 *     so the underlying wallet mutation never double-applies even under retries.
 */
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { rewardGrants, rewardLadderRungs, type RewardLadderRung } from "@shared/schema";
import { grantStudioCredits, clawbackStudioCredits, type CreditSource } from "./studio-credits";
import { storage } from "./storage";
import { clampStorefrontFreeGens, STOREFRONT_FREE_GENERATION_DEFAULT } from "@shared/storefront-credits";

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
  return String(shop || "").trim().toLowerCase();
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
    await db
      .update(rewardLadderRungs)
      .set({ ...sanitized, updatedAt: new Date() })
      .where(and(eq(rewardLadderRungs.shop, normShop), eq(rewardLadderRungs.rungKey, rungKey)));
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
};

export type GrantRungResult = {
  granted: boolean;
  duplicate: boolean;
  amount: number;
  reason?: string;
};

/**
 * Grant a rung to a customer. Idempotent per shop+customer+rungKey.
 * Also idempotent on the underlying ledger via `reward:<rung>:<customer>[:<related>]`.
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

  // Ledger key: for share_design we want ONE grant per sharer (unique on shop+customer+rung),
  // but the specific viewer visit is captured in relatedEntityId. For purchase_threshold we
  // deliberately want per-order grants — the caller supplies a per-order rung customization
  // by passing a rungKey that includes the order id (see tryGrantPurchaseThreshold).
  const relatedEntityId = input.relatedEntityId ?? null;
  const idempotencySuffix = relatedEntityId ? `:${relatedEntityId}` : "";
  const idempotencyKey = `reward:${input.rungKey}:${shop}:${input.customerId}${idempotencySuffix}`;

  // Fast pre-check: bail if we already recorded a reward_grant for this rung.
  const [existingGrant] = await db
    .select()
    .from(rewardGrants)
    .where(
      and(
        eq(rewardGrants.shop, shop),
        eq(rewardGrants.customerId, input.customerId),
        eq(rewardGrants.rungKey, input.rungKey),
      ),
    );
  if (existingGrant) {
    return { granted: false, duplicate: true, amount: existingGrant.creditsGranted, reason: "already granted" };
  }

  // Insert reward_grants first (unique on shop+customer+rung protects us).
  const [inserted] = await db
    .insert(rewardGrants)
    .values({
      shop,
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

  const grant = await grantStudioCredits({
    customerId: input.customerId,
    amount,
    source: input.creditSource ?? "earned",
    shop,
    reason: `reward:${input.rungKey}`,
    idempotencyKey,
    relatedEntityId,
    metadata: input.metadata ?? { rungKey: input.rungKey },
  });

  return { granted: true, duplicate: !grant.inserted, amount };
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
  return grantRungIfEligible({
    shop,
    customerId: ownerCustomerId,
    rungKey: "share_design",
    relatedEntityId: `${shareId}:${visitorKey ?? visitorCustomerId ?? "anon"}`,
    metadata: { shareId, visitorCustomerId: visitorCustomerId ?? null, visitorKey: visitorKey ?? null },
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
}): Promise<GrantRungResult> {
  if (!PURCHASE_REWARDS_ENABLED()) {
    return { granted: false, duplicate: false, amount: 0, reason: "purchase rewards disabled" };
  }
  const shop = normalizeShop(params.shop);
  const rung = await loadEnabledRung(shop, "purchase_threshold");
  if (!rung) return { granted: false, duplicate: false, amount: 0, reason: "rung disabled" };
  const threshold = rung.thresholdCents ?? 0;
  if (params.subtotalCents < threshold) {
    return { granted: false, duplicate: false, amount: 0, reason: "below threshold" };
  }
  // Per-order idempotency: include the orderId in the ledger key by using it as relatedEntityId.
  // (reward_grants unique still allows only ONE purchase_threshold rung ever per customer.)
  return grantRungIfEligible({
    shop,
    customerId: params.customerId,
    rungKey: "purchase_threshold",
    relatedEntityId: params.orderId,
    metadata: { orderId: params.orderId, subtotalCents: params.subtotalCents },
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
  const grants = await db
    .select()
    .from(rewardGrants)
    .where(
      and(
        eq(rewardGrants.shop, shop),
        eq(rewardGrants.rungKey, "purchase_threshold"),
        eq(rewardGrants.relatedEntityId, params.orderId),
      ),
    );
  let clawed = 0;
  for (const g of grants) {
    if ((g.creditsGranted ?? 0) <= 0) continue;
    await clawbackStudioCredits({
      customerId: g.customerId,
      amount: g.creditsGranted,
      preferSource: "earned",
      reason: params.reason,
      idempotencyKey: `${params.idempotencyKey}:${g.customerId}`,
      shop,
      relatedEntityId: params.orderId,
      metadata: { rungKey: "purchase_threshold", grantId: g.id },
    });
    clawed++;
  }
  return { clawedGrants: clawed };
}
