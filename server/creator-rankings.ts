/**
 * Creator Marketplace Phase 7 — network rank snapshots.
 */
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  CREATOR_PORTAL_LOGIN_STATUSES,
  CREATOR_RANK_METRIC_NET_CONTRIBUTION,
  CREATOR_RANK_PERIOD_TYPES,
  computeCreatorRanks,
  dayPeriodKey,
  isoWeekPeriodKey,
  monthPeriodKey,
  titleForRank,
  type CreatorRankPeriodType,
} from "@shared/creatorMarketplace";
import { creatorDailyStats, creatorRankSnapshots, creators } from "@shared/schema";
import { db } from "./db";
import { isCreatorMarketplaceEnabled } from "./creator-config";
import { utcDayKey } from "./creator-analytics";

let lastRankRunAt = 0;
const RANK_DEDUPE_MS = 20 * 60 * 60 * 1000;

function daysAgoUtc(n: number): string {
  return utcDayKey(new Date(Date.now() - n * 86400000));
}

function weekRangeKeys(now = new Date()): { start: string; end: string; key: string } {
  const key = isoWeekPeriodKey(now);
  // Monday of ISO week (UTC)
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  const start = dayPeriodKey(d);
  const endDate = new Date(d);
  endDate.setUTCDate(endDate.getUTCDate() + 6);
  return { start, end: dayPeriodKey(endDate), key };
}

function monthRangeKeys(now = new Date()): { start: string; end: string; key: string } {
  const key = monthPeriodKey(now);
  const start = `${key}-01`;
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { start, end: dayPeriodKey(last), key };
}

async function activeCreatorIds(): Promise<string[]> {
  const rows = await db
    .select({ id: creators.id })
    .from(creators)
    .where(inArray(creators.status, [...CREATOR_PORTAL_LOGIN_STATUSES]));
  return rows.map((r) => r.id);
}

async function sumNetContribution(params: {
  creatorIds: string[];
  startDay?: string;
  endDay?: string;
}): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const id of params.creatorIds) out.set(id, 0);
  if (params.creatorIds.length === 0) return out;

  const IN_CHUNK = 400;
  for (let i = 0; i < params.creatorIds.length; i += IN_CHUNK) {
    const chunk = params.creatorIds.slice(i, i + IN_CHUNK);
    const conditions = [inArray(creatorDailyStats.creatorId, chunk)];
    if (params.startDay) conditions.push(gte(creatorDailyStats.day, params.startDay));
    if (params.endDay) conditions.push(lte(creatorDailyStats.day, params.endDay));

    const rows = await db
      .select({
        creatorId: creatorDailyStats.creatorId,
        total: sql<number>`coalesce(sum(${creatorDailyStats.netContributionCents}), 0)::int`,
      })
      .from(creatorDailyStats)
      .where(and(...conditions))
      .groupBy(creatorDailyStats.creatorId);

    for (const row of rows) {
      out.set(row.creatorId, Number(row.total) || 0);
    }
  }
  return out;
}

async function persistPeriod(params: {
  periodType: CreatorRankPeriodType;
  periodKey: string;
  scores: Map<string, number>;
}): Promise<number> {
  const inputs = [...params.scores.entries()].map(([creatorId, valueCents]) => ({
    creatorId,
    valueCents,
  }));
  const ranked = computeCreatorRanks(inputs, params.periodType);
  const now = new Date();

  // Replace snapshots for this period/metric (delete + insert keeps unique index clean).
  await db
    .delete(creatorRankSnapshots)
    .where(
      and(
        eq(creatorRankSnapshots.periodType, params.periodType),
        eq(creatorRankSnapshots.periodKey, params.periodKey),
        eq(creatorRankSnapshots.metricKey, CREATOR_RANK_METRIC_NET_CONTRIBUTION),
      ),
    );

  if (ranked.length === 0) return 0;

  const INSERT_CHUNK = 100;
  for (let i = 0; i < ranked.length; i += INSERT_CHUNK) {
    const slice = ranked.slice(i, i + INSERT_CHUNK);
    await db.insert(creatorRankSnapshots).values(
      slice.map((r) => ({
        periodType: params.periodType,
        periodKey: params.periodKey,
        metricKey: CREATOR_RANK_METRIC_NET_CONTRIBUTION,
        creatorId: r.creatorId,
        valueCents: r.valueCents,
        value: null,
        rank: r.rank,
        ofCount: r.ofCount,
        percentile: String(r.percentile),
        sharePct: String(r.sharePct),
        computedAt: now,
      })),
    );
  }
  return ranked.length;
}

/** Compute daily/weekly/monthly/lifetime net_contribution snapshots. */
export async function computeCreatorRankSnapshots(opts?: {
  force?: boolean;
}): Promise<{ periods: number; rows: number; skipped?: boolean }> {
  if (!isCreatorMarketplaceEnabled()) {
    return { periods: 0, rows: 0, skipped: true };
  }
  const now = Date.now();
  if (!opts?.force && now - lastRankRunAt < RANK_DEDUPE_MS) {
    return { periods: 0, rows: 0, skipped: true };
  }

  const creatorIds = await activeCreatorIds();
  if (creatorIds.length === 0) {
    lastRankRunAt = now;
    return { periods: 0, rows: 0 };
  }

  const today = dayPeriodKey();
  const week = weekRangeKeys();
  const month = monthRangeKeys();

  const [dailyScores, weeklyScores, monthlyScores, lifetimeScores] = await Promise.all([
    sumNetContribution({ creatorIds, startDay: today, endDay: today }),
    sumNetContribution({ creatorIds, startDay: week.start, endDay: week.end }),
    sumNetContribution({ creatorIds, startDay: month.start, endDay: month.end }),
    sumNetContribution({ creatorIds }),
  ]);

  // Also include yesterday for a complete daily board after midnight UTC.
  const yesterday = daysAgoUtc(1);
  const yesterdayScores = await sumNetContribution({
    creatorIds,
    startDay: yesterday,
    endDay: yesterday,
  });

  let rows = 0;
  rows += await persistPeriod({
    periodType: "daily",
    periodKey: today,
    scores: dailyScores,
  });
  rows += await persistPeriod({
    periodType: "daily",
    periodKey: yesterday,
    scores: yesterdayScores,
  });
  rows += await persistPeriod({
    periodType: "weekly",
    periodKey: week.key,
    scores: weeklyScores,
  });
  rows += await persistPeriod({
    periodType: "monthly",
    periodKey: month.key,
    scores: monthlyScores,
  });
  rows += await persistPeriod({
    periodType: "lifetime",
    periodKey: "all",
    scores: lifetimeScores,
  });

  lastRankRunAt = now;
  console.log(
    `[Creator Rankings] snapshots written periods=5 rows=${rows} creators=${creatorIds.length}`,
  );
  return { periods: 5, rows };
}

