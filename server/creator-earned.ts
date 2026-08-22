/**
 * Reward-ladder credits scoped to one creator shop.
 * Packs stay on the shared customer wallet; these do not travel.
 */
import { and, eq, sql } from "drizzle-orm";
import { creatorCustomerEarned, creditLedger } from "@shared/schema";
import { db } from "./db";

export function rewardGrantShopScope(shop: string, creatorId?: string | null): string {
  const id = String(creatorId || "").trim();
  if (id) return `creator:${id}`;
  return String(shop || "").trim().toLowerCase();
}

export function creatorIdFromRewardGrantShop(shop: string | null | undefined): string | null {
  const raw = String(shop || "").trim();
  return raw.startsWith("creator:") ? raw.slice("creator:".length) || null : null;
}

export async function peekCreatorEarned(params: {
  creatorId: string;
  customerId: string;
}): Promise<number> {
  const creatorId = String(params.creatorId || "").trim();
  const customerId = String(params.customerId || "").trim();
  if (!creatorId || !customerId) return 0;
  const [row] = await db
    .select()
    .from(creatorCustomerEarned)
    .where(
      and(
        eq(creatorCustomerEarned.creatorId, creatorId),
        eq(creatorCustomerEarned.customerId, customerId),
      ),
    )
    .limit(1);
  return Math.max(0, row?.earnedCredits ?? 0);
}

export async function grantCreatorEarned(params: {
  creatorId: string;
  customerId: string;
  amount: number;
  idempotencyKey: string;
  shop?: string | null;
  reason?: string;
  relatedEntityId?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<{ inserted: boolean; balance: number }> {
  const amount = Number.isFinite(params.amount) ? Math.max(0, Math.floor(params.amount)) : 0;
  const creatorId = String(params.creatorId || "").trim();
  const customerId = String(params.customerId || "").trim();
  if (!creatorId || !customerId || amount <= 0) {
    return { inserted: false, balance: await peekCreatorEarned(params) };
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.idempotencyKey, params.idempotencyKey))
      .limit(1);
    if (existing) {
      return { inserted: false, balance: await peekCreatorEarned(params) };
    }

    await tx
      .insert(creatorCustomerEarned)
      .values({
        creatorId,
        customerId,
        earnedCredits: 0,
        updatedAt: new Date(),
      })
      .onConflictDoNothing();

    const [row] = await tx
      .update(creatorCustomerEarned)
      .set({
        earnedCredits: sql`${creatorCustomerEarned.earnedCredits} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(creatorCustomerEarned.creatorId, creatorId),
          eq(creatorCustomerEarned.customerId, customerId),
        ),
      )
      .returning();

    await tx.insert(creditLedger).values({
      customerId,
      deltaCredits: amount,
      source: "earned",
      shop: params.shop ?? null,
      relatedEntityId: params.relatedEntityId ?? creatorId,
      reason: params.reason || "creator_reward",
      idempotencyKey: params.idempotencyKey,
      metadata: { ...(params.metadata || {}), creatorId },
    });

    return { inserted: true, balance: row?.earnedCredits ?? amount };
  });
}

export async function spendCreatorEarned(params: {
  creatorId: string;
  customerId: string;
  idempotencyKey: string;
  shop?: string | null;
  externalRef?: string | null;
}): Promise<{ spent: boolean; duplicate: boolean; balance: number }> {
  const creatorId = String(params.creatorId || "").trim();
  const customerId = String(params.customerId || "").trim();
  if (!creatorId || !customerId) {
    return { spent: false, duplicate: false, balance: 0 };
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.idempotencyKey, params.idempotencyKey))
      .limit(1);
    if (existing) {
      return { spent: true, duplicate: true, balance: await peekCreatorEarned(params) };
    }

    await tx
      .insert(creatorCustomerEarned)
      .values({
        creatorId,
        customerId,
        earnedCredits: 0,
        updatedAt: new Date(),
      })
      .onConflictDoNothing();

    const [row] = await tx
      .update(creatorCustomerEarned)
      .set({
        earnedCredits: sql`${creatorCustomerEarned.earnedCredits} - 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(creatorCustomerEarned.creatorId, creatorId),
          eq(creatorCustomerEarned.customerId, customerId),
          sql`${creatorCustomerEarned.earnedCredits} > 0`,
        ),
      )
      .returning();

    if (!row) {
      return { spent: false, duplicate: false, balance: 0 };
    }

    await tx.insert(creditLedger).values({
      customerId,
      deltaCredits: -1,
      source: "earned",
      shop: params.shop ?? null,
      relatedEntityId: creatorId,
      reason: "generation",
      idempotencyKey: params.idempotencyKey,
      externalRef: params.externalRef ?? null,
      metadata: { creatorId },
    });

    return { spent: true, duplicate: false, balance: row.earnedCredits };
  });
}

export async function clawbackCreatorEarned(params: {
  creatorId: string;
  customerId: string;
  amount: number;
  idempotencyKey: string;
  shop?: string | null;
  reason?: string;
  relatedEntityId?: string | null;
}): Promise<{ inserted: boolean; clawed: number }> {
  const amount = Number.isFinite(params.amount) ? Math.max(0, Math.floor(params.amount)) : 0;
  const creatorId = String(params.creatorId || "").trim();
  const customerId = String(params.customerId || "").trim();
  if (!creatorId || !customerId || amount <= 0) {
    return { inserted: false, clawed: 0 };
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.idempotencyKey, params.idempotencyKey))
      .limit(1);
    if (existing) {
      return { inserted: false, clawed: Math.abs(existing.deltaCredits || 0) };
    }

    await tx
      .insert(creatorCustomerEarned)
      .values({
        creatorId,
        customerId,
        earnedCredits: 0,
        updatedAt: new Date(),
      })
      .onConflictDoNothing();

    const [current] = await tx
      .select()
      .from(creatorCustomerEarned)
      .where(
        and(
          eq(creatorCustomerEarned.creatorId, creatorId),
          eq(creatorCustomerEarned.customerId, customerId),
        ),
      )
      .limit(1);
    const clawed = Math.min(amount, Math.max(0, current?.earnedCredits ?? 0));
    if (clawed <= 0) {
      return { inserted: false, clawed: 0 };
    }

    await tx
      .update(creatorCustomerEarned)
      .set({
        earnedCredits: sql`GREATEST(0, ${creatorCustomerEarned.earnedCredits} - ${clawed})`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(creatorCustomerEarned.creatorId, creatorId),
          eq(creatorCustomerEarned.customerId, customerId),
        ),
      );

    await tx.insert(creditLedger).values({
      customerId,
      deltaCredits: -clawed,
      source: "earned",
      shop: params.shop ?? null,
      relatedEntityId: params.relatedEntityId ?? creatorId,
      reason: params.reason || "creator_reward_clawback",
      idempotencyKey: params.idempotencyKey,
      metadata: { creatorId },
    });

    return { inserted: true, clawed };
  });
}
