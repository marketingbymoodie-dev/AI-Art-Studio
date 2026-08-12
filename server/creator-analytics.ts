/**
 * Creator Marketplace Phase 4 — sessions, events, daily rollups.
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "./db";
import {
  creatorDailyStats,
  creatorEvents,
  creatorSessions,
  creators,
} from "@shared/schema";
import {
  CREATOR_EVENT_TYPES,
  normalizeCreatorUsername,
  type CreatorEventType,
} from "@shared/creatorMarketplace";
import { lookupCreatorByUsername } from "./creator-host";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCreatorEventType(v: string): v is CreatorEventType {
  return (CREATOR_EVENT_TYPES as readonly string[]).includes(v);
}

export function utcDayKey(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function detectDevice(ua: string | undefined): string | null {
  if (!ua) return null;
  const s = ua.toLowerCase();
  if (/bot|crawl|spider/i.test(s)) return "bot";
  if (/ipad|tablet|kindle/i.test(s)) return "tablet";
  if (/mobi|iphone|android/i.test(s)) return "mobile";
  return "desktop";
}

export async function resolveCreatorId(params: {
  creatorId?: string | null;
  creatorUsername?: string | null;
}): Promise<string | null> {
  if (params.creatorId) {
    const [row] = await db
      .select({ id: creators.id })
      .from(creators)
      .where(eq(creators.id, String(params.creatorId)))
      .limit(1);
    if (row) return row.id;
  }
  const u = normalizeCreatorUsername(String(params.creatorUsername || ""));
  if (!u) return null;
  const creator = await lookupCreatorByUsername(u);
  return creator?.id ?? null;
}

export async function upsertCreatorSession(params: {
  creatorId: string;
  sessionId?: string | null;
  landingPath?: string | null;
  referrer?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  userAgent?: string | null;
}): Promise<{ sessionId: string; created: boolean }> {
  const now = new Date();
  const device = detectDevice(params.userAgent || undefined);
  const wantedId =
    params.sessionId && UUID_RE.test(params.sessionId) ? params.sessionId : null;

  if (wantedId) {
    const [existing] = await db
      .select({ id: creatorSessions.id, creatorId: creatorSessions.creatorId })
      .from(creatorSessions)
      .where(eq(creatorSessions.id, wantedId))
      .limit(1);

    if (existing && existing.creatorId === params.creatorId) {
      await db
        .update(creatorSessions)
        .set({ lastSeenAt: now })
        .where(eq(creatorSessions.id, wantedId));
      return { sessionId: wantedId, created: false };
    }

    if (!existing) {
      await db.insert(creatorSessions).values({
        id: wantedId,
        creatorId: params.creatorId,
        firstSeenAt: now,
        lastSeenAt: now,
        landingPath: params.landingPath || null,
        referrer: params.referrer || null,
        utmSource: params.utmSource || null,
        utmMedium: params.utmMedium || null,
        utmCampaign: params.utmCampaign || null,
        utmContent: params.utmContent || null,
        device,
      });
      return { sessionId: wantedId, created: true };
    }
    // Session id belongs to another creator — mint a new one.
  }

  const [row] = await db
    .insert(creatorSessions)
    .values({
      creatorId: params.creatorId,
      firstSeenAt: now,
      lastSeenAt: now,
      landingPath: params.landingPath || null,
      referrer: params.referrer || null,
      utmSource: params.utmSource || null,
      utmMedium: params.utmMedium || null,
      utmCampaign: params.utmCampaign || null,
      utmContent: params.utmContent || null,
      device,
    })
    .returning({ id: creatorSessions.id });

  return { sessionId: row.id, created: true };
}

export async function recordCreatorEvent(params: {
  creatorId: string;
  sessionId?: string | null;
  eventType: CreatorEventType;
  customizerPageId?: string | null;
  productTypeId?: number | null;
  generationJobId?: string | null;
  stylePreset?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  if (params.sessionId) {
    await db
      .update(creatorSessions)
      .set({ lastSeenAt: new Date() })
      .where(
        and(
          eq(creatorSessions.id, params.sessionId),
          eq(creatorSessions.creatorId, params.creatorId),
        ),
      )
      .catch(() => {});
  }

  await db.insert(creatorEvents).values({
    creatorId: params.creatorId,
    sessionId: params.sessionId || null,
    eventType: params.eventType,
    customizerPageId: params.customizerPageId || null,
    productTypeId: params.productTypeId ?? null,
    generationJobId: params.generationJobId || null,
    stylePreset: params.stylePreset || null,
    metadata: params.metadata || null,
  });
}

/** Roll up one UTC day for all creators (or one creator). Idempotent upsert. */
export async function rollupCreatorDailyStats(opts?: {
  day?: string;
  creatorId?: string;
}): Promise<{ day: string; creatorsUpdated: number }> {
  const day = opts?.day || utcDayKey();
  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  const eventWhere = opts?.creatorId
    ? and(
        gte(creatorEvents.createdAt, start),
        lt(creatorEvents.createdAt, end),
        eq(creatorEvents.creatorId, opts.creatorId),
      )
    : and(gte(creatorEvents.createdAt, start), lt(creatorEvents.createdAt, end));

  const eventRows = await db
    .select({
      creatorId: creatorEvents.creatorId,
      eventType: creatorEvents.eventType,
      n: sql<number>`count(*)::int`,
      sessions: sql<number>`count(distinct ${creatorEvents.sessionId})::int`,
    })
    .from(creatorEvents)
    .where(eventWhere)
    .groupBy(creatorEvents.creatorId, creatorEvents.eventType);

  const sessionWhere = opts?.creatorId
    ? and(
        gte(creatorSessions.firstSeenAt, start),
        lt(creatorSessions.firstSeenAt, end),
        eq(creatorSessions.creatorId, opts.creatorId),
      )
    : and(gte(creatorSessions.firstSeenAt, start), lt(creatorSessions.firstSeenAt, end));

  const sessionRows = await db
    .select({
      creatorId: creatorSessions.creatorId,
      sessions: sql<number>`count(*)::int`,
    })
    .from(creatorSessions)
    .where(sessionWhere)
    .groupBy(creatorSessions.creatorId);

  const byCreator = new Map<
    string,
    {
      pageViews: number;
      generations: number;
      atcCount: number;
      checkoutStarted: number;
      eventSessions: number;
    }
  >();

  for (const row of eventRows) {
    const cur = byCreator.get(row.creatorId) || {
      pageViews: 0,
      generations: 0,
      atcCount: 0,
      checkoutStarted: 0,
      eventSessions: 0,
    };
    const n = Number(row.n) || 0;
    if (row.eventType === "page_view") cur.pageViews += n;
    if (row.eventType === "generation") cur.generations += n;
    if (row.eventType === "atc") cur.atcCount += n;
    if (row.eventType === "checkout_started") cur.checkoutStarted += n;
    cur.eventSessions = Math.max(cur.eventSessions, Number(row.sessions) || 0);
    byCreator.set(row.creatorId, cur);
  }

  const sessionMap = new Map(
    sessionRows.map((r) => [r.creatorId, Number(r.sessions) || 0]),
  );

  const ids = new Set([...byCreator.keys(), ...sessionMap.keys()]);
  let creatorsUpdated = 0;

  for (const creatorId of ids) {
    const ev = byCreator.get(creatorId) || {
      pageViews: 0,
      generations: 0,
      atcCount: 0,
      checkoutStarted: 0,
      eventSessions: 0,
    };
    const sessions = sessionMap.get(creatorId) ?? ev.eventSessions;
    const visitors = sessions; // v1: 1 session ≈ 1 visitor

    await db
      .insert(creatorDailyStats)
      .values({
        creatorId,
        day,
        visitors,
        sessions,
        pageViews: ev.pageViews,
        generations: ev.generations,
        genCostCents: 0, // Phase 5 fills from creator_generation_costs
        atcCount: ev.atcCount,
        orders: 0,
        grossCents: 0,
        productProfitCents: 0,
        netContributionCents: 0,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [creatorDailyStats.creatorId, creatorDailyStats.day],
        set: {
          visitors,
          sessions,
          pageViews: ev.pageViews,
          generations: ev.generations,
          atcCount: ev.atcCount,
          updatedAt: new Date(),
        },
      });
    creatorsUpdated++;
  }

  return { day, creatorsUpdated };
}

let lastRollupAt = 0;
const ROLLUP_DEDUPE_MS = 20 * 60 * 60 * 1000;

export async function runCreatorDailyStatsRollup(opts?: {
  force?: boolean;
}): Promise<{ day: string; creatorsUpdated: number; skipped?: boolean }> {
  const now = Date.now();
  if (!opts?.force && now - lastRollupAt < ROLLUP_DEDUPE_MS) {
    return { day: utcDayKey(), creatorsUpdated: 0, skipped: true };
  }
  // Roll yesterday (complete) + today (partial).
  const today = utcDayKey();
  const yesterday = utcDayKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const y = await rollupCreatorDailyStats({ day: yesterday });
  const t = await rollupCreatorDailyStats({ day: today });
  lastRollupAt = now;
  return {
    day: today,
    creatorsUpdated: y.creatorsUpdated + t.creatorsUpdated,
  };
}
