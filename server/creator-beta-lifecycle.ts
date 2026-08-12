/**
 * Creator Marketplace Phase 9 — beta ending reminders + auto beta_completed.
 * Emails are logged; sent only when CREATOR_EMAILS_ENABLED=true.
 */
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { creators } from "@shared/schema";
import { db } from "./db";
import { queueCreatorEmail } from "./creator-emails";
import { invalidateCreatorHostCache } from "./creator-host";
import { isCreatorMarketplaceEnabled } from "./creator-config";

function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function daysUntil(end: Date, now = new Date()): number {
  const a = utcDayStart(now).getTime();
  const b = utcDayStart(end).getTime();
  return Math.round((b - a) / 86400000);
}

export async function runCreatorBetaLifecycle(): Promise<{
  reminded: number;
  completed: number;
}> {
  if (!isCreatorMarketplaceEnabled()) {
    return { reminded: 0, completed: 0 };
  }

  const now = new Date();
  const horizon = new Date(now);
  horizon.setUTCDate(horizon.getUTCDate() + 8);

  const active = await db
    .select()
    .from(creators)
    .where(
      and(
        eq(creators.status, "active_beta"),
        isNotNull(creators.betaEndAt),
        lte(creators.betaEndAt, horizon),
      ),
    )
    .limit(500);

  let reminded = 0;
  let completed = 0;

  for (const c of active) {
    if (!c.betaEndAt) continue;
    const end = new Date(c.betaEndAt);
    const d = daysUntil(end, now);

    if (d < 0 || (d === 0 && end.getTime() <= now.getTime())) {
      const [updated] = await db
        .update(creators)
        .set({ status: "beta_completed", updatedAt: new Date() })
        .where(and(eq(creators.id, c.id), eq(creators.status, "active_beta")))
        .returning();
      if (updated) {
        completed++;
        invalidateCreatorHostCache(updated.username);
        const r = await queueCreatorEmail({
          creatorId: c.id,
          templateKey: "beta_ended",
        });
        if (r.status === "sent" || r.status === "skipped") reminded++;
      }
      continue;
    }

    let template: "beta_ending_7d" | "beta_ending_3d" | "beta_ending_1d" | null = null;
    if (d === 7) template = "beta_ending_7d";
    else if (d === 3) template = "beta_ending_3d";
    else if (d === 1) template = "beta_ending_1d";
    if (!template) continue;

    const r = await queueCreatorEmail({ creatorId: c.id, templateKey: template });
    if (r.status === "sent" || r.status === "skipped" || r.status === "duplicate") {
      if (r.status !== "duplicate") reminded++;
    }
  }

  console.log(`[creator-beta-lifecycle] reminded=${reminded} completed=${completed}`);
  return { reminded, completed };
}