export async function runCreatorRankSnapshots(opts?: { force?: boolean }) {
  return computeCreatorRankSnapshots(opts);
}

export function isCreatorRankPeriodType(v: string): v is CreatorRankPeriodType {
  return (CREATOR_RANK_PERIOD_TYPES as readonly string[]).includes(v);
}

export async function getCreatorOwnRanks(creatorId: string) {
  const today = dayPeriodKey();
  const week = isoWeekPeriodKey();
  const month = monthPeriodKey();

  const wanted: Array<{ periodType: CreatorRankPeriodType; periodKey: string }> = [
    { periodType: "daily", periodKey: today },
    { periodType: "weekly", periodKey: week },
    { periodType: "monthly", periodKey: month },
    { periodType: "lifetime", periodKey: "all" },
  ];

  const rows = await db
    .select()
    .from(creatorRankSnapshots)
    .where(
      and(
        eq(creatorRankSnapshots.creatorId, creatorId),
        eq(creatorRankSnapshots.metricKey, CREATOR_RANK_METRIC_NET_CONTRIBUTION),
      ),
    );

  const byKey = new Map(
    rows.map((r) => [`${r.periodType}:${r.periodKey}`, r]),
  );

  return wanted.map(({ periodType, periodKey }) => {
    const snap = byKey.get(`${periodType}:${periodKey}`);
    if (!snap) {
      return {
        periodType,
        periodKey,
        metricKey: CREATOR_RANK_METRIC_NET_CONTRIBUTION,
        rank: null as number | null,
        ofCount: 0,
        percentile: null as number | null,
        sharePct: null as number | null,
        valueCents: 0,
        title: "Unranked",
        computedAt: null as string | null,
      };
    }
    const rank = snap.rank;
    const ofCount = snap.ofCount;
    return {
      periodType,
      periodKey,
      metricKey: snap.metricKey,
      rank,
      ofCount,
      percentile: snap.percentile != null ? Number(snap.percentile) : null,
      sharePct: snap.sharePct != null ? Number(snap.sharePct) : null,
      valueCents: snap.valueCents ?? 0,
      title: titleFromSnapshot(rank, ofCount, periodType),
      computedAt: snap.computedAt?.toISOString?.() ?? String(snap.computedAt),
    };
  });
}

function titleFromSnapshot(
  rank: number,
  ofCount: number,
  periodType: CreatorRankPeriodType,
): string {
  return titleForRank(rank, ofCount, periodType);
}

export async function getLeaderboard(params: {
  periodType: CreatorRankPeriodType;
  periodKey?: string;
  limit?: number;
}) {
  let periodKey = params.periodKey;
  if (!periodKey) {
    if (params.periodType === "daily") periodKey = dayPeriodKey();
    else if (params.periodType === "weekly") periodKey = isoWeekPeriodKey();
    else if (params.periodType === "monthly") periodKey = monthPeriodKey();
    else periodKey = "all";
  }
  const limit = Math.min(200, Math.max(1, params.limit ?? 50));

  const snaps = await db
    .select()
    .from(creatorRankSnapshots)
    .where(
      and(
        eq(creatorRankSnapshots.periodType, params.periodType),
        eq(creatorRankSnapshots.periodKey, periodKey),
        eq(creatorRankSnapshots.metricKey, CREATOR_RANK_METRIC_NET_CONTRIBUTION),
      ),
    )
    .orderBy(asc(creatorRankSnapshots.rank))
    .limit(limit);

  const ids = snaps.map((s) => s.creatorId);
  const creatorRows =
    ids.length === 0
      ? []
      : await db
          .select({
            id: creators.id,
            username: creators.username,
            displayName: creators.displayName,
            status: creators.status,
          })
          .from(creators)
          .where(inArray(creators.id, ids));
  const meta = new Map(creatorRows.map((c) => [c.id, c]));

  return {
    periodType: params.periodType,
    periodKey,
    metricKey: CREATOR_RANK_METRIC_NET_CONTRIBUTION,
    leaders: snaps.map((s) => {
      const c = meta.get(s.creatorId);
      return {
        creatorId: s.creatorId,
        username: c?.username ?? null,
        displayName: c?.displayName ?? null,
        status: c?.status ?? null,
        rank: s.rank,
        ofCount: s.ofCount,
        valueCents: s.valueCents ?? 0,
        percentile: s.percentile != null ? Number(s.percentile) : null,
        sharePct: s.sharePct != null ? Number(s.sharePct) : null,
        title: titleFromSnapshot(s.rank, s.ofCount, params.periodType),
      };
    }),
  };
}
