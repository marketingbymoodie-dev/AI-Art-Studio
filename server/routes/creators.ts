/**
 * Creator Marketplace — Phase 1–9 routes:
 * - Public apply, storefront, Storefront cart, analytics, credit packs
 * - Admin applications, quotas, ledger, partner/payouts, beta lifecycle
 */
import { type Express, type Response } from "express";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  creatorApplications,
  creatorCustomizerPages,
  creatorDailyStats,
  creatorEmailLog,
  creatorNotes,
  creatorOrderLines,
  creatorOrders,
  creators,
  customizerPages,
} from "@shared/schema";
import {
  CREATOR_APPLICATION_STATUSES,
  CREATOR_APPLY_TRACKS,
  CREATOR_PAYOUT_METHODS,
  CREATOR_STATUSES,
  DEFAULT_CREATOR_BETA_DAYS,
  DEFAULT_CREATOR_FREE_GENS_PER_CUSTOMER,
  DEFAULT_CREATOR_MONTHLY_GENERATION_ALLOWANCE,
  SOCIAL_PLATFORMS,
  clampFreeGensPerCustomer,
  clampMonthlyGenerationAllowance,
  normalizeCreatorUsername,
  type CreatorApplicationStatus,
  type CreatorApplyTrack,
  type CreatorPayoutMethod,
} from "@shared/creatorMarketplace";
import { requirePlatformAdmin } from "../platformAdmin";
import {
  getAiGenerationCostUsd,
  getCreatorPlatformShopDomain,
  getCreatorPlatformStorefrontToken,
  getLandingContent,
  isCreatorMarketplaceEnabled,
  saveLandingContent,
} from "../creator-config";
import {
  getCreatorStorefrontByUsername,
  invalidateCreatorHostCache,
  lookupCreatorByUsername,
  sanitizeCreatorForAdmin,
} from "../creator-host";
import { createCreatorCheckoutCart, isCreatorStorefrontConfigured } from "../shopify-storefront";
import {
  isCreatorEventType,
  recordCreatorEvent,
  resolveCreatorId,
  rollupCreatorDailyStats,
  upsertCreatorSession,
  utcDayKey,
} from "../creator-analytics";
import { checkCreatorRateLimit, clientIpFromReq } from "../creator-rate-limit";
import {
  applyCreatorBetaAction,
  getCreatorPayoutSummary,
  isCreatorBetaAction,
  listCreatorPayouts,
  parseSharePatch,
  recordCreatorPayout,
  updateCreatorPayoutStatus,
} from "../creator-partner";
import { isCreatorEmailsEnabled, queueCreatorEmail } from "../creator-emails";

type AuthMw = any;

function marketplaceGate(res: Response): boolean {
  if (!isCreatorMarketplaceEnabled()) {
    res.status(404).json({ error: "Creator Marketplace is not enabled." });
    return false;
  }
  return true;
}

