/**
 * Creator Marketplace — Phase 1 routes:
 * - Public application submit
 * - Admin application queue + review actions
 * - Platform config read (AI generation cost)
 */
import { type Express, type Response } from "express";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  creatorApplications,
  creatorNotes,
  creators,
} from "@shared/schema";
import {
  CREATOR_APPLICATION_STATUSES,
  CREATOR_STATUSES,
  DEFAULT_CREATOR_FREE_GENS_PER_CUSTOMER,
  DEFAULT_CREATOR_MONTHLY_GENERATION_ALLOWANCE,
  SOCIAL_PLATFORMS,
  normalizeCreatorUsername,
  type CreatorApplicationStatus,
} from "@shared/creatorMarketplace";
import { requirePlatformAdmin } from "../platformAdmin";
import {
  getAiGenerationCostUsd,
  isCreatorMarketplaceEnabled,
} from "../creator-config";
import {
  getCreatorStorefrontByUsername,
  invalidateCreatorHostCache,
} from "../creator-host";

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
      platformShopDomain: process.env.CREATOR_PLATFORM_SHOP_DOMAIN || null,
      aiGenerationCostUsd: await getAiGenerationCostUsd(),
      applicationCount: (
        await db.select({ n: sql<number>`count(*)::int` }).from(creatorApplications)
      )[0]?.n ?? 0,
      creatorCount: (
        await db.select({ n: sql<number>`count(*)::int` }).from(creators)
      )[0]?.n ?? 0,
    });
  });
}
