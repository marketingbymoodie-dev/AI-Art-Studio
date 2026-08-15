/**
 * Creator Portal APIs (Phase 6) — own-data only under /api/creator/*
 */
import type { Express, Response } from "express";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  creatorDailyStats,
  creatorEvents,
  creatorOrderLines,
  creatorOrders,
  creatorSessions,
  creators,
  customizerPages,
  productTypes,
} from "@shared/schema";
import { db } from "../db";
import { isCreatorMarketplaceEnabled } from "../creator-config";
import { invalidateCreatorHostCache } from "../creator-host";
import {
  mergeCreatorBranding,
  sanitizeCreatorBio,
  sanitizeCreatorImageUrl,
} from "@shared/creatorMarketplace";
import {
  clearCreatorAuthCookie,
  clearCreatorOtp,
  findPortalCreatorByEmail,
  publicCreatorProfile,
  requireCreator,
  sendCreatorPortalOtpEmail,
  setCreatorAuthCookie,
  setCreatorOtp,
  signCreatorIdentityToken,
  type CreatorAuthedRequest,
} from "../creator-auth";
import { rollupCreatorDailyStats, utcDayKey } from "../creator-analytics";
import { getCreatorOwnRanks, runCreatorRankSnapshots } from "../creator-rankings";
import { checkCreatorRateLimit, clientIpFromReq } from "../creator-rate-limit";

const otpRate = new Map<string, number>();
const OTP_RATE_MS = 60_000;

function marketplaceGate(res: Response): boolean {
  if (!isCreatorMarketplaceEnabled()) {
    res.status(404).json({ error: "Creator Marketplace is not enabled." });
    return false;
  }
  return true;
}

