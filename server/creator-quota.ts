/**
 * Creator Marketplace dual quotas:
 * 1) Creator monthly storefront generation allowance
 * 2) Per-(creator, customer) free generations
 *
 * Merchant shop free-gens / plan quota stay untouched for non-creator flows.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { creatorCustomerFreeGens, creators } from "@shared/schema";
import {
  clampFreeGensPerCustomer,
  clampMonthlyGenerationAllowance,
} from "@shared/creatorMarketplace";

export type CreatorRow = typeof creators.$inferSelect;

export function currentGenerationMonthKey(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export type CreatorMonthlyPeek = {
  allowed: boolean;
  month: string;
  used: number;
  allowance: number;
  remaining: number;
  error?: "CREATOR_MONTHLY_EXHAUSTED";
  message?: string;
};

export async function peekCreatorMonthlyAllowance(
  creator: CreatorRow,
): Promise<CreatorMonthlyPeek> {
  const month = currentGenerationMonthKey();
  const allowance = clampMonthlyGenerationAllowance(creator.monthlyGenerationAllowance);
  const used =
    creator.generationMonth === month ? creator.monthlyGenerationsUsed || 0 : 0;
  const remaining = Math.max(0, allowance - used);
  if (remaining <= 0) {
    return {
      allowed: false,
      month,
      used,
      allowance,
      remaining: 0,
      error: "CREATOR_MONTHLY_EXHAUSTED",
      message:
        "This creator shop is busy right now — the monthly generation budget is used up. Please try again later.",
    };
  }
  return { allowed: true, month, used, allowance, remaining };
}

/** Consume 1 from the creator's monthly allowance (rolls month if needed). */
export async function consumeCreatorMonthlyAllowance(
  creatorId: string,
): Promise<CreatorMonthlyPeek> {
  const month = currentGenerationMonthKey();

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(creators)
      .where(eq(creators.id, creatorId))
      .limit(1)
      .for("update");

    if (!row) {
      return {
        allowed: false,
        month,
        used: 0,
        allowance: 0,
        remaining: 0,
        error: "CREATOR_MONTHLY_EXHAUSTED" as const,
        message: "Creator not found.",
      };
    }

    const peek = await peekCreatorMonthlyAllowance(row);
    if (!peek.allowed) return peek;

    const nextUsed = peek.used + 1;
    const [updated] = await tx
      .update(creators)
      .set({
        generationMonth: month,
        monthlyGenerationsUsed: nextUsed,
        updatedAt: new Date(),
      })
      .where(eq(creators.id, creatorId))
      .returning();

    return peekCreatorMonthlyAllowance(updated);
  });
}

export type CreatorFreePeek = {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
};

export async function peekCreatorCustomerFreeGens(params: {
  creatorId: string;
  customerId: string;
  freeGensPerCustomer: number;
}): Promise<CreatorFreePeek> {
  const limit = clampFreeGensPerCustomer(params.freeGensPerCustomer);
  const [row] = await db
    .select()
    .from(creatorCustomerFreeGens)
    .where(
      and(
        eq(creatorCustomerFreeGens.creatorId, params.creatorId),
        eq(creatorCustomerFreeGens.customerId, params.customerId),
      ),
    )
    .limit(1);
  const used = row?.used ?? 0;
  if (limit <= 0) {
    return { allowed: false, used, limit: 0, remaining: 0 };
  }
  const remaining = Math.max(0, limit - used);
  return { allowed: remaining > 0, used, limit, remaining };
}

export async function consumeCreatorCustomerFreeGen(params: {
  creatorId: string;
  customerId: string;
  freeGensPerCustomer: number;
}): Promise<{ consumed: boolean; used: number; limit: number }> {
  const limit = clampFreeGensPerCustomer(params.freeGensPerCustomer);
  if (limit <= 0) {
    return { consumed: false, used: 0, limit };
  }

  await db
    .insert(creatorCustomerFreeGens)
    .values({
      creatorId: params.creatorId,
      customerId: params.customerId,
      used: 0,
      updatedAt: new Date(),
    })
    .onConflictDoNothing();

  const [updated] = await db
    .update(creatorCustomerFreeGens)
    .set({
      used: sql`${creatorCustomerFreeGens.used} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(creatorCustomerFreeGens.creatorId, params.creatorId),
        eq(creatorCustomerFreeGens.customerId, params.customerId),
        sql`${creatorCustomerFreeGens.used} < ${limit}`,
      ),
    )
    .returning();

  if (!updated) {
    const peek = await peekCreatorCustomerFreeGens(params);
    return { consumed: false, used: peek.used, limit };
  }
  return { consumed: true, used: updated.used, limit };
}
