/**
 * End-of-month ranked creator P&L report for the operator inbox.
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "./db";
import {
  creatorDailyStats,
  creatorOrders,
  creators,
  platformConfig,
} from "@shared/schema";
import {
  PLATFORM_CONFIG_KEYS,
  creatorPublicName,
} from "@shared/creatorMarketplace";
import { isCreatorMarketplaceEnabled, setPlatformConfig } from "./creator-config";
import { rollupCreatorDailyStats, utcDayKey } from "./creator-analytics";

const TAG = "[creator-monthly-report]";

export type CreatorMonthRow = {
  rank: number;
  creatorId: string;
  username: string;
  displayName: string;
  visitors: number;
  generations: number;
  atcCount: number;
  orders: number;
  salesCents: number;
  productProfitCents: number;
  netProfitCents: number;
  payoutCents: number;
  genCostCents: number;
};

export type CreatorMonthReport = {
  month: string;
  rows: CreatorMonthRow[];
  totals: Omit<CreatorMonthRow, "rank" | "creatorId" | "username" | "displayName">;
};

export function previousUtcMonthKey(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (m === 0) return `${y - 1}-12`;
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function currentUtcMonthKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(yyyyMm: string): { startDay: string; endDayExclusive: string; start: Date; end: Date } {
  const [y, m] = yyyyMm.split("-").map((n) => parseInt(n, 10));
  const startDay = `${yyyyMm}-01`;
  const endDayExclusive =
    m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return {
    startDay,
    endDayExclusive,
    start: new Date(`${startDay}T00:00:00.000Z`),
    end: new Date(`${endDayExclusive}T00:00:00.000Z`),
  };
}

function money(cents: number): string {
  const n = (Number(cents) || 0) / 100;
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

export async function buildCreatorMonthReport(month: string): Promise<CreatorMonthReport> {
  const { startDay, endDayExclusive, start, end } = monthBounds(month);
  const lastDay = utcDayKey(new Date(end.getTime() - 86400000));
  const creatorRows = await db.select().from(creators).limit(500);
  await Promise.all(
    creatorRows.map((c) =>
      rollupCreatorDailyStats({ day: lastDay, creatorId: c.id }).catch(() => {}),
    ),
  );

  const daily = await db
    .select({
      creatorId: creatorDailyStats.creatorId,
      visitors: sql<number>`coalesce(sum(${creatorDailyStats.visitors}), 0)::int`,
      generations: sql<number>`coalesce(sum(${creatorDailyStats.generations}), 0)::int`,
      atcCount: sql<number>`coalesce(sum(${creatorDailyStats.atcCount}), 0)::int`,
      orders: sql<number>`coalesce(sum(${creatorDailyStats.orders}), 0)::int`,
      salesCents: sql<number>`coalesce(sum(${creatorDailyStats.grossCents}), 0)::int`,
      productProfitCents: sql<number>`coalesce(sum(${creatorDailyStats.productProfitCents}), 0)::int`,
      netProfitCents: sql<number>`coalesce(sum(${creatorDailyStats.netContributionCents}), 0)::int`,
      genCostCents: sql<number>`coalesce(sum(${creatorDailyStats.genCostCents}), 0)::int`,
    })
    .from(creatorDailyStats)
    .where(
      and(
        gte(creatorDailyStats.day, startDay),
        lt(creatorDailyStats.day, endDayExclusive),
      ),
    )
    .groupBy(creatorDailyStats.creatorId);

  const payouts = await db
    .select({
      creatorId: creatorOrders.creatorId,
      payoutCents: sql<number>`coalesce(sum(${creatorOrders.creatorShareCents}), 0)::int`,
    })
    .from(creatorOrders)
    .where(and(gte(creatorOrders.createdAt, start), lt(creatorOrders.createdAt, end)))
    .groupBy(creatorOrders.creatorId);

  const dailyMap = new Map(daily.map((r) => [r.creatorId, r]));
  const payoutMap = new Map(payouts.map((r) => [r.creatorId, Number(r.payoutCents) || 0]));

  const unsorted = creatorRows.map((c) => {
    const d = dailyMap.get(c.id);
    return {
      creatorId: c.id,
      username: c.username,
      displayName: creatorPublicName({ username: c.username, branding: c.branding }),
      visitors: Number(d?.visitors) || 0,
      generations: Number(d?.generations) || 0,
      atcCount: Number(d?.atcCount) || 0,
      orders: Number(d?.orders) || 0,
      salesCents: Number(d?.salesCents) || 0,
      productProfitCents: Number(d?.productProfitCents) || 0,
      netProfitCents: Number(d?.netProfitCents) || 0,
      payoutCents: payoutMap.get(c.id) || 0,
      genCostCents: Number(d?.genCostCents) || 0,
    };
  });

  unsorted.sort((a, b) => b.netProfitCents - a.netProfitCents || b.salesCents - a.salesCents);
  const rows = unsorted.map((r, i) => ({ ...r, rank: i + 1 }));

  const totals = rows.reduce(
    (acc, r) => {
      acc.visitors += r.visitors;
      acc.generations += r.generations;
      acc.atcCount += r.atcCount;
      acc.orders += r.orders;
      acc.salesCents += r.salesCents;
      acc.productProfitCents += r.productProfitCents;
      acc.netProfitCents += r.netProfitCents;
      acc.payoutCents += r.payoutCents;
      acc.genCostCents += r.genCostCents;
      return acc;
    },
    {
      visitors: 0,
      generations: 0,
      atcCount: 0,
      orders: 0,
      salesCents: 0,
      productProfitCents: 0,
      netProfitCents: 0,
      payoutCents: 0,
      genCostCents: 0,
    },
  );

  return { month, rows, totals };
}

export function formatCreatorMonthReportText(report: CreatorMonthReport): string {
  const lines = [
    `AI Art Studio — creator month report ${report.month}`,
    `Ranked by net profit (product profit − AI cost). Payout is the creator share of that month.`,
    ``,
    `TOTALS  Sales ${money(report.totals.salesCents)} · Profit ${money(report.totals.productProfitCents)} · Net profit ${money(report.totals.netProfitCents)} · Payout ${money(report.totals.payoutCents)} · ${report.totals.visitors} vis · ${report.totals.generations} gens · ${report.totals.atcCount} ATC · ${report.totals.orders} orders`,
    ``,
  ];
  for (const r of report.rows) {
    lines.push(
      `#${r.rank} ${r.displayName} (@${r.username}) — Sales ${money(r.salesCents)} · Profit ${money(r.productProfitCents)} · Net profit ${money(r.netProfitCents)} · Payout ${money(r.payoutCents)} · ${r.visitors} vis · ${r.generations} gens · ${r.atcCount} ATC · ${r.orders} orders`,
    );
  }
  return lines.join("\n");
}

async function getSentMonth(): Promise<string | null> {
  const [row] = await db
    .select()
    .from(platformConfig)
    .where(eq(platformConfig.key, PLATFORM_CONFIG_KEYS.CREATOR_MONTHLY_REPORT_SENT))
    .limit(1);
  return row?.value || null;
}

async function markSentMonth(month: string): Promise<void> {
  await setPlatformConfig(PLATFORM_CONFIG_KEYS.CREATOR_MONTHLY_REPORT_SENT, month);
}

async function sendReportEmail(report: CreatorMonthReport): Promise<boolean> {
  const to = process.env.FOUNDER_ALERT_EMAIL?.trim();
  const resendKey = process.env.RESEND_API_KEY;
  if (!to || !resendKey) {
    console.warn(`${TAG} FOUNDER_ALERT_EMAIL or RESEND_API_KEY not set — skipping email`);
    return false;
  }
  const text = formatCreatorMonthReportText(report);
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from:
        process.env.SUPPORT_EMAIL_FROM ||
        process.env.CREATOR_EMAIL_FROM ||
        process.env.RESEND_FROM ||
        "AI Art Studio <onboarding@resend.dev>",
      to: [to],
      subject: `[AppAI] Creator month report ${report.month} — ${report.rows.length} shops`,
      text,
    }),
  });
  if (!resp.ok) {
    console.error(`${TAG} Resend ${resp.status}:`, await resp.text());
    return false;
  }
  return true;
}

/** Email last month's ranked report once, after the month closes (UTC day 1–3). */
export async function runCreatorMonthlyReport(opts?: {
  force?: boolean;
  month?: string;
}): Promise<{ ran: boolean; emailed: boolean; month: string; skipped?: string }> {
  if (!isCreatorMarketplaceEnabled()) {
    return { ran: false, emailed: false, month: "", skipped: "marketplace off" };
  }
  const month = opts?.month || previousUtcMonthKey();
  if (!opts?.force && !opts?.month) {
    const day = new Date().getUTCDate();
    if (day > 3) {
      return { ran: false, emailed: false, month, skipped: "not start of month" };
    }
    const sent = await getSentMonth();
    if (sent === month) {
      return { ran: false, emailed: false, month, skipped: "already sent" };
    }
  }

  const report = await buildCreatorMonthReport(month);
  const emailed = await sendReportEmail(report);
  if (emailed || opts?.force) {
    await markSentMonth(month);
  }
  console.log(`${TAG} ${month} rows=${report.rows.length} emailed=${emailed}`);
  return { ran: true, emailed, month };
}
