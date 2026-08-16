/**
 * Creator Marketplace Phase 9 — Partner Program, payouts, beta lifecycle actions.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import {
  CREATOR_BETA_ACTIONS,
  CREATOR_PAYOUT_STATUSES,
  CREATOR_SHARE_BASES,
  DEFAULT_CREATOR_BETA_DAYS,
  type CreatorBetaAction,
  type CreatorPayoutStatus,
  type CreatorShareBasis,
} from "@shared/creatorMarketplace";
import { creatorOrders, creatorPayouts, creators, type Creator } from "@shared/schema";
import { db } from "./db";
import { invalidateCreatorHostCache } from "./creator-host";
import { queueCreatorEmail } from "./creator-emails";

export function isCreatorBetaAction(v: string): v is CreatorBetaAction {
  return (CREATOR_BETA_ACTIONS as readonly string[]).includes(v);
}

export async function getCreatorPayoutSummary(creatorId: string): Promise<{
  earnedShareCents: number;
  paidOutCents: number;
  pendingPayoutCents: number;
  outstandingCents: number;
}> {
  const [earn] = await db
    .select({
      total: sql<number>`coalesce(sum(${creatorOrders.creatorShareCents}), 0)::int`,
    })
    .from(creatorOrders)
    .where(eq(creatorOrders.creatorId, creatorId));

  const [paid] = await db
    .select({
      total: sql<number>`coalesce(sum(${creatorPayouts.amountCents}), 0)::int`,
    })
    .from(creatorPayouts)
    .where(
      and(eq(creatorPayouts.creatorId, creatorId), eq(creatorPayouts.status, "paid")),
    );

  const [pending] = await db
    .select({
      total: sql<number>`coalesce(sum(${creatorPayouts.amountCents}), 0)::int`,
    })
    .from(creatorPayouts)
    .where(
      and(eq(creatorPayouts.creatorId, creatorId), eq(creatorPayouts.status, "pending")),
    );

  const earnedShareCents = Number(earn?.total || 0);
  const paidOutCents = Number(paid?.total || 0);
  const pendingPayoutCents = Number(pending?.total || 0);
  return {
    earnedShareCents,
    paidOutCents,
    pendingPayoutCents,
    outstandingCents: Math.max(0, earnedShareCents - paidOutCents - pendingPayoutCents),
  };
}

export async function listCreatorPayouts(creatorId: string, limit = 50) {
  return db
    .select()
    .from(creatorPayouts)
    .where(eq(creatorPayouts.creatorId, creatorId))
    .orderBy(desc(creatorPayouts.createdAt))
    .limit(Math.min(100, Math.max(1, limit)));
}

export async function recordCreatorPayout(params: {
  creatorId: string;
  amountCents: number;
  method?: string | null;
  adminNote?: string | null;
  status?: CreatorPayoutStatus;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  markPaid?: boolean;
}): Promise<typeof creatorPayouts.$inferSelect> {
  const amount = Math.max(0, Math.round(params.amountCents));
  if (amount <= 0) throw new Error("amountCents must be positive");
  const status =
    params.markPaid
      ? "paid"
      : params.status && (CREATOR_PAYOUT_STATUSES as readonly string[]).includes(params.status)
        ? params.status
        : "pending";
  const [row] = await db
    .insert(creatorPayouts)
    .values({
      creatorId: params.creatorId,
      amountCents: amount,
      method: params.method ? String(params.method).slice(0, 80) : null,
      adminNote: params.adminNote ? String(params.adminNote).slice(0, 2000) : null,
      status,
      periodStart: params.periodStart || null,
      periodEnd: params.periodEnd || null,
      paidAt: status === "paid" ? new Date() : null,
    })
    .returning();
  return row;
}

export async function updateCreatorPayoutStatus(params: {
  payoutId: string;
  creatorId: string;
  status: CreatorPayoutStatus;
}): Promise<typeof creatorPayouts.$inferSelect | null> {
  if (!(CREATOR_PAYOUT_STATUSES as readonly string[]).includes(params.status)) {
    throw new Error("Invalid payout status");
  }
  const [row] = await db
    .update(creatorPayouts)
    .set({
      status: params.status,
      paidAt: params.status === "paid" ? new Date() : null,
    })
    .where(
      and(
        eq(creatorPayouts.id, params.payoutId),
        eq(creatorPayouts.creatorId, params.creatorId),
      ),
    )
    .returning();
  return row || null;
}

export function parseSharePatch(body: Record<string, unknown>): {
  shareBasis?: CreatorShareBasis;
  revenueShareCreatorPct?: number;
  revenueShareAasPct?: number;
} {
  const out: {
    shareBasis?: CreatorShareBasis;
    revenueShareCreatorPct?: number;
    revenueShareAasPct?: number;
  } = {};
  if (body.shareBasis != null) {
    const b = String(body.shareBasis);
    if ((CREATOR_SHARE_BASES as readonly string[]).includes(b)) {
      out.shareBasis = b as CreatorShareBasis;
    }
  }
  if (body.revenueShareCreatorPct != null) {
    out.revenueShareCreatorPct = Math.min(
      100,
      Math.max(0, Math.round(Number(body.revenueShareCreatorPct))),
    );
  }
  if (body.revenueShareAasPct != null) {
    out.revenueShareAasPct = Math.min(
      100,
      Math.max(0, Math.round(Number(body.revenueShareAasPct))),
    );
  }
  if (
    out.revenueShareCreatorPct != null &&
    out.revenueShareAasPct == null &&
    body.revenueShareAasPct === undefined
  ) {
    out.revenueShareAasPct = 100 - out.revenueShareCreatorPct;
  }
  if (
    out.revenueShareAasPct != null &&
    out.revenueShareCreatorPct == null &&
    body.revenueShareCreatorPct === undefined
  ) {
    out.revenueShareCreatorPct = 100 - out.revenueShareAasPct;
  }
  return out;
}

/** Apply a beta / partner lifecycle action. */
export async function applyCreatorBetaAction(params: {
  creator: Creator;
  action: CreatorBetaAction;
  extendDays?: number;
}): Promise<Creator> {
  const { creator, action } = params;
  const patch: Partial<typeof creators.$inferInsert> = { updatedAt: new Date() };
  const now = new Date();

  switch (action) {
    case "end_beta":
      patch.status = "beta_completed";
      patch.betaEndAt = now;
      break;
    case "extend_beta": {
      const days = Math.min(365, Math.max(1, Math.round(params.extendDays || 30)));
      const base =
        creator.betaEndAt && new Date(creator.betaEndAt).getTime() > now.getTime()
          ? new Date(creator.betaEndAt)
          : now;
      const end = new Date(base);
      end.setUTCDate(end.getUTCDate() + days);
      patch.status = "active_beta";
      if (!creator.betaStartAt) patch.betaStartAt = now;
      patch.betaEndAt = end;
      break;
    }
    case "promote_partner":
      patch.status = "partner";
      patch.agreementStatus = "active";
      patch.agreementStartAt = now;
      break;
    case "pause":
      patch.status = "paused";
      break;
    case "archive":
      patch.status = "archived";
      break;
    case "reactivate_beta": {
      const days = Math.min(365, Math.max(1, Math.round(params.extendDays || DEFAULT_CREATOR_BETA_DAYS)));
      const end = new Date(now);
      end.setUTCDate(end.getUTCDate() + days);
      patch.status = "active_beta";
      patch.betaStartAt = now;
      patch.betaEndAt = end;
      break;
    }
    default:
      throw new Error("Unknown action");
  }

  const [updated] = await db
    .update(creators)
    .set(patch)
    .where(eq(creators.id, creator.id))
    .returning();

  invalidateCreatorHostCache(updated.username);

  if (action === "promote_partner") {
    void queueCreatorEmail({
      creatorId: updated.id,
      templateKey: "partner_welcome",
    }).catch(() => {});
  }
  if (action === "end_beta") {
    void queueCreatorEmail({
      creatorId: updated.id,
      templateKey: "beta_ended",
    }).catch(() => {});
  }

  return updated;
}
