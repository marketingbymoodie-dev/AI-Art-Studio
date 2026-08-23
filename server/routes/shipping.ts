/**
 * Shipping Coverage Service routes — Phase 1.
 * Operator endpoints (platform admin) + internal coverage API.
 */
import type { Express, RequestHandler, Response } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  productTypes,
  shippingClasses,
  shippingRateAudit,
  shippingRates,
  shippingSyncRuns,
  shippingZoneRules,
  variantShipping,
} from "@shared/schema";
import { requirePlatformAdmin } from "../platformAdmin";
import {
  getCoverageForProducts,
  getShippableProductIdSet,
  getShippingTierConfig,
  ingestShippingClass,
  reevaluateAllClassTiers,
  reevaluateClassTiers,
  runShippingTablesSync,
  setShippingTierConfig,
  type VariantGroupDef,
} from "../shipping-tables";
import {
  getStoreShippingSettings,
  reconcileShopShipping,
  removeAllShopShippingProfiles,
  updateStoreShippingSettings,
} from "../shipping-reconciler";
import { shippingStoreProfiles, shippingStoreSettings, shippingStoreVariants } from "@shared/schema";
import { normalizeMyshopifyShopDomain } from "../shopDomain";

type AuthMw = RequestHandler;

function parseIntOr(raw: unknown, fallback: number | null = null): number | null {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function registerShippingRoutes(app: Express, deps: { isAuthenticated: AuthMw }) {
  const { isAuthenticated } = deps;

  // ── Internal coverage API (spec 0.3 / 2.4) ────────────────────────────────
  // Consumed by storefront listing filters + the customizer gate in later
  // phases. Non-sensitive derived data; no merchant secrets.

  /** GET /api/shipping/coverage?country=CA&productIds=1,2,3 */
  app.get("/api/shipping/coverage", async (req, res: Response) => {
    try {
      const country = String(req.query.country || "").trim().toUpperCase();
      const productIds = String(req.query.productIds || "")
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0)
        .slice(0, 500);
      if (!country || country.length > 3 || productIds.length === 0) {
        return res.status(400).json({ error: "country and productIds are required" });
      }
      const items = await getCoverageForProducts(country, productIds);
      return res.json({ country, items });
    } catch (e: any) {
      console.error("[shipping-routes] coverage failed:", e?.message || e);
      return res.status(500).json({ error: "Coverage lookup failed" });
    }
  });

  /** GET /api/shipping/coverage/sets?country=CA — cached shippable id set. */
  app.get("/api/shipping/coverage/sets", async (req, res: Response) => {
    try {
      const country = String(req.query.country || "").trim().toUpperCase();
      if (!country || country.length > 3) {
        return res.status(400).json({ error: "country is required" });
      }
      const ids = await getShippableProductIdSet(country);
      return res.json({ country, shippableProductTypeIds: ids });
    } catch (e: any) {
      console.error("[shipping-routes] coverage sets failed:", e?.message || e);
      return res.status(500).json({ error: "Coverage set lookup failed" });
    }
  });

  // ── Operator endpoints (platform admin only) ──────────────────────────────

  /** GET /api/platform/shipping/overview — all classes + tier summaries. */
  app.get("/api/platform/shipping/overview", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const classes = await db
        .select()
        .from(shippingClasses)
        .orderBy(shippingClasses.name);
      const classIds = classes.map((c) => c.id);
      const rates = classIds.length
        ? await db
            .select({
              shippingClassId: shippingRates.shippingClassId,
              countryCode: shippingRates.countryCode,
              tier: shippingRates.tier,
            })
            .from(shippingRates)
            .where(inArray(shippingRates.shippingClassId, classIds))
        : [];
      const variantCounts = classIds.length
        ? await db
            .select({
              shippingClassId: variantShipping.shippingClassId,
              productTypeId: variantShipping.productTypeId,
            })
            .from(variantShipping)
            .where(inArray(variantShipping.shippingClassId, classIds))
        : [];

      const tierSummary = new Map<
        number,
        { zones: Set<string>; normal: Set<string>; warned: Set<string>; excluded: Set<string> }
      >();
      for (const r of rates) {
        const slot =
          tierSummary.get(r.shippingClassId) ||
          { zones: new Set(), normal: new Set(), warned: new Set(), excluded: new Set() };
        slot.zones.add(r.countryCode);
        if (r.tier === "excluded") slot.excluded.add(r.countryCode);
        else if (r.tier === "warned") slot.warned.add(r.countryCode);
        else slot.normal.add(r.countryCode);
        tierSummary.set(r.shippingClassId, slot);
      }
      const productsByClass = new Map<number, Set<number>>();
      const variantsByClass = new Map<number, number>();
      for (const v of variantCounts) {
        const set = productsByClass.get(v.shippingClassId) || new Set<number>();
        set.add(v.productTypeId);
        productsByClass.set(v.shippingClassId, set);
        variantsByClass.set(v.shippingClassId, (variantsByClass.get(v.shippingClassId) || 0) + 1);
      }

      const config = await getShippingTierConfig();
      return res.json({
        config,
        classes: classes.map((c) => {
          let groups: VariantGroupDef[] = [];
          try {
            groups = JSON.parse(c.variantGroupsJson);
          } catch {
            /* ignore */
          }
          const t = tierSummary.get(c.id);
          return {
            id: c.id,
            blueprintId: c.blueprintId,
            providerId: c.providerId,
            name: c.name,
            shippingMethod: c.shippingMethod,
            tableHash: c.tableHash,
            groupCount: groups.length,
            zoneCount: t?.zones.size ?? 0,
            normalZones: t ? Array.from(t.normal).sort() : [],
            warnedZones: t ? Array.from(t.warned).sort() : [],
            excludedZones: t ? Array.from(t.excluded).sort() : [],
            productCount: productsByClass.get(c.id)?.size ?? 0,
            variantCount: variantsByClass.get(c.id) ?? 0,
            absoluteCapCentsOverride: c.absoluteCapCentsOverride,
            typicalRetailCentsOverride: c.typicalRetailCentsOverride,
            lastFetchedAt: c.lastFetchedAt,
            lastChangedAt: c.lastChangedAt,
            lastError: c.lastError,
          };
        }),
      });
    } catch (e: any) {
      console.error("[shipping-routes] overview failed:", e?.message || e);
      return res.status(500).json({ error: e?.message || "Overview failed" });
    }
  });

  /** GET /api/platform/shipping/classes/:id — full rate matrix + audits. */
  app.get("/api/platform/shipping/classes/:id", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const id = parseIntOr(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid class id" });
      const [cls] = await db.select().from(shippingClasses).where(eq(shippingClasses.id, id));
      if (!cls) return res.status(404).json({ error: "Shipping class not found" });

      let groups: VariantGroupDef[] = [];
      try {
        groups = JSON.parse(cls.variantGroupsJson);
      } catch {
        /* ignore */
      }
      const rates = await db
        .select()
        .from(shippingRates)
        .where(eq(shippingRates.shippingClassId, id));
      const audits = await db
        .select()
        .from(shippingRateAudit)
        .where(eq(shippingRateAudit.shippingClassId, id))
        .orderBy(desc(shippingRateAudit.createdAt))
        .limit(100);
      const variants = await db
        .select()
        .from(variantShipping)
        .where(eq(variantShipping.shippingClassId, id));
      const rules = await db
        .select()
        .from(shippingZoneRules)
        .where(inArray(shippingZoneRules.shippingClassId, [0, id]));

      const productIds = Array.from(new Set(variants.map((v) => v.productTypeId)));
      const products = productIds.length
        ? await db
            .select({ id: productTypes.id, name: productTypes.name })
            .from(productTypes)
            .where(inArray(productTypes.id, productIds))
        : [];

      return res.json({
        class: cls,
        groups,
        rates,
        audits,
        rules,
        products,
        variantCount: variants.length,
      });
    } catch (e: any) {
      console.error("[shipping-routes] class detail failed:", e?.message || e);
      return res.status(500).json({ error: e?.message || "Class detail failed" });
    }
  });

  /** PATCH /api/platform/shipping/classes/:id — per-class overrides. */
  app.patch("/api/platform/shipping/classes/:id", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const id = parseIntOr(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid class id" });
      const [cls] = await db.select().from(shippingClasses).where(eq(shippingClasses.id, id));
      if (!cls) return res.status(404).json({ error: "Shipping class not found" });

      const body = req.body ?? {};
      const patch: Partial<typeof shippingClasses.$inferInsert> = { updatedAt: new Date() };
      if ("absoluteCapCentsOverride" in body) {
        const v = body.absoluteCapCentsOverride;
        patch.absoluteCapCentsOverride = v == null || v === "" ? null : parseIntOr(v);
      }
      if ("typicalRetailCentsOverride" in body) {
        const v = body.typicalRetailCentsOverride;
        patch.typicalRetailCentsOverride = v == null || v === "" ? null : parseIntOr(v);
      }
      if (typeof body.name === "string" && body.name.trim()) {
        patch.name = body.name.trim().slice(0, 200);
      }
      await db.update(shippingClasses).set(patch).where(eq(shippingClasses.id, id));
      await reevaluateClassTiers(id);
      return res.json({ ok: true });
    } catch (e: any) {
      console.error("[shipping-routes] class patch failed:", e?.message || e);
      return res.status(500).json({ error: e?.message || "Class update failed" });
    }
  });

  /** POST /api/platform/shipping/classes/:id/resync — force refetch one class. */
  app.post(
    "/api/platform/shipping/classes/:id/resync",
    isAuthenticated,
    async (req: any, res: Response) => {
      if (!requirePlatformAdmin(req, res)) return;
      try {
        const id = parseIntOr(req.params.id);
        if (!id) return res.status(400).json({ error: "Invalid class id" });
        const [cls] = await db.select().from(shippingClasses).where(eq(shippingClasses.id, id));
        if (!cls) return res.status(404).json({ error: "Shipping class not found" });
        const result = await ingestShippingClass({
          blueprintId: cls.blueprintId,
          providerId: cls.providerId,
          force: true,
        });
        return res.json({ ok: result.status !== "failed", result });
      } catch (e: any) {
        console.error("[shipping-routes] class resync failed:", e?.message || e);
        return res.status(500).json({ error: e?.message || "Resync failed" });
      }
    },
  );

  /** POST /api/platform/shipping/classes — ingest an arbitrary (blueprint, provider) pair. */
  app.post("/api/platform/shipping/classes", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const blueprintId = parseIntOr(req.body?.blueprintId);
      const providerId = parseIntOr(req.body?.providerId);
      if (!blueprintId || !providerId) {
        return res.status(400).json({ error: "blueprintId and providerId required" });
      }
      const result = await ingestShippingClass({ blueprintId, providerId, force: true });
      return res.json({ ok: result.status !== "failed", result });
    } catch (e: any) {
      console.error("[shipping-routes] class ingest failed:", e?.message || e);
      return res.status(500).json({ error: e?.message || "Ingest failed" });
    }
  });

  /** POST /api/platform/shipping/sync — force full catalogue sync. */
  app.post("/api/platform/shipping/sync", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const summary = await runShippingTablesSync({ source: "manual", force: true });
      return res.json(summary);
    } catch (e: any) {
      console.error("[shipping-routes] manual sync failed:", e?.message || e);
      return res.status(500).json({ error: e?.message || "Sync failed" });
    }
  });

  /** GET /api/platform/shipping/runs — recent sync runs. */
  app.get("/api/platform/shipping/runs", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const runs = await db
        .select()
        .from(shippingSyncRuns)
        .orderBy(desc(shippingSyncRuns.startedAt))
        .limit(30);
      return res.json({ runs });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message || "Runs lookup failed" });
    }
  });

  /** GET/PUT /api/platform/shipping/config — tier thresholds. */
  app.get("/api/platform/shipping/config", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    return res.json({ config: await getShippingTierConfig() });
  });

  app.put("/api/platform/shipping/config", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const body = req.body ?? {};
      const config = await setShippingTierConfig({
        offerThresholdBp: parseIntOr(body.offerThresholdBp) ?? undefined,
        excludeThresholdBp: parseIntOr(body.excludeThresholdBp) ?? undefined,
        absoluteCapCents: parseIntOr(body.absoluteCapCents) ?? undefined,
        retailMarkupBp: parseIntOr(body.retailMarkupBp) ?? undefined,
      });
      const reevaluated = await reevaluateAllClassTiers();
      return res.json({ ok: true, config, reevaluated });
    } catch (e: any) {
      console.error("[shipping-routes] config update failed:", e?.message || e);
      return res.status(500).json({ error: e?.message || "Config update failed" });
    }
  });

  /** GET /api/platform/shipping/rules — manual block/allow list. */
  app.get("/api/platform/shipping/rules", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    const rules = await db.select().from(shippingZoneRules).orderBy(shippingZoneRules.countryCode);
    return res.json({ rules });
  });

  /** POST /api/platform/shipping/rules — upsert a block/allow rule. */
  app.post("/api/platform/shipping/rules", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const body = req.body ?? {};
      const shippingClassId = parseIntOr(body.shippingClassId, 0) ?? 0;
      const countryCode = String(body.countryCode || "").trim().toUpperCase();
      const action = String(body.action || "").trim().toLowerCase();
      if (!countryCode || countryCode.length > 3 || !["block", "allow"].includes(action)) {
        return res.status(400).json({ error: "countryCode and action (block|allow) required" });
      }
      const existing = await db
        .select()
        .from(shippingZoneRules)
        .where(
          and(
            eq(shippingZoneRules.shippingClassId, shippingClassId),
            eq(shippingZoneRules.countryCode, countryCode),
          ),
        );
      if (existing.length) {
        await db
          .update(shippingZoneRules)
          .set({ action, note: body.note ? String(body.note).slice(0, 500) : null })
          .where(eq(shippingZoneRules.id, existing[0].id));
      } else {
        await db.insert(shippingZoneRules).values({
          shippingClassId,
          countryCode,
          action,
          note: body.note ? String(body.note).slice(0, 500) : null,
        });
      }
      if (shippingClassId === 0) {
        await reevaluateAllClassTiers();
      } else {
        await reevaluateClassTiers(shippingClassId);
      }
      return res.json({ ok: true });
    } catch (e: any) {
      console.error("[shipping-routes] rule upsert failed:", e?.message || e);
      return res.status(500).json({ error: e?.message || "Rule update failed" });
    }
  });

  // ── Phase 3: per-store delivery-profile reconciler ─────────────────────────

  /** GET /api/platform/shipping/stores — settings + budget for every known store. */
  app.get("/api/platform/shipping/stores", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const rows = await db.select().from(shippingStoreSettings);
      const stores = [];
      for (const s of rows) {
        const profiles = await db
          .select({ id: shippingStoreProfiles.id, status: shippingStoreProfiles.status })
          .from(shippingStoreProfiles)
          .where(eq(shippingStoreProfiles.shopDomain, s.shopDomain));
        const [variantCount] = await db
          .select({ count: shippingStoreVariants.id })
          .from(shippingStoreVariants)
          .where(eq(shippingStoreVariants.shopDomain, s.shopDomain));
        let summary: Record<string, unknown> = {};
        try {
          summary = JSON.parse(s.lastReconcileSummaryJson || "{}");
        } catch {
          /* ignore */
        }
        stores.push({
          shopDomain: s.shopDomain,
          shippingMode: s.shippingMode,
          manageVariantWeights: s.manageVariantWeights,
          probedMaxRatesPerZone: s.probedMaxRatesPerZone,
          lastReconcileAt: s.lastReconcileAt,
          lastReconcileStatus: s.lastReconcileStatus,
          lastReconcileError: s.lastReconcileError,
          mappedProfiles: profiles.length,
          erroredProfiles: profiles.filter((p) => p.status === "error").length,
          hasVariants: !!variantCount,
          /** Budget surfacing (amendment B): used/90, warn at 70. */
          customProfilesUsed: (summary as any).customProfilesUsed ?? null,
          profileBudget: 90,
          profileWarnAt: 70,
        });
      }
      return res.json({ stores });
    } catch (e: any) {
      console.error("[shipping-routes] stores failed:", e?.message || e);
      return res.status(500).json({ error: e?.message || "Stores lookup failed" });
    }
  });

  /** PATCH /api/platform/shipping/stores/:shop — mode + weight toggles. */
  app.patch(
    "/api/platform/shipping/stores/:shop",
    isAuthenticated,
    async (req: any, res: Response) => {
      if (!requirePlatformAdmin(req, res)) return;
      try {
        const shop = normalizeMyshopifyShopDomain(String(req.params.shop || ""));
        if (!shop) return res.status(400).json({ error: "Invalid shop" });
        const body = req.body ?? {};
        const patch: Record<string, unknown> = {};
        if ("shippingMode" in body) {
          const mode = String(body.shippingMode);
          if (!["off", "table", "exact"].includes(mode)) {
            return res.status(400).json({ error: "shippingMode must be off|table|exact" });
          }
          patch.shippingMode = mode;
        }
        if ("manageVariantWeights" in body) {
          patch.manageVariantWeights = !!body.manageVariantWeights;
        }
        const settings = await updateStoreShippingSettings(shop, patch);
        return res.json({ ok: true, settings });
      } catch (e: any) {
        return res.status(500).json({ error: e?.message || "Store update failed" });
      }
    },
  );

  /**
   * POST /api/platform/shipping/stores/:shop/reconcile { dryRun }
   * dryRun=true → plan counts only, no Shopify writes.
   * dryRun=false → full apply (requires shippingMode=table).
   */
  app.post(
    "/api/platform/shipping/stores/:shop/reconcile",
    isAuthenticated,
    async (req: any, res: Response) => {
      if (!requirePlatformAdmin(req, res)) return;
      try {
        const shop = normalizeMyshopifyShopDomain(String(req.params.shop || ""));
        if (!shop) return res.status(400).json({ error: "Invalid shop" });
        const dryRun = req.body?.dryRun !== false;
        const summary = await reconcileShopShipping(shop, { dryRun, source: "operator" });
        return res.json({ ok: summary.errors.length === 0, summary });
      } catch (e: any) {
        console.error("[shipping-routes] reconcile failed:", e?.message || e);
        return res.status(500).json({ error: e?.message || "Reconcile failed" });
      }
    },
  );

  /** POST /api/platform/shipping/stores/:shop/disable — kill switch. */
  app.post(
    "/api/platform/shipping/stores/:shop/disable",
    isAuthenticated,
    async (req: any, res: Response) => {
      if (!requirePlatformAdmin(req, res)) return;
      try {
        const shop = normalizeMyshopifyShopDomain(String(req.params.shop || ""));
        if (!shop) return res.status(400).json({ error: "Invalid shop" });
        await updateStoreShippingSettings(shop, { shippingMode: "off" });
        const removed = await removeAllShopShippingProfiles(shop);
        return res.json({ ok: true, removedProfiles: removed });
      } catch (e: any) {
        return res.status(500).json({ error: e?.message || "Disable failed" });
      }
    },
  );

  /** GET /api/platform/shipping/stores/:shop — one store's settings. */
  app.get(
    "/api/platform/shipping/stores/:shop",
    isAuthenticated,
    async (req: any, res: Response) => {
      if (!requirePlatformAdmin(req, res)) return;
      const shop = normalizeMyshopifyShopDomain(String(req.params.shop || ""));
      if (!shop) return res.status(400).json({ error: "Invalid shop" });
      const settings = await getStoreShippingSettings(shop);
      return res.json({ settings });
    },
  );

  /** DELETE /api/platform/shipping/rules/:id */
  app.delete("/api/platform/shipping/rules/:id", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const id = parseIntOr(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid rule id" });
      const [rule] = await db.select().from(shippingZoneRules).where(eq(shippingZoneRules.id, id));
      if (!rule) return res.status(404).json({ error: "Rule not found" });
      await db.delete(shippingZoneRules).where(eq(shippingZoneRules.id, id));
      if (rule.shippingClassId === 0) {
        await reevaluateAllClassTiers();
      } else {
        await reevaluateClassTiers(rule.shippingClassId);
      }
      return res.json({ ok: true });
    } catch (e: any) {
      console.error("[shipping-routes] rule delete failed:", e?.message || e);
      return res.status(500).json({ error: e?.message || "Rule delete failed" });
    }
  });
}
