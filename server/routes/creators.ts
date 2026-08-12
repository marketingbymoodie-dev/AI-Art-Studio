/**
 * Creator Marketplace — Phase 1–5 routes:
 * - Public apply, storefront, Storefront cart, analytics session/events
 * - Admin applications, page assign, quotas, daily stats, order ledger
 */
import { type Express, type Response } from "express";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  creatorApplications,
  creatorCustomizerPages,
  creatorDailyStats,
  creatorNotes,
  creatorOrderLines,
  creatorOrders,
  creators,
  customizerPages,
} from "@shared/schema";
import {
  CREATOR_APPLICATION_STATUSES,
  CREATOR_STATUSES,
  DEFAULT_CREATOR_FREE_GENS_PER_CUSTOMER,
  DEFAULT_CREATOR_MONTHLY_GENERATION_ALLOWANCE,
  SOCIAL_PLATFORMS,
  clampFreeGensPerCustomer,
  clampMonthlyGenerationAllowance,
  normalizeCreatorUsername,
  type CreatorApplicationStatus,
} from "@shared/creatorMarketplace";
import { requirePlatformAdmin } from "../platformAdmin";
import {
  getAiGenerationCostUsd,
  getCreatorPlatformShopDomain,
  getCreatorPlatformStorefrontToken,
  isCreatorMarketplaceEnabled,
} from "../creator-config";
import {
  getCreatorStorefrontByUsername,
  invalidateCreatorHostCache,
  lookupCreatorByUsername,
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
    try {
      const body = req.body ?? {};
      const firstName = String(body.firstName || "").trim();
      const lastName = String(body.lastName || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const socialPlatform = String(body.socialPlatform || "").trim().toLowerCase();
      const socialUsername = String(body.socialUsername || "").trim();
      const niche = String(body.niche || "").trim();
      const hasShopifyStore = !!body.hasShopifyStore;

      if (!firstName || !lastName || !email || !socialPlatform || !socialUsername || !niche) {
        return res.status(400).json({
          error: "First name, last name, email, social platform, social username, and niche are required.",
        });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Enter a valid email address." });
      }
      if (!(SOCIAL_PLATFORMS as readonly string[]).includes(socialPlatform)) {
        return res.status(400).json({ error: "Unsupported social platform." });
      }
      if (hasShopifyStore && !String(body.shopifyStoreUrl || "").trim()) {
        return res.status(400).json({ error: "Shopify store URL is required when you have a store." });
      }

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
          shopifyStoreUrl: String(body.shopifyStoreUrl || "").trim() || null,
          interestedProducts: String(body.interestedProducts || "").trim() || null,
          preferredCategory: String(body.preferredCategory || "").trim() || null,
          whyParticipate: String(body.whyParticipate || "").trim() || null,
          expectedReach: String(body.expectedReach || "").trim() || null,
          additionalInfo: String(body.additionalInfo || "").trim() || null,
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
   * Does not send email yet (toggles / Phase 9).
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
    res.json({ creators: rows });
  });

  app.get("/api/platform/creators/config", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    res.json({
      enabled: isCreatorMarketplaceEnabled(),
      platformShopDomain: getCreatorPlatformShopDomain(),
      storefrontTokenConfigured: !!getCreatorPlatformStorefrontToken(),
      aiGenerationCostUsd: await getAiGenerationCostUsd(),
      applicationCount: (
        await db.select({ n: sql<number>`count(*)::int` }).from(creatorApplications)
      )[0]?.n ?? 0,
      creatorCount: (
        await db.select({ n: sql<number>`count(*)::int` }).from(creators)
      )[0]?.n ?? 0,
    });
  });

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
    try {
      const body = req.body ?? {};
      const creatorId = await resolveCreatorId({
        creatorId: body.creatorId,
        creatorUsername: body.creatorUsername,
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
    try {
      const body = req.body ?? {};
      const eventType = String(body.eventType || "");
      if (!isCreatorEventType(eventType)) {
        return res.status(400).json({ error: "Invalid eventType." });
      }
      const creatorId = await resolveCreatorId({
        creatorId: body.creatorId,
        creatorUsername: body.creatorUsername,
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

  /**
   * Create a Storefront API cart on the platform shop and return checkoutUrl.
   * Client resolves shadow variant first, then posts here (creator host adapter).
   */
  app.post("/api/creators/cart/checkout", async (req, res) => {
    if (!marketplaceGate(res)) return;
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

      const creator = await lookupCreatorByUsername(username);
      if (!creator) {
        return res.status(404).json({ error: "Creator not found." });
      }
      if (["paused", "suspended", "archived"].includes(creator.status)) {
        return res.status(403).json({ error: "This creator shop is not accepting checkouts." });
      }

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

        const [updated] = await db
          .update(creators)
          .set(patch)
          .where(eq(creators.id, creator.id))
          .returning();

        invalidateCreatorHostCache(updated.username);
        res.json({ creator: updated });
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
      res.json({ creator, assigned });
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
}