function parseDays(raw: unknown, fallback = 14): number {
  const n = parseInt(String(raw || fallback), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(90, Math.max(1, n));
}

export function registerCreatorPortalRoutes(app: Express): void {
  app.post("/api/creator/auth/request-otp", async (req, res) => {
    if (!marketplaceGate(res)) return;
    const ipRl = checkCreatorRateLimit({
      key: `portal-otp-ip:${clientIpFromReq(req)}`,
      limit: 20,
      windowMs: 60 * 60 * 1000,
    });
    if (!ipRl.ok) {
      res.setHeader("Retry-After", String(ipRl.retryAfterSec));
      return res.status(429).json({ error: "Too many login attempts. Try again later." });
    }
    try {
      const email = String(req.body?.email || "").toLowerCase().trim();
      if (!email || !email.includes("@")) {
        return res.status(400).json({ error: "A valid email is required." });
      }

      const last = otpRate.get(email) || 0;
      if (Date.now() - last < OTP_RATE_MS) {
        return res.status(429).json({ error: "Please wait a minute before requesting another code." });
      }

      const creator = await findPortalCreatorByEmail(email);
      // Always return ok to avoid email enumeration.
      if (!creator) {
        console.log(`[Creator OTP] no portal account for ${email}`);
        return res.json({ ok: true, message: "If that email is registered, a code was sent." });
      }

      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await setCreatorOtp(creator.id, code, expiresAt);
      await sendCreatorPortalOtpEmail(email, code);
      otpRate.set(email, Date.now());
      console.log(`[Creator OTP] code sent to ${email} (${creator.username})`);
      res.json({ ok: true, message: "If that email is registered, a code was sent." });
    } catch (e: any) {
      console.error("[Creator OTP] request failed:", e);
      res.status(500).json({ error: e?.message || "Failed to send login code" });
    }
  });

  app.post("/api/creator/auth/verify-otp", async (req, res) => {
    if (!marketplaceGate(res)) return;
    const ipRl = checkCreatorRateLimit({
      key: `portal-otp-verify-ip:${clientIpFromReq(req)}`,
      limit: 40,
      windowMs: 60 * 60 * 1000,
    });
    if (!ipRl.ok) {
      res.setHeader("Retry-After", String(ipRl.retryAfterSec));
      return res.status(429).json({ error: "Too many attempts. Try again later." });
    }
    try {
      const email = String(req.body?.email || "").toLowerCase().trim();
      const code = String(req.body?.code || "").trim();
      if (!email || !code) {
        return res.status(400).json({ error: "Email and code are required." });
      }
      const emailRl = checkCreatorRateLimit({
        key: `portal-otp-verify-email:${email}`,
        limit: 12,
        windowMs: 60 * 60 * 1000,
      });
      if (!emailRl.ok) {
        res.setHeader("Retry-After", String(emailRl.retryAfterSec));
        return res.status(429).json({ error: "Too many attempts for this email. Try again later." });
      }
      const creator = await findPortalCreatorByEmail(email);
      if (!creator || !creator.otpCode || creator.otpCode !== code) {
        return res.status(401).json({ error: "Invalid email or code." });
      }
      if (!creator.otpExpiresAt || new Date(creator.otpExpiresAt) < new Date()) {
        return res.status(401).json({ error: "Code expired. Please request a new one." });
      }
      await clearCreatorOtp(creator.id);
      const token = signCreatorIdentityToken(creator.id);
      setCreatorAuthCookie(res, token);
      res.json({
        ok: true,
        token,
        creator: publicCreatorProfile(creator),
      });
    } catch (e: any) {
      console.error("[Creator OTP] verify failed:", e);
      res.status(500).json({ error: "Failed to verify code" });
    }
  });

  app.post("/api/creator/auth/logout", async (_req, res) => {
    clearCreatorAuthCookie(res);
    res.json({ ok: true });
  });

  app.get("/api/creator/me", requireCreator, async (req: CreatorAuthedRequest, res) => {
    res.json({ creator: publicCreatorProfile(req.creator!) });
  });

  app.patch("/api/creator/profile", requireCreator, async (req: CreatorAuthedRequest, res) => {
    try {
      const creator = req.creator!;
      const body = req.body ?? {};
      const patch: Partial<typeof creators.$inferInsert> = { updatedAt: new Date() };

      if (body.bio !== undefined) {
        patch.bio = sanitizeCreatorBio(body.bio);
      }
      if (body.profileImageUrl !== undefined) {
        patch.profileImageUrl = sanitizeCreatorImageUrl(body.profileImageUrl);
      }
      if (
        body.shopName !== undefined ||
        body.shopDescription !== undefined ||
        body.backgroundImageUrl !== undefined
      ) {
        patch.branding = mergeCreatorBranding(
          creator.branding as Record<string, unknown> | null,
          {
            shopName: body.shopName,
            shopDescription: body.shopDescription,
            backgroundImageUrl: body.backgroundImageUrl,
          },
        );
      }

      const [updated] = await db
        .update(creators)
        .set(patch)
        .where(eq(creators.id, creator.id))
        .returning();

      invalidateCreatorHostCache(updated.username);
      res.json({ creator: publicCreatorProfile(updated) });
    } catch (e: any) {
      console.error("[creator portal] profile update failed:", e);
      res.status(500).json({ error: e?.message || "Failed to update profile" });
    }
  });

  app.get("/api/creator/rank", requireCreator, async (req: CreatorAuthedRequest, res) => {
    try {
      // Ensure snapshots exist for first visitors (cheap if already warm / deduped).
      await runCreatorRankSnapshots().catch(() => {});
      const periods = await getCreatorOwnRanks(req.creatorId!);
      res.json({
        metricKey: "net_contribution",
        periods,
      });
    } catch (e: any) {
      console.error("[creator portal] rank failed:", e);
      res.status(500).json({ error: "Failed to load ranks" });
    }
  });

  app.get("/api/creator/stats", requireCreator, async (req: CreatorAuthedRequest, res) => {
    try {
      const creatorId = req.creatorId!;
      const days = parseDays(req.query.days, 14);
      await rollupCreatorDailyStats({ day: utcDayKey(), creatorId }).catch(() => {});
      const rows = await db
        .select()
        .from(creatorDailyStats)
        .where(eq(creatorDailyStats.creatorId, creatorId))
        .orderBy(desc(creatorDailyStats.day))
        .limit(days);

      const todayKey = utcDayKey();
      const today = rows.find((r) => r.day === todayKey) || null;
      const totals = rows.reduce(
        (acc, r) => {
          acc.visitors += r.visitors || 0;
          acc.sessions += r.sessions || 0;
          acc.pageViews += r.pageViews || 0;
          acc.generations += r.generations || 0;
          acc.genCostCents += r.genCostCents || 0;
          acc.atcCount += r.atcCount || 0;
          acc.orders += r.orders || 0;
          acc.grossCents += r.grossCents || 0;
          acc.productProfitCents += r.productProfitCents || 0;
          acc.netContributionCents += r.netContributionCents || 0;
          return acc;
        },
        {
          visitors: 0,
          sessions: 0,
          pageViews: 0,
          generations: 0,
          genCostCents: 0,
          atcCount: 0,
          orders: 0,
          grossCents: 0,
          productProfitCents: 0,
          netContributionCents: 0,
        },
      );

      res.json({ days: rows, today, periodTotals: totals, periodDays: days });
    } catch (e: any) {
      console.error("[creator portal] stats failed:", e);
      res.status(500).json({ error: "Failed to load stats" });
    }
  });

  app.get("/api/creator/orders", requireCreator, async (req: CreatorAuthedRequest, res) => {
    try {
      const creatorId = req.creatorId!;
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "25"), 10) || 25));
      const orders = await db
        .select()
        .from(creatorOrders)
        .where(eq(creatorOrders.creatorId, creatorId))
        .orderBy(desc(creatorOrders.createdAt))
        .limit(limit);
      const orderIds = orders.map((o) => o.id);
      const lines =
        orderIds.length === 0
          ? []
          : await db
              .select()
              .from(creatorOrderLines)
              .where(inArray(creatorOrderLines.creatorOrderId, orderIds));
      const byOrder = new Map<string, typeof lines>();
      for (const line of lines) {
        const list = byOrder.get(line.creatorOrderId) || [];
        list.push(line);
        byOrder.set(line.creatorOrderId, list);
      }
      res.json({
        orders: orders.map((o) => ({
          id: o.id,
          shopifyOrderName: o.shopifyOrderName,
          status: o.status,
          grossCents: o.grossCents,
          discountCents: o.discountCents,
          fulfilmentCostCents: o.fulfilmentCostCents,
          transactionFeeCents: o.transactionFeeCents,
          productProfitCents: o.productProfitCents,
          aiGenCostCents: o.aiGenCostCents,
          netContributionCents: o.netContributionCents,
          creatorShareCents: o.creatorShareCents,
          refundCents: o.refundCents,
          createdAt: o.createdAt,
          lines: (byOrder.get(o.id) || []).map((l) => ({
            quantity: l.quantity,
            unitRevenueCents: l.unitRevenueCents,
            unitCogsCents: l.unitCogsCents,
            productTypeId: l.productTypeId,
          })),
        })),
      });
    } catch (e: any) {
      console.error("[creator portal] orders failed:", e);
      res.status(500).json({ error: "Failed to load orders" });
    }
  });

  app.get("/api/creator/performance", requireCreator, async (req: CreatorAuthedRequest, res) => {
    try {
      const creatorId = req.creatorId!;
      const days = parseDays(req.query.days, 14);
      const start = new Date(`${utcDayKey(new Date(Date.now() - (days - 1) * 86400000))}T00:00:00.000Z`);
      const end = new Date(Date.now() + 60_000);

      await rollupCreatorDailyStats({ day: utcDayKey(), creatorId }).catch(() => {});

      const daily = await db
        .select()
        .from(creatorDailyStats)
        .where(
          and(
            eq(creatorDailyStats.creatorId, creatorId),
            gte(creatorDailyStats.day, utcDayKey(start)),
          ),
        )
        .orderBy(creatorDailyStats.day);

      const styleRows = await db
        .select({
          stylePreset: creatorEvents.stylePreset,
          n: sql<number>`count(*)::int`,
        })
        .from(creatorEvents)
        .where(
          and(
            eq(creatorEvents.creatorId, creatorId),
            eq(creatorEvents.eventType, "generation"),
            gte(creatorEvents.createdAt, start),
            lt(creatorEvents.createdAt, end),
            sql`${creatorEvents.stylePreset} is not null`,
          ),
        )
        .groupBy(creatorEvents.stylePreset)
        .orderBy(sql`count(*) desc`)
        .limit(10);

      const pageRows = await db
        .select({
          customizerPageId: creatorEvents.customizerPageId,
          n: sql<number>`count(*)::int`,
        })
        .from(creatorEvents)
        .where(
          and(
            eq(creatorEvents.creatorId, creatorId),
            gte(creatorEvents.createdAt, start),
            lt(creatorEvents.createdAt, end),
            sql`${creatorEvents.customizerPageId} is not null`,
          ),
        )
        .groupBy(creatorEvents.customizerPageId)
        .orderBy(sql`count(*) desc`)
        .limit(10);

      const pageIds = pageRows
        .map((r) => r.customizerPageId)
        .filter((id): id is string => !!id);
      const pageMeta =
        pageIds.length === 0
          ? []
          : await db
              .select({
                id: customizerPages.id,
                title: customizerPages.title,
                handle: customizerPages.handle,
              })
              .from(customizerPages)
              .where(inArray(customizerPages.id, pageIds));
      const pageTitle = new Map(pageMeta.map((p) => [p.id, p.title || p.handle || p.id]));

      const productRows = await db
        .select({
          productTypeId: creatorEvents.productTypeId,
          n: sql<number>`count(*)::int`,
        })
        .from(creatorEvents)
        .where(
          and(
            eq(creatorEvents.creatorId, creatorId),
            eq(creatorEvents.eventType, "generation"),
            gte(creatorEvents.createdAt, start),
            lt(creatorEvents.createdAt, end),
            sql`${creatorEvents.productTypeId} is not null`,
          ),
        )
        .groupBy(creatorEvents.productTypeId)
        .orderBy(sql`count(*) desc`)
        .limit(10);

      const ptIds = productRows
        .map((r) => r.productTypeId)
        .filter((id): id is number => id != null && id > 0);
      const ptMeta =
        ptIds.length === 0
          ? []
          : await db
              .select({ id: productTypes.id, name: productTypes.name })
              .from(productTypes)
              .where(inArray(productTypes.id, ptIds));
      const ptName = new Map(ptMeta.map((p) => [p.id, p.name]));

      const trafficRows = await db
        .select({
          utmSource: creatorSessions.utmSource,
          referrer: creatorSessions.referrer,
          n: sql<number>`count(*)::int`,
        })
        .from(creatorSessions)
        .where(
          and(
            eq(creatorSessions.creatorId, creatorId),
            gte(creatorSessions.firstSeenAt, start),
            lt(creatorSessions.firstSeenAt, end),
          ),
        )
        .groupBy(creatorSessions.utmSource, creatorSessions.referrer)
        .orderBy(sql`count(*) desc`)
        .limit(15);

      res.json({
        periodDays: days,
        daily: daily.map((d) => ({
          day: d.day,
          visitors: d.visitors,
          generations: d.generations,
          orders: d.orders,
          grossCents: d.grossCents,
          netContributionCents: d.netContributionCents,
          atcCount: d.atcCount,
        })),
        topStyles: styleRows
          .filter((r) => r.stylePreset)
          .map((r) => ({ name: r.stylePreset!, count: Number(r.n) || 0 })),
        topPages: pageRows
          .filter((r) => r.customizerPageId)
          .map((r) => ({
            id: r.customizerPageId!,
            name: pageTitle.get(r.customizerPageId!) || r.customizerPageId!,
            count: Number(r.n) || 0,
          })),
        topProducts: productRows
          .filter((r) => r.productTypeId != null)
          .map((r) => ({
            id: r.productTypeId!,
            name: ptName.get(r.productTypeId!) || `Product #${r.productTypeId}`,
            count: Number(r.n) || 0,
          })),
        trafficSources: trafficRows.map((r) => {
          const source =
            (r.utmSource && r.utmSource.trim()) ||
            (r.referrer ? safeHost(r.referrer) : null) ||
            "direct";
          return { source, count: Number(r.n) || 0 };
        }),
      });
    } catch (e: any) {
      console.error("[creator portal] performance failed:", e);
      res.status(500).json({ error: "Failed to load performance" });
    }
  });

  app.get("/api/creator/styles", requireCreator, async (req: CreatorAuthedRequest, res) => {
    try {
      const { listCreatorStyleAssignments } = await import("../creator-styles");
      const styles = await listCreatorStyleAssignments(req.creatorId!);
      res.json({ styles });
    } catch (e: any) {
      console.error("[creator portal] styles failed:", e);
      res.status(500).json({ error: "Failed to load styles" });
    }
  });

  app.patch(
    "/api/creator/styles/:stylePresetId",
    requireCreator,
    async (req: CreatorAuthedRequest, res) => {
      try {
        const stylePresetId = Number(req.params.stylePresetId);
        if (!Number.isInteger(stylePresetId) || stylePresetId <= 0) {
          return res.status(400).json({ error: "Invalid style." });
        }
        if (typeof req.body?.enabled !== "boolean") {
          return res.status(400).json({ error: "enabled must be a boolean." });
        }
        const { setCreatorStyleEnabled } = await import("../creator-styles");
        const style = await setCreatorStyleEnabled({
          creatorId: req.creatorId!,
          stylePresetId,
          enabled: req.body.enabled,
        });
        if (!style) return res.status(404).json({ error: "Style is not assigned to you." });
        res.json({ style });
      } catch (e: any) {
        console.error("[creator portal] style toggle failed:", e);
        res.status(500).json({ error: "Failed to update style" });
      }
    },
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname || "referral";
  } catch {
    return "referral";
  }
}