function parseFollowerCount(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : parseInt(String(raw).replace(/,/g, ""), 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(1_000_000_000, Math.floor(n));
}

export function registerCreatorMarketplaceRoutes(
  app: Express,
  deps: { isAuthenticated: AuthMw },
) {
  const { isAuthenticated } = deps;

  app.get("/api/creators/status", async (_req, res) => {
    res.json({
      enabled: isCreatorMarketplaceEnabled(),
      aiGenerationCostUsd: await getAiGenerationCostUsd(),
    });
  });

  app.get("/api/creators/landing", async (_req, res) => {
    try {
      res.json({ content: await getLandingContent() });
    } catch (e: any) {
      console.error("[creators] landing read failed:", e);
      res.status(500).json({ error: e?.message || "Failed to load landing" });
    }
  });

  app.get("/api/platform/landing", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      res.json({ content: await getLandingContent() });
    } catch (e: any) {
      console.error("[creators] admin landing read failed:", e);
      res.status(500).json({ error: e?.message || "Failed to load landing" });
    }
  });

  app.put("/api/platform/landing", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const content = await saveLandingContent(req.body?.content ?? req.body);
      res.json({ content });
    } catch (e: any) {
      console.error("[creators] admin landing save failed:", e);
      res.status(500).json({ error: e?.message || "Failed to save landing" });
    }
  });

  /** Public storefront boot payload (path fallback + client refresh). */
  app.get("/api/creators/storefront/:username", async (req, res) => {
    if (!isCreatorMarketplaceEnabled()) {
      return res.status(404).json({ error: "Creator Marketplace is not enabled." });
    }
    try {
      const boot = await getCreatorStorefrontByUsername(req.params.username);
      if (!boot) return res.status(404).json({ error: "Creator storefront not found." });
      res.json({ creator: boot });
    } catch (e: any) {
      console.error("[creators] storefront lookup failed:", e);
      res.status(500).json({ error: e?.message || "Failed to load storefront" });
    }
  });

  app.post("/api/creators/apply", async (req, res) => {
    if (!marketplaceGate(res)) return;
    const rl = checkCreatorRateLimit({
      key: `apply:${clientIpFromReq(req)}`,
      limit: 8,
      windowMs: 60 * 60 * 1000,
    });
    if (!rl.ok) {
      res.setHeader("Retry-After", String(rl.retryAfterSec));
      return res.status(429).json({ error: "Too many applications. Try again later." });
    }
    try {
      const body = req.body ?? {};
      const firstName = String(body.firstName || "").trim();
      const lastName = String(body.lastName || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const trackRaw = String(body.track || body.applyTrack || "creator").trim().toLowerCase();
      const applyTrack: CreatorApplyTrack = (CREATOR_APPLY_TRACKS as readonly string[]).includes(
        trackRaw,
      )
        ? (trackRaw as CreatorApplyTrack)
        : "creator";
      const shopifyStoreUrl = String(body.shopifyStoreUrl || "").trim() || null;
      const hasShopifyStore = applyTrack === "shopify" || !!body.hasShopifyStore;
      const termsAccepted = body.termsAccepted === true || body.termsAccepted === "true";

      if (!firstName || !lastName || !email) {
        return res.status(400).json({
          error: "First name, last name, and email are required.",
        });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Enter a valid email address." });
      }
      if (!termsAccepted) {
        return res.status(400).json({ error: "Please agree to the terms to apply." });
      }

      let socialPlatform = String(body.socialPlatform || "").trim().toLowerCase();
      let socialUsername = String(body.socialUsername || "").trim();
      let niche = String(body.niche || "").trim();

      if (applyTrack === "shopify") {
        if (!shopifyStoreUrl) {
          return res.status(400).json({ error: "Shopify store URL is required." });
        }
        socialPlatform = socialPlatform || "other";
        socialUsername = socialUsername || shopifyStoreUrl.replace(/^https?:\/\//, "").slice(0, 80);
        niche = niche || "Shopify store owner";
      } else {
        if (!socialPlatform || !socialUsername || !niche) {
          return res.status(400).json({
            error: "Social platform, handle, and niche are required.",
          });
        }
      }
      if (!(SOCIAL_PLATFORMS as readonly string[]).includes(socialPlatform)) {
        return res.status(400).json({ error: "Unsupported social platform." });
      }
      if (hasShopifyStore && !shopifyStoreUrl) {
        return res.status(400).json({ error: "Shopify store URL is required when you have a store." });
      }

      const payoutRaw = String(body.payoutMethod || "").trim().toLowerCase();
      const payoutMethod: CreatorPayoutMethod | null = (CREATOR_PAYOUT_METHODS as readonly string[]).includes(
        payoutRaw,
      )
        ? (payoutRaw as CreatorPayoutMethod)
        : null;
      const payoutDetail = String(body.payoutDetail || "").trim() || null;

      const [row] = await db
        .insert(creatorApplications)
        .values({
          firstName,
          lastName,
          email,
          socialPlatform,
          socialUsername,
          socialUrl: String(body.socialUrl || "").trim() || null,
          followerCount: parseFollowerCount(body.followerCount),
          niche,
          audienceDescription: String(body.audienceDescription || "").trim() || null,
          hasShopifyStore,
          shopifyStoreUrl,
          interestedProducts: String(body.interestedProducts || "").trim() || null,
          preferredCategory: String(body.preferredCategory || "").trim() || null,
          whyParticipate: String(body.whyParticipate || "").trim() || null,
          expectedReach: String(body.expectedReach || "").trim() || null,
          additionalInfo: String(body.additionalInfo || "").trim() || null,
          applyTrack,
          payoutMethod,
          payoutDetail,
          termsAcceptedAt: new Date(),
          status: "submitted",
        })
        .returning();

      res.status(201).json({ application: row });
    } catch (e: any) {
      console.error("[creators] apply failed:", e);
      res.status(500).json({ error: e?.message || "Failed to submit application" });
    }
  });

  app.get(
    "/api/platform/creators/applications",
    isAuthenticated,
    async (req: any, res: Response) => {
      if (!requirePlatformAdmin(req, res)) return;
      try {
        const status = String(req.query.status || "").trim();
        const q = String(req.query.q || "").trim();
        const conditions = [];
        if (status && (CREATOR_APPLICATION_STATUSES as readonly string[]).includes(status)) {
          conditions.push(eq(creatorApplications.status, status));
        }
        if (q) {
          const like = `%${q}%`;
          conditions.push(
            or(
              ilike(creatorApplications.email, like),
              ilike(creatorApplications.firstName, like),
              ilike(creatorApplications.lastName, like),
              ilike(creatorApplications.socialUsername, like),
              ilike(creatorApplications.niche, like),
            )!,
          );
        }
        const where = conditions.length ? and(...conditions) : undefined;
        const rows = await db
          .select()
          .from(creatorApplications)
          .where(where)
          .orderBy(desc(creatorApplications.createdAt))
          .limit(200);
        res.json({ applications: rows });
      } catch (e: any) {
        console.error("[creators] list applications failed:", e);
        res.status(500).json({ error: e?.message || "Failed to list applications" });
      }
    },
  );

  app.get(
    "/api/platform/creators/applications/:id",
    isAuthenticated,
    async (req: any, res: Response) => {
      if (!requirePlatformAdmin(req, res)) return;
      const [row] = await db
        .select()
        .from(creatorApplications)
        .where(eq(creatorApplications.id, req.params.id))
        .limit(1);
      if (!row) return res.status(404).json({ error: "Application not found" });
      const notes = await db
        .select()
        .from(creatorNotes)
        .where(eq(creatorNotes.applicationId, row.id))
        .orderBy(desc(creatorNotes.createdAt));
      res.json({ application: row, notes });
    },
  );

  app.patch(
    "/api/platform/creators/applications/:id",
    isAuthenticated,
    async (req: any, res: Response) => {
      if (!requirePlatformAdmin(req, res)) return;
      try {
        const [existing] = await db
          .select()
          .from(creatorApplications)
          .where(eq(creatorApplications.id, req.params.id))
          .limit(1);
        if (!existing) return res.status(404).json({ error: "Application not found" });

        const body = req.body ?? {};
        const patch: Record<string, unknown> = { updatedAt: new Date() };

        if (body.adminNotes !== undefined) {
          patch.adminNotes = String(body.adminNotes || "");
        }
        if (body.assignedUsername !== undefined) {
          const u = normalizeCreatorUsername(String(body.assignedUsername || ""));
          if (body.assignedUsername && !u) {
            return res.status(400).json({ error: "Invalid or reserved username." });
          }
          patch.assignedUsername = u;
        }
        if (body.status !== undefined) {
          const status = String(body.status) as CreatorApplicationStatus;
          if (!(CREATOR_APPLICATION_STATUSES as readonly string[]).includes(status)) {
            return res.status(400).json({ error: "Invalid status." });
          }
          patch.status = status;
          patch.reviewedAt = new Date();
          patch.reviewedBy = req.shopDomain || req.user?.claims?.sub || "admin";
        }

        const [updated] = await db
          .update(creatorApplications)
          .set(patch)
          .where(eq(creatorApplications.id, existing.id))
          .returning();

        res.json({ application: updated });
      } catch (e: any) {
        console.error("[creators] patch application failed:", e);
        res.status(500).json({ error: e?.message || "Failed to update application" });
      }
    },
  );

  app.post(
    "/api/platform/creators/applications/:id/notes",
    isAuthenticated,
    async (req: any, res: Response) => {
      if (!requirePlatformAdmin(req, res)) return;
      const body = String(req.body?.body || "").trim();
      if (!body) return res.status(400).json({ error: "Note body is required." });
      const [existing] = await db
        .select()
        .from(creatorApplications)
        .where(eq(creatorApplications.id, req.params.id))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Application not found" });
      const [note] = await db
        .insert(creatorNotes)
        .values({
          applicationId: existing.id,
          creatorId: existing.creatorId,
          author: req.shopDomain || "admin",
          body,
        })
        .returning();
      res.status(201).json({ note });
    },
  );

  /**
   * Accept application → create creators row (onboarding) + link application.
   * Emails are logged; sent only when CREATOR_EMAILS_ENABLED=true.
   */
  app.post(
    "/api/platform/creators/applications/:id/start-onboarding",
    isAuthenticated,
    async (req: any, res: Response) => {
      if (!requirePlatformAdmin(req, res)) return;
      try {
        const [appRow] = await db
          .select()
          .from(creatorApplications)
          .where(eq(creatorApplications.id, req.params.id))
          .limit(1);
        if (!appRow) return res.status(404).json({ error: "Application not found" });
        if (appRow.creatorId) {
          return res.status(400).json({ error: "Creator already created for this application." });
        }

        const suggested =
          normalizeCreatorUsername(String(req.body?.username || appRow.assignedUsername || "")) ||
          normalizeCreatorUsername(appRow.socialUsername) ||
          normalizeCreatorUsername(`${appRow.firstName}${appRow.lastName}`);
        if (!suggested) {
          return res.status(400).json({
            error: "Assign a valid creator username before starting onboarding.",
          });
        }

        const [dup] = await db
          .select({ id: creators.id })
          .from(creators)
          .where(or(eq(creators.username, suggested), eq(creators.subdomain, suggested)))
          .limit(1);
        if (dup) {
          return res.status(409).json({ error: `Username "${suggested}" is already taken.` });
        }

        const creatorType = appRow.hasShopifyStore ? "shopify_merchant" : "creator";
        const displayName = `${appRow.firstName} ${appRow.lastName}`.trim();

        const [creator] = await db
          .insert(creators)
          .values({
            username: suggested,
            subdomain: suggested,
            displayName,
            email: appRow.email,
            firstName: appRow.firstName,
            lastName: appRow.lastName,
            socialPlatform: appRow.socialPlatform,
            socialUsername: appRow.socialUsername,
            socialUrl: appRow.socialUrl,
            followerCount: appRow.followerCount,
            niche: appRow.niche,
            audienceDescription: appRow.audienceDescription,
            status: "onboarding",
            creatorType,
            shopDomain: null,
            onboardingStatus: "in_progress",
            freeGensPerCustomer: DEFAULT_CREATOR_FREE_GENS_PER_CUSTOMER,
            monthlyGenerationAllowance: DEFAULT_CREATOR_MONTHLY_GENERATION_ALLOWANCE,
            applicationId: appRow.id,
          })
          .returning();

        const [updatedApp] = await db
          .update(creatorApplications)
          .set({
            status: "accepted",
            assignedUsername: suggested,
            creatorId: creator.id,
            reviewedAt: new Date(),
            reviewedBy: req.shopDomain || "admin",
            updatedAt: new Date(),
          })
          .where(eq(creatorApplications.id, appRow.id))
          .returning();

        invalidateCreatorHostCache(suggested);
        void queueCreatorEmail({
          creatorId: creator.id,
          templateKey: "application_accepted",
          applicationId: appRow.id,
        }).catch(() => {});
        res.status(201).json({ creator, application: updatedApp });
      } catch (e: any) {
        console.error("[creators] start-onboarding failed:", e);
        res.status(500).json({ error: e?.message || "Failed to start onboarding" });
      }
    },
  );

  app.get("/api/platform/creators", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    const status = String(req.query.status || "").trim();
    const where =
      status && (CREATOR_STATUSES as readonly string[]).includes(status)
        ? eq(creators.status, status)
        : undefined;
    const rows = await db
      .select()
      .from(creators)
      .where(where)
      .orderBy(desc(creators.createdAt))
      .limit(500);

    // Last-30d rollup summary for admin table (attribution + money).
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 30);
    const sinceDay = utcDayKey(since);
    const money = await db
      .select({
        creatorId: creatorDailyStats.creatorId,
        visitors: sql<number>`coalesce(sum(${creatorDailyStats.visitors}), 0)::int`,
        generations: sql<number>`coalesce(sum(${creatorDailyStats.generations}), 0)::int`,
        orders: sql<number>`coalesce(sum(${creatorDailyStats.orders}), 0)::int`,
        grossCents: sql<number>`coalesce(sum(${creatorDailyStats.grossCents}), 0)::int`,
        productProfitCents: sql<number>`coalesce(sum(${creatorDailyStats.productProfitCents}), 0)::int`,
        netContributionCents: sql<number>`coalesce(sum(${creatorDailyStats.netContributionCents}), 0)::int`,
      })
      .from(creatorDailyStats)
      .where(sql`${creatorDailyStats.day} >= ${sinceDay}`)
      .groupBy(creatorDailyStats.creatorId);
    const byId = new Map(money.map((m) => [m.creatorId, m]));

    res.json({
      creators: rows.map((c) => {
        const m = byId.get(c.id);
        return {
          ...sanitizeCreatorForAdmin(c),
          stats30d: {
            visitors: m?.visitors ?? 0,
            generations: m?.generations ?? 0,
            orders: m?.orders ?? 0,
            grossCents: m?.grossCents ?? 0,
            productProfitCents: m?.productProfitCents ?? 0,
            netContributionCents: m?.netContributionCents ?? 0,
          },
        };
      }),
    });
  });

  app.get("/api/platform/creators/config", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    res.json({
      enabled: isCreatorMarketplaceEnabled(),
      platformShopDomain: getCreatorPlatformShopDomain(),
      storefrontTokenConfigured: !!getCreatorPlatformStorefrontToken(),
      aiGenerationCostUsd: await getAiGenerationCostUsd(),
      emailsEnabled: isCreatorEmailsEnabled(),
      applicationCount: (
        await db.select({ n: sql<number>`count(*)::int` }).from(creatorApplications)
      )[0]?.n ?? 0,
      creatorCount: (
        await db.select({ n: sql<number>`count(*)::int` }).from(creators)
      )[0]?.n ?? 0,
    });
  });

  /** Admin: Creator Network leaderboard (full board — never expose on public/portal). */
  app.get(
    "/api/platform/creators/leaderboard",
    isAuthenticated,
    async (req: any, res: Response) => {
      if (!requirePlatformAdmin(req, res)) return;
      try {
        const { getLeaderboard, isCreatorRankPeriodType, runCreatorRankSnapshots } =
          await import("../creator-rankings");
        const periodTypeRaw = String(req.query.periodType || "monthly");
        const periodType = isCreatorRankPeriodType(periodTypeRaw) ? periodTypeRaw : "monthly";
        await runCreatorRankSnapshots().catch(() => {});
        const board = await getLeaderboard({
          periodType,
          periodKey: req.query.periodKey ? String(req.query.periodKey) : undefined,
          limit: parseInt(String(req.query.limit || "50"), 10) || 50,
        });
        res.json(board);
      } catch (e: any) {
        console.error("[platform creators] leaderboard failed:", e);
        res.status(500).json({ error: "Failed to load leaderboard" });
      }
    },
  );

  /** Public: assigned customizer pages for a creator storefront. */
  app.get("/api/creators/storefront/:username/pages", async (req, res) => {
    if (!isCreatorMarketplaceEnabled()) {
      return res.status(404).json({ error: "Creator Marketplace is not enabled." });
    }
    try {
      const username = normalizeCreatorUsername(req.params.username);
      if (!username) return res.status(404).json({ error: "Creator storefront not found." });
      const creator = await lookupCreatorByUsername(username);
      if (!creator) {
        return res.status(404).json({ error: "Creator storefront not found." });
      }
      const visible = ["onboarding", "active_beta", "partner"].includes(creator.status);
      if (!visible) {
        return res.status(404).json({ error: "Creator storefront not found." });
      }

      const links = await db
        .select()
        .from(creatorCustomizerPages)
        .where(
          and(
            eq(creatorCustomizerPages.creatorId, creator.id),
            eq(creatorCustomizerPages.enabled, true),
          ),
        )
        .orderBy(asc(creatorCustomizerPages.sortOrder), asc(creatorCustomizerPages.id));

      if (links.length === 0) {
        return res.json({
          platformShopDomain: getCreatorPlatformShopDomain(),
          pages: [],
        });
      }

      const pageIds = links.map((l) => l.customizerPageId);
      const pages = await db
        .select()
        .from(customizerPages)
        .where(inArray(customizerPages.id, pageIds));
      const byId = new Map(pages.map((p) => [p.id, p]));

      const out = links
        .map((link) => {
          const page = byId.get(link.customizerPageId);
          if (!page || page.status === "disabled") return null;
          return {
            id: link.id,
            customizerPageId: page.id,
            handle: page.handle,
            title: link.titleOverride || page.title,
            description: link.descriptionOverride || null,
            baseProductTitle: page.baseProductTitle,
            baseProductPrice: page.baseProductPrice,
            productTypeId: page.productTypeId,
            sortOrder: link.sortOrder,
          };
        })
        .filter(Boolean);

      res.json({
        platformShopDomain: getCreatorPlatformShopDomain(),
        pages: out,
      });
    } catch (e: any) {
      console.error("[creators] storefront pages failed:", e);
      res.status(500).json({ error: e?.message || "Failed to load pages" });
    }
  });

  /** Upsert creator visitor session (UTM / referrer). Returns sessionId. */
  app.post("/api/creators/analytics/session", async (req, res) => {
    if (!marketplaceGate(res)) return;
    const rl = checkCreatorRateLimit({
      key: `analytics-session:${clientIpFromReq(req)}`,
      limit: 120,
      windowMs: 60 * 60 * 1000,
    });
    if (!rl.ok) {
      res.setHeader("Retry-After", String(rl.retryAfterSec));
      return res.status(429).json({ error: "Rate limited." });
    }
    try {
      const body = req.body ?? {};
      const creatorId = await resolveCreatorId({
        creatorId: body.creatorId,
        creatorUsername: body.creatorUsername,
        shop: body.shop || getCreatorPlatformShopDomain(),
        requirePlatformShop: false,
      });
      if (!creatorId) return res.status(404).json({ error: "Creator not found." });

      const result = await upsertCreatorSession({
        creatorId,
        sessionId: body.sessionId ? String(body.sessionId) : null,
        landingPath: body.landingPath ? String(body.landingPath).slice(0, 500) : null,
        referrer: body.referrer ? String(body.referrer).slice(0, 500) : null,
        utmSource: body.utmSource ? String(body.utmSource).slice(0, 120) : null,
        utmMedium: body.utmMedium ? String(body.utmMedium).slice(0, 120) : null,
        utmCampaign: body.utmCampaign ? String(body.utmCampaign).slice(0, 120) : null,
        utmContent: body.utmContent ? String(body.utmContent).slice(0, 120) : null,
        userAgent: req.get("user-agent"),
      });
      res.json(result);
    } catch (e: any) {
      console.error("[creators] analytics session failed:", e);
      res.status(500).json({ error: e?.message || "Failed to upsert session" });
    }
  });

  /** Record a creator attribution event (page_view, customizer_open, …). */
  app.post("/api/creators/analytics/event", async (req, res) => {
    if (!marketplaceGate(res)) return;
    const rl = checkCreatorRateLimit({
      key: `analytics-event:${clientIpFromReq(req)}`,
      limit: 600,
      windowMs: 60 * 60 * 1000,
    });
    if (!rl.ok) {
      res.setHeader("Retry-After", String(rl.retryAfterSec));
      return res.status(429).json({ error: "Rate limited." });
    }
    try {
      const body = req.body ?? {};
      const eventType = String(body.eventType || "");
      if (!isCreatorEventType(eventType)) {
        return res.status(400).json({ error: "Invalid eventType." });
      }
      const creatorId = await resolveCreatorId({
        creatorId: body.creatorId,
        creatorUsername: body.creatorUsername,
        shop: body.shop || getCreatorPlatformShopDomain(),
        requirePlatformShop: false,
      });
      if (!creatorId) return res.status(404).json({ error: "Creator not found." });

      let sessionId = body.sessionId ? String(body.sessionId) : null;
      if (!sessionId) {
        const s = await upsertCreatorSession({
          creatorId,
          userAgent: req.get("user-agent"),
          landingPath: body.path ? String(body.path).slice(0, 500) : null,
        });
        sessionId = s.sessionId;
      }

      await recordCreatorEvent({
        creatorId,
        sessionId,
        eventType,
        customizerPageId: body.customizerPageId ? String(body.customizerPageId) : null,
        productTypeId:
          body.productTypeId != null && Number.isFinite(Number(body.productTypeId))
            ? Number(body.productTypeId)
            : null,
        generationJobId: body.generationJobId ? String(body.generationJobId) : null,
        stylePreset: body.stylePreset ? String(body.stylePreset).slice(0, 120) : null,
        metadata:
          body.metadata && typeof body.metadata === "object"
            ? (body.metadata as Record<string, unknown>)
            : body.path
              ? { path: String(body.path).slice(0, 500) }
              : null,
      });

      res.json({ ok: true, sessionId });
    } catch (e: any) {
      console.error("[creators] analytics event failed:", e);
      res.status(500).json({ error: e?.message || "Failed to record event" });
    }
  });

  /** List Studio Credit packs available on the creator storefront. */
  app.get("/api/creators/credits/packs", async (_req, res) => {
    if (!marketplaceGate(res)) return;
    try {
      const { listCreatorPacksForSale } = await import("../creator-packs");
      const packs = await listCreatorPacksForSale();
      res.json({
        packs: packs.map((p) => ({
          packId: p.packId,
          credits: p.credits,
          priceInCents: p.priceInCents,
          label: p.label,
        })),
        storefrontReady: isCreatorStorefrontConfigured(),
      });
    } catch (e: any) {
      console.error("[creators] list packs failed:", e);
      res.status(500).json({ error: e?.message || "Failed to list packs" });
    }
  });

  /**
   * Create Shopify checkout for a generation credit pack (platform shop).
   * Credits are granted on orders/paid via creator-packs grant.
   */
  app.post("/api/creators/credits/checkout", async (req, res) => {
    if (!marketplaceGate(res)) return;
    const rl = checkCreatorRateLimit({
      key: `pack-checkout:${clientIpFromReq(req)}`,
      limit: 30,
      windowMs: 60 * 60 * 1000,
    });
    if (!rl.ok) {
      res.setHeader("Retry-After", String(rl.retryAfterSec));
      return res.status(429).json({ error: "Too many checkout attempts. Try again later." });
    }
    try {
      if (!isCreatorStorefrontConfigured()) {
        return res.status(503).json({
          error: "CREATOR_STOREFRONT_NOT_CONFIGURED",
          message:
            "Set CREATOR_PLATFORM_SHOP_DOMAIN and CREATOR_STOREFRONT_API_TOKEN on Railway staging.",
        });
      }
      const body = req.body ?? {};
      const { createCreatorPackCheckout } = await import("../creator-packs");
      const result = await createCreatorPackCheckout({
        packId: String(body.packId || ""),
        creatorUsername: String(body.creatorUsername || ""),
        customerId: String(body.customerId || ""),
        creatorSessionId: body.creatorSessionId ? String(body.creatorSessionId) : null,
      });
      res.json({
        success: true,
        checkoutUrl: result.checkoutUrl,
        cartId: result.cartId,
        pack: result.pack,
        platformShopDomain: getCreatorPlatformShopDomain(),
      });
    } catch (e: any) {
      console.error("[creators] pack checkout failed:", e);
      const msg = e?.message || "Failed to create pack checkout";
      const status =
        /required|Unknown|Invalid|not found|not accepting/i.test(msg) ? 400 : 500;
      res.status(status).json({ error: msg });
    }
  });

  /**
   * Create a Storefront API cart on the platform shop and return checkoutUrl.
   * Client resolves shadow variant first, then posts here (creator host adapter).
   */
  app.post("/api/creators/cart/checkout", async (req, res) => {
    if (!marketplaceGate(res)) return;
    const rl = checkCreatorRateLimit({
      key: `cart-checkout:${clientIpFromReq(req)}`,
      limit: 60,
      windowMs: 60 * 60 * 1000,
    });
    if (!rl.ok) {
      res.setHeader("Retry-After", String(rl.retryAfterSec));
      return res.status(429).json({ error: "Too many checkout attempts. Try again later." });
    }
    try {
      if (!isCreatorStorefrontConfigured()) {
        return res.status(503).json({
          error: "CREATOR_STOREFRONT_NOT_CONFIGURED",
          message:
            "Set CREATOR_PLATFORM_SHOP_DOMAIN and CREATOR_STOREFRONT_API_TOKEN on Railway staging.",
        });
      }

      const body = req.body ?? {};
      const username = normalizeCreatorUsername(String(body.creatorUsername || ""));
      const variantId = String(body.variantId || "").trim();
      if (!username || !variantId) {
        return res.status(400).json({ error: "creatorUsername and variantId are required." });
      }

      const { assertPublicCreatorApiContext } = await import("../creator-host");
      const asserted = await assertPublicCreatorApiContext({
        shop: getCreatorPlatformShopDomain(),
        creatorUsername: username,
        requirePlatformShop: true,
      });
      if (!asserted.ok) {
        return res.status(asserted.status).json({ error: asserted.error });
      }
      const creator = asserted.creator;

      const props = (body.properties && typeof body.properties === "object"
        ? body.properties
        : {}) as Record<string, string>;

      const attributes: Array<{ key: string; value: string }> = [
        { key: "_creator_id", value: creator.id },
        { key: "_creator_username", value: creator.username },
      ];
      if (body.creatorSessionId) {
        attributes.push({ key: "_creator_session", value: String(body.creatorSessionId) });
      }
      for (const [key, value] of Object.entries(props)) {
        if (!key || value == null) continue;
        attributes.push({ key, value: String(value) });
      }

      const cart = await createCreatorCheckoutCart({
        variantId,
        quantity: Number(body.quantity) || 1,
        attributes,
      });

      const sessionId = body.creatorSessionId ? String(body.creatorSessionId) : null;
      void recordCreatorEvent({
        creatorId: creator.id,
        sessionId,
        eventType: "atc",
        generationJobId: props._appai_job_id || null,
        metadata: { variantId, cartId: cart.cartId },
      }).catch(() => {});
      void recordCreatorEvent({
        creatorId: creator.id,
        sessionId,
        eventType: "checkout_started",
        generationJobId: props._appai_job_id || null,
        metadata: { cartId: cart.cartId },
      }).catch(() => {});

      res.json({
        success: true,
        cartId: cart.cartId,
        checkoutUrl: cart.checkoutUrl,
        platformShopDomain: getCreatorPlatformShopDomain(),
      });
    } catch (e: any) {
      console.error("[creators] cart checkout failed:", e);
      res.status(500).json({ error: e?.message || "Failed to create checkout cart" });
    }
  });

  /** Admin: list customizer pages available to assign (platform shop + optional merchant shop). */
  app.get(
    "/api/platform/creators/:id/assignable-pages",
    isAuthenticated,
    async (req: any, res: Response) => {
      if (!requirePlatformAdmin(req, res)) return;
      try {
        const [creator] = await db
          .select()
          .from(creators)
          .where(eq(creators.id, req.params.id))
          .limit(1);
        if (!creator) return res.status(404).json({ error: "Creator not found" });

        const platformShop = getCreatorPlatformShopDomain();
        const shops = new Set<string>();
        if (platformShop) shops.add(platformShop);
        if (creator.shopDomain) shops.add(creator.shopDomain.toLowerCase());
        // Path A: merchant may still have pages on their own shop even if shopDomain not set yet
        const merchantShop = String(req.query.merchantShop || "")
          .trim()
          .toLowerCase();
        if (merchantShop.endsWith(".myshopify.com")) shops.add(merchantShop);

        if (shops.size === 0) {
          return res.json({ pages: [], platformShopDomain: null });
        }

        const pages = await db
          .select()
          .from(customizerPages)
          .where(
            and(
              inArray(customizerPages.shop, [...shops]),
              sql`${customizerPages.status} IS DISTINCT FROM 'disabled'`,
            ),
          )
          .orderBy(asc(customizerPages.shop), asc(customizerPages.title))
          .limit(500);

        const assigned = await db
          .select()
          .from(creatorCustomizerPages)
          .where(eq(creatorCustomizerPages.creatorId, creator.id));

        res.json({
          platformShopDomain: platformShop,
          assigned,
          pages: pages.map((p) => ({
            id: p.id,
            shop: p.shop,
            handle: p.handle,
            title: p.title,
            status: p.status,
            baseProductTitle: p.baseProductTitle,
            productTypeId: p.productTypeId,
          })),
        });
      } catch (e: any) {
        console.error("[creators] assignable-pages failed:", e);
        res.status(500).json({ error: e?.message || "Failed to list pages" });
      }
    },
  );

  /** Admin: replace assigned customizer pages for a creator. */
  app.put(
    "/api/platform/creators/:id/pages",
    isAuthenticated,
    async (req: any, res: Response) => {
      if (!requirePlatformAdmin(req, res)) return;
      try {
        const [creator] = await db
          .select()
          .from(creators)
          .where(eq(creators.id, req.params.id))
          .limit(1);
        if (!creator) return res.status(404).json({ error: "Creator not found" });

        const pageIds = Array.isArray(req.body?.customizerPageIds)
          ? (req.body.customizerPageIds as unknown[])
              .map((x) => String(x || "").trim())
              .filter(Boolean)
          : [];

        await db
          .delete(creatorCustomizerPages)
          .where(eq(creatorCustomizerPages.creatorId, creator.id));

        if (pageIds.length > 0) {
          await db.insert(creatorCustomizerPages).values(
            pageIds.map((customizerPageId, i) => ({
              creatorId: creator.id,
              customizerPageId,
              sortOrder: i,
              enabled: true,
            })),
          );
        }

        const assigned = await db
          .select()
          .from(creatorCustomizerPages)
          .where(eq(creatorCustomizerPages.creatorId, creator.id))
          .orderBy(asc(creatorCustomizerPages.sortOrder));

        invalidateCreatorHostCache(creator.username);
        res.json({ assigned });
      } catch (e: any) {
        console.error("[creators] set pages failed:", e);
        res.status(500).json({ error: e?.message || "Failed to assign pages" });
      }
    },
  );

  /** Admin: update creator quotas / status / shop link (Path A). */
  app.patch(
    "/api/platform/creators/:id",
    isAuthenticated,
    async (req: any, res: Response) => {
      if (!requirePlatformAdmin(req, res)) return;
      try {
        const [creator] = await db
          .select()
          .from(creators)
          .where(eq(creators.id, req.params.id))
          .limit(1);
        if (!creator) return res.status(404).json({ error: "Creator not found" });

        const body = req.body ?? {};
        const patch: Partial<typeof creators.$inferInsert> = { updatedAt: new Date() };

        if (body.freeGensPerCustomer != null) {
          patch.freeGensPerCustomer = clampFreeGensPerCustomer(Number(body.freeGensPerCustomer));
        }
        if (body.monthlyGenerationAllowance != null) {
          patch.monthlyGenerationAllowance = clampMonthlyGenerationAllowance(
            Number(body.monthlyGenerationAllowance),
          );
        }
        if (body.status && (CREATOR_STATUSES as readonly string[]).includes(String(body.status))) {
          patch.status = String(body.status);
        }
        if (body.shopDomain !== undefined) {
          const d = String(body.shopDomain || "")
            .trim()
            .toLowerCase();
          patch.shopDomain = d
            ? d.endsWith(".myshopify.com")
              ? d
              : `${d.replace(/\.myshopify\.com$/i, "")}.myshopify.com`
            : null;
        }
        if (body.onboardingStatus != null) {
          patch.onboardingStatus = String(body.onboardingStatus);
        }
        if (body.displayName != null) {
          const dn = String(body.displayName || "").trim();
          if (dn) patch.displayName = dn.slice(0, 120);
        }
        if (body.overageCap != null) {
          patch.overageCap = Math.max(0, Math.round(Number(body.overageCap) || 0));
        }
        const share = parseSharePatch(body);
        if (share.shareBasis) patch.shareBasis = share.shareBasis;
        if (share.revenueShareCreatorPct != null) {
          patch.revenueShareCreatorPct = share.revenueShareCreatorPct;
        }
        if (share.revenueShareAasPct != null) {
          patch.revenueShareAasPct = share.revenueShareAasPct;
        }
        if (body.betaStartAt !== undefined) {
          patch.betaStartAt = body.betaStartAt ? new Date(String(body.betaStartAt)) : null;
        }
        if (body.betaEndAt !== undefined) {
          patch.betaEndAt = body.betaEndAt ? new Date(String(body.betaEndAt)) : null;
        }
        if (body.emailAutomationToggles && typeof body.emailAutomationToggles === "object") {
          patch.emailAutomationToggles = body.emailAutomationToggles as Record<string, boolean>;
        }
        // Shop name / tagline live in branding JSON (storefront reads headline + description).
        if (body.shopName !== undefined || body.shopDescription !== undefined) {
          const prev =
            creator.branding && typeof creator.branding === "object"
              ? { ...(creator.branding as Record<string, unknown>) }
              : {};
          if (body.shopName !== undefined) {
            const headline = String(body.shopName || "").trim().slice(0, 120);
            if (headline) prev.headline = headline;
            else delete prev.headline;
          }
          if (body.shopDescription !== undefined) {
            const description = String(body.shopDescription || "").trim().slice(0, 500);
            if (description) prev.description = description;
            else delete prev.description;
          }
          patch.branding = prev;
        }

        // Starting active_beta without end date → default beta window.
        if (patch.status === "active_beta" && !creator.betaStartAt && patch.betaStartAt === undefined) {
          patch.betaStartAt = new Date();
        }
        if (
          patch.status === "active_beta" &&
          !creator.betaEndAt &&
          patch.betaEndAt === undefined &&
          body.betaEndAt === undefined
        ) {
          const end = new Date();
          end.setUTCDate(end.getUTCDate() + DEFAULT_CREATOR_BETA_DAYS);
          patch.betaEndAt = end;
        }

        const [updated] = await db
          .update(creators)
          .set(patch)
          .where(eq(creators.id, creator.id))
          .returning();

        invalidateCreatorHostCache(updated.username);
        res.json({ creator: sanitizeCreatorForAdmin(updated) });
      } catch (e: any) {
        console.error("[creators] patch creator failed:", e);
        res.status(500).json({ error: e?.message || "Failed to update creator" });
      }
    },
  );

  app.get(
    "/api/platform/creators/:id",
    isAuthenticated,
    async (req: any, res: Response) => {
      if (!requirePlatformAdmin(req, res)) return;
      const [creator] = await db
        .select()
        .from(creators)
        .where(eq(creators.id, req.params.id))
        .limit(1);
      if (!creator) return res.status(404).json({ error: "Creator not found" });
      const assigned = await db
        .select()
        .from(creatorCustomizerPages)
        .where(eq(creatorCustomizerPages.creatorId, creator.id))
        .orderBy(asc(creatorCustomizerPages.sortOrder));
      const payoutSummary = await getCreatorPayoutSummary(creator.id);
      const notes = await db
        .select()
        .from(creatorNotes)
        .where(eq(creatorNotes.creatorId, creator.id))
        .orderBy(desc(creatorNotes.createdAt))
        .limit(50);
      const emails = await db
        .select()
        .from(creatorEmailLog)
        .where(eq(creatorEmailLog.creatorId, creator.id))
        .orderBy(desc(creatorEmailLog.createdAt))
        .limit(30);
      res.json({
        creator: sanitizeCreatorForAdmin(creator),
        assigned,
        payoutSummary,
        notes,
        emails,
      });
    },
  );

  /** Partner / beta lifecycle actions. */
  app.post(
    "/api/platform/creators/:id/actions",
    isAuthenticated,
    async (req: any, res: Response) => {
      if (!requirePlatformAdmin(req, res)) return;
      try {
        const action = String(req.body?.action || "");
        if (!isCreatorBetaAction(action)) {
          return res.status(400).json({ error: "Invalid action." });
        }
        const [creator] = await db
          .select()
          .from(creators)
          .where(eq(creators.id, req.params.id))
          .limit(1);
        if (!creator) return res.status(404).json({ error: "Creator not found" });
        const updated = await applyCreatorBetaAction({
          creator,
          action,
          extendDays: req.body?.extendDays != null ? Number(req.body.extendDays) : undefined,
        });
        res.json({ creator: sanitizeCreatorForAdmin(updated) });
      } catch (e: any) {
        console.error("[creators] action failed:", e);
        res.status(500).json({ error: e?.message || "Action failed" });
      }
    },
  );

  app.get(
    "/api/platform/creators/:id/payouts",
    isAuthenticated,
    async (req: any, res: Response) => {
      if (!requirePlatformAdmin(req, res)) return;
      const summary = await getCreatorPayoutSummary(req.params.id);
      const payouts = await listCreatorPayouts(req.params.id);
      res.json({ summary, payouts });
    },
  );

  app.post(
    "/api/platform/creators/:id/payouts",
    isAuthenticated,
    async (req: any, res: Response) => {
      if (!requirePlatformAdmin(req, res)) return;
      try {
        const body = req.body ?? {};
        const amountCents =
          body.amountCents != null
            ? Math.round(Number(body.amountCents))
            : Math.round(Number(body.amountDollars || 0) * 100);
        const payout = await recordCreatorPayout({
          creatorId: req.params.id,
          amountCents,
          method: body.method ? String(body.method) : null,
          adminNote: body.adminNote ? String(body.adminNote) : null,
          markPaid: !!body.markPaid,
          status: body.status,
          periodStart: body.periodStart ? new Date(String(body.periodStart)) : null,
          periodEnd: body.periodEnd ? new Date(String(body.periodEnd)) : null,
        });
        const summary = await getCreatorPayoutSummary(req.params.id);
        res.status(201).json({ payout, summary });
      } catch (e: any) {
        console.error("[creators] record payout failed:", e);
        res.status(400).json({ error: e?.message || "Failed to record payout" });
      }
    },
  );

  app.patch(
    "/api/platform/creators/:id/payouts/:payoutId",
    isAuthenticated,
    async (req: any, res: Response) => {
      if (!requirePlatformAdmin(req, res)) return;
      try {
        const status = String(req.body?.status || "");
        const payout = await updateCreatorPayoutStatus({
          payoutId: req.params.payoutId,
          creatorId: req.params.id,
          status: status as any,
        });
        if (!payout) return res.status(404).json({ error: "Payout not found" });
        const summary = await getCreatorPayoutSummary(req.params.id);
        res.json({ payout, summary });
      } catch (e: any) {
        res.status(400).json({ error: e?.message || "Failed to update payout" });
      }
    },
  );

  app.post(
    "/api/platform/creators/:id/notes",
    isAuthenticated,
    async (req: any, res: Response) => {
      if (!requirePlatformAdmin(req, res)) return;
      const body = String(req.body?.body || "").trim();
      if (!body) return res.status(400).json({ error: "Note body is required." });
      const [note] = await db
        .insert(creatorNotes)
        .values({
          creatorId: req.params.id,
          author: req.shopDomain || "admin",
          body: body.slice(0, 5000),
        })
        .returning();
      res.status(201).json({ note });
    },
  );

  /** Admin: recent daily attribution rollups for a creator. */
  app.get(
    "/api/platform/creators/:id/stats",
    isAuthenticated,
    async (req: any, res: Response) => {
      if (!requirePlatformAdmin(req, res)) return;
      const days = Math.min(90, Math.max(1, parseInt(String(req.query.days || "14"), 10) || 14));
      // Ensure today is fresh before reading.
      await rollupCreatorDailyStats({
        day: utcDayKey(),
        creatorId: req.params.id,
      }).catch(() => {});
      const rows = await db
        .select()
        .from(creatorDailyStats)
        .where(eq(creatorDailyStats.creatorId, req.params.id))
        .orderBy(desc(creatorDailyStats.day))
        .limit(days);
      res.json({ days: rows });
    },
  );

  /** Admin: recent creator order ledger rows (+ lines). */
  app.get(
    "/api/platform/creators/:id/orders",
    isAuthenticated,
    async (req: any, res: Response) => {
      if (!requirePlatformAdmin(req, res)) return;
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "25"), 10) || 25));
      const orders = await db
        .select()
        .from(creatorOrders)
        .where(eq(creatorOrders.creatorId, req.params.id))
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
      const linesByOrder = new Map<string, typeof lines>();
      for (const line of lines) {
        const list = linesByOrder.get(line.creatorOrderId) || [];
        list.push(line);
        linesByOrder.set(line.creatorOrderId, list);
      }
      res.json({
        orders: orders.map((o) => ({
          ...o,
          lines: linesByOrder.get(o.id) || [],
        })),
      });
    },
  );

  app.get(
    "/api/platform/style-catalog",
    isAuthenticated,
    async (req: any, res: Response) => {
      if (!requirePlatformAdmin(req, res)) return;
      try {
        const {
          getNormalizedPlatformShop,
          getPlatformMerchantId,
          listAssignableCatalog,
        } = await import("../creator-styles");
        const styles = await listAssignableCatalog();
        res.json({
          shop: getNormalizedPlatformShop(),
          merchantId: await getPlatformMerchantId(),
          styles: styles.map((s) => ({
            id: s.id,
            name: s.name,
            category: s.category,
            creatorScope: (s as any).creatorScope || "merchant",
            isActive: s.isActive,
            sortOrder: s.sortOrder,
          })),
        });
      } catch (e: any) {
        console.error("[creators] style catalog failed:", e);
        res.status(500).json({ error: e?.message || "Failed to load style catalog" });
      }
    },
  );

  app.get(
    "/api/platform/creators/:id/styles",
    isAuthenticated,
    async (req: any, res: Response) => {
      if (!requirePlatformAdmin(req, res)) return;
      const [creator] = await db
        .select({ id: creators.id })
        .from(creators)
        .where(eq(creators.id, req.params.id))
        .limit(1);
      if (!creator) return res.status(404).json({ error: "Creator not found" });
      const { listCreatorStyleAssignments } = await import("../creator-styles");
      const styles = await listCreatorStyleAssignments(creator.id);
      res.json({ styles });
    },
  );

  app.post(
    "/api/platform/creators/:id/styles/assign",
    isAuthenticated,
    async (req: any, res: Response) => {
      if (!requirePlatformAdmin(req, res)) return;
      try {
        const ids = parseStylePresetIds(req.body?.stylePresetIds);
        if (ids.length === 0) {
          return res.status(400).json({ error: "stylePresetIds is required." });
        }
        const { assignStylesToCreator } = await import("../creator-styles");
        const styles = await assignStylesToCreator({
          creatorId: req.params.id,
          stylePresetIds: ids,
        });
        res.json({ styles });
      } catch (e: any) {
        console.error("[creators] assign styles failed:", e);
        res.status(400).json({ error: e?.message || "Failed to assign styles" });
      }
    },
  );

  app.post(
    "/api/platform/creators/:id/styles/retire",
    isAuthenticated,
    async (req: any, res: Response) => {
      if (!requirePlatformAdmin(req, res)) return;
      try {
        const ids = parseStylePresetIds(req.body?.stylePresetIds);
        if (ids.length === 0) {
          return res.status(400).json({ error: "stylePresetIds is required." });
        }
        const { retireCreatorStyles } = await import("../creator-styles");
        const styles = await retireCreatorStyles({
          creatorId: req.params.id,
          stylePresetIds: ids,
        });
        res.json({ styles });
      } catch (e: any) {
        console.error("[creators] retire styles failed:", e);
        res.status(400).json({ error: e?.message || "Failed to retire styles" });
      }
    },
  );

  app.post(
    "/api/platform/creators/:id/styles/duplicate",
    isAuthenticated,
    async (req: any, res: Response) => {
      if (!requirePlatformAdmin(req, res)) return;
      try {
        const sourceStylePresetId = Number(req.body?.sourceStylePresetId);
        if (!Number.isInteger(sourceStylePresetId) || sourceStylePresetId <= 0) {
          return res.status(400).json({ error: "sourceStylePresetId is required." });
        }
        const { duplicateStyleAndAssignExclusive } = await import("../creator-styles");
        const style = await duplicateStyleAndAssignExclusive({
          sourceStylePresetId,
          creatorId: req.params.id,
          name: req.body?.name ? String(req.body.name) : undefined,
        });
        res.status(201).json({ style });
      } catch (e: any) {
        console.error("[creators] duplicate style failed:", e);
        res.status(400).json({ error: e?.message || "Failed to duplicate style" });
      }
    },
  );
}

function parseStylePresetIds(raw: unknown): number[] {
  const arr = Array.isArray(raw) ? raw : [];
  return [...new Set(arr.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0))];
}
