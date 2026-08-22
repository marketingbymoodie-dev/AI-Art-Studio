/**
 * Studio Credits wallet — bucket-aware grant / spend / clawback.
 *
 * Billing model (one charge per generation):
 * - earned: Reward Ladder credits; burn merchant quota at spend
 * - pack: merchant-mediated packs; billed wholesale at grant; no quota burn at spend
 *
 * credit_balances.credits is the authoritative total for enforcement.
 * earnedCredits + packCredits are bucket breakdowns (should sum to credits).
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { creditBalances, creditLedger, customers, type CreditBalance } from "@shared/schema";
import { storage } from "./storage";

export type CreditSource = "earned" | "pack";

export type GrantStudioCreditsParams = {
  customerId: string;
  amount: number;
  source: CreditSource;
  reason: string;
  idempotencyKey: string;
  shop?: string | null;
  relatedEntityId?: string | null;
  externalRef?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type SpendStudioCreditParams = {
  customerId: string;
  idempotencyKey: string;
  shop?: string | null;
  externalRef?: string | null;
  /** Merchant generation bucket key when burning earned credit quota. */
  quotaBucketKey?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Creator shops pass "pack" so shared earned rewards cannot leave the issuing store. */
  preferSource?: CreditSource;
};

export type ClawbackStudioCreditsParams = {
  customerId: string;
  amount: number;
  /** Prefer clawing from this bucket first (pack refunds → pack). */
  preferSource?: CreditSource;
  reason: string;
  idempotencyKey: string;
  shop?: string | null;
  relatedEntityId?: string | null;
  externalRef?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type SpendResult = {
  spent: boolean;
  /** Which bucket paid for this generation (null if not spent / free gen path). */
  source: CreditSource | null;
  balance: CreditBalance | undefined;
  duplicate: boolean;
};

export type GrantResult = {
  inserted: boolean;
  balance: CreditBalance | undefined;
};

export type ClawbackResult = {
  inserted: boolean;
  clawedFromEarned: number;
  clawedFromPack: number;
  balance: CreditBalance | undefined;
};

function clampNonNeg(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Grant Studio Credits into a bucket and bump the total. Idempotent. */
export async function grantStudioCredits(params: GrantStudioCreditsParams): Promise<GrantResult> {
  const amount = clampNonNeg(params.amount);
  if (amount <= 0) {
    const balance = await storage.ensureCustomerBalance(params.customerId);
    return { inserted: false, balance };
  }

  return db.transaction(async (tx) => {
    await tx
      .insert(creditBalances)
      .values({
        customerId: params.customerId,
        credits: 0,
        earnedCredits: 0,
        packCredits: 0,
        freeGenerationsUsed: 0,
        version: 0,
        updatedAt: new Date(),
      })
      .onConflictDoNothing();

    const [ledgerRow] = await tx
      .insert(creditLedger)
      .values({
        customerId: params.customerId,
        deltaCredits: amount,
        source: params.source,
        shop: params.shop ?? null,
        relatedEntityId: params.relatedEntityId ?? null,
        reason: params.reason,
        idempotencyKey: params.idempotencyKey,
        externalRef: params.externalRef ?? null,
        metadata: params.metadata ?? null,
      })
      .onConflictDoNothing()
      .returning();

    if (!ledgerRow) {
      const [balance] = await tx
        .select()
        .from(creditBalances)
        .where(eq(creditBalances.customerId, params.customerId));
      return { inserted: false, balance };
    }

    const bucketSet =
      params.source === "earned"
        ? { earnedCredits: sql`${creditBalances.earnedCredits} + ${amount}` }
        : { packCredits: sql`${creditBalances.packCredits} + ${amount}` };

    const [balance] = await tx
      .update(creditBalances)
      .set({
        credits: sql`${creditBalances.credits} + ${amount}`,
        ...bucketSet,
        version: sql`${creditBalances.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(creditBalances.customerId, params.customerId))
      .returning();

    await tx
      .update(customers)
      .set({ credits: balance?.credits ?? 0, updatedAt: new Date() })
      .where(eq(customers.id, params.customerId));

    return { inserted: true, balance };
  });
}

/**
 * Spend one Studio Credit: earned first, then pack.
 * Caller is responsible for burning merchant quota when source === "earned".
 */
export async function spendStudioCredit(params: SpendStudioCreditParams): Promise<SpendResult> {
  return db.transaction(async (tx) => {
    await tx
      .insert(creditBalances)
      .values({
        customerId: params.customerId,
        credits: 0,
        earnedCredits: 0,
        packCredits: 0,
        freeGenerationsUsed: 0,
        version: 0,
        updatedAt: new Date(),
      })
      .onConflictDoNothing();

    const [existingLedger] = await tx
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.idempotencyKey, params.idempotencyKey));
    if (existingLedger) {
      const [balance] = await tx
        .select()
        .from(creditBalances)
        .where(eq(creditBalances.customerId, params.customerId));
      const src = (existingLedger.source === "pack" || existingLedger.source === "earned"
        ? existingLedger.source
        : null) as CreditSource | null;
      return { spent: true, source: src, balance, duplicate: true };
    }

    const [current] = await tx
      .select()
      .from(creditBalances)
      .where(eq(creditBalances.customerId, params.customerId));
    if (!current || current.credits <= 0) {
      return { spent: false, source: null, balance: current, duplicate: false };
    }

    let source: CreditSource = current.earnedCredits > 0 ? "earned" : "pack";
    if (params.preferSource === "pack") {
      if (current.packCredits <= 0) {
        return { spent: false, source: null, balance: current, duplicate: false };
      }
      source = "pack";
    }
    if (source === "pack" && current.packCredits <= 0) {
      // Total credits > 0 but buckets empty (legacy row) — treat as earned for quota safety.
      // Still debit total.
    }

    const [balance] = await tx
      .update(creditBalances)
      .set({
        credits: sql`${creditBalances.credits} - 1`,
        earnedCredits:
          source === "earned"
            ? sql`GREATEST(0, ${creditBalances.earnedCredits} - 1)`
            : creditBalances.earnedCredits,
        packCredits:
          source === "pack"
            ? sql`GREATEST(0, ${creditBalances.packCredits} - 1)`
            : creditBalances.packCredits,
        version: sql`${creditBalances.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(creditBalances.customerId, params.customerId), sql`${creditBalances.credits} > 0`))
      .returning();

    if (!balance) {
      return { spent: false, source: null, balance: current, duplicate: false };
    }

    await tx.insert(creditLedger).values({
      customerId: params.customerId,
      deltaCredits: -1,
      source,
      shop: params.shop ?? null,
      quotaBucketKey: params.quotaBucketKey ?? null,
      reason: "generation",
      idempotencyKey: params.idempotencyKey,
      externalRef: params.externalRef ?? null,
      metadata: params.metadata ?? null,
    });

    await tx
      .update(customers)
      .set({
        credits: balance.credits,
        totalGenerations: sql`${customers.totalGenerations} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(customers.id, params.customerId));

    return { spent: true, source, balance, duplicate: false };
  });
}

/**
 * Claw back credits (refund / cancel). Floors at zero — does not create debt.
 * Prefer pack bucket for pack refunds.
 */
export async function clawbackStudioCredits(params: ClawbackStudioCreditsParams): Promise<ClawbackResult> {
  const amount = clampNonNeg(params.amount);
  if (amount <= 0) {
    const balance = await storage.ensureCustomerBalance(params.customerId);
    return { inserted: false, clawedFromEarned: 0, clawedFromPack: 0, balance };
  }

  return db.transaction(async (tx) => {
    await tx
      .insert(creditBalances)
      .values({
        customerId: params.customerId,
        credits: 0,
        earnedCredits: 0,
        packCredits: 0,
        freeGenerationsUsed: 0,
        version: 0,
        updatedAt: new Date(),
      })
      .onConflictDoNothing();

    const [ledgerRow] = await tx
      .insert(creditLedger)
      .values({
        customerId: params.customerId,
        deltaCredits: -amount,
        source: params.preferSource ?? null,
        shop: params.shop ?? null,
        relatedEntityId: params.relatedEntityId ?? null,
        reason: params.reason,
        idempotencyKey: params.idempotencyKey,
        externalRef: params.externalRef ?? null,
        metadata: params.metadata ?? null,
      })
      .onConflictDoNothing()
      .returning();

    if (!ledgerRow) {
      const [balance] = await tx
        .select()
        .from(creditBalances)
        .where(eq(creditBalances.customerId, params.customerId));
      return { inserted: false, clawedFromEarned: 0, clawedFromPack: 0, balance };
    }

    const [current] = await tx
      .select()
      .from(creditBalances)
      .where(eq(creditBalances.customerId, params.customerId));
    if (!current) {
      return { inserted: true, clawedFromEarned: 0, clawedFromPack: 0, balance: undefined };
    }

    let remaining = Math.min(amount, current.credits);
    let fromPack = 0;
    let fromEarned = 0;

    if (params.preferSource === "pack") {
      fromPack = Math.min(remaining, current.packCredits);
      remaining -= fromPack;
      fromEarned = Math.min(remaining, current.earnedCredits);
      remaining -= fromEarned;
    } else {
      fromEarned = Math.min(remaining, current.earnedCredits);
      remaining -= fromEarned;
      fromPack = Math.min(remaining, current.packCredits);
      remaining -= fromPack;
    }
    // Any leftover against total (orphaned total without buckets) comes from total only.
    const totalDebit = fromEarned + fromPack + remaining;

    const [balance] = await tx
      .update(creditBalances)
      .set({
        credits: sql`GREATEST(0, ${creditBalances.credits} - ${totalDebit})`,
        earnedCredits: sql`GREATEST(0, ${creditBalances.earnedCredits} - ${fromEarned})`,
        packCredits: sql`GREATEST(0, ${creditBalances.packCredits} - ${fromPack})`,
        version: sql`${creditBalances.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(creditBalances.customerId, params.customerId))
      .returning();

    await tx
      .update(customers)
      .set({ credits: balance?.credits ?? 0, updatedAt: new Date() })
      .where(eq(customers.id, params.customerId));

    return {
      inserted: true,
      clawedFromEarned: fromEarned,
      clawedFromPack: fromPack,
      balance,
    };
  });
}

/** Total Studio Credits shown to the customer (single number). */
export function studioCreditsBalance(balance: CreditBalance | null | undefined): number {
  return Math.max(0, balance?.credits ?? 0);
}
