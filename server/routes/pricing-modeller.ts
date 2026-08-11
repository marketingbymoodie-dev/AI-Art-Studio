/**
 * Platform-admin pricing modeller APIs.
 * Commit ≠ activate. Sliders never write the live active catalogue directly.
 */
import type { Express, Response } from "express";
import { requirePlatformAdmin } from "../platformAdmin";
import {
  activatePricingCatalogue,
  commitPricingCatalogue,
  getActiveCatalogue,
  getCatalogueById,
  listPricingCatalogues,
} from "../pricing-catalogue";
import type { CataloguePlanRow, OveragePriceTier } from "@shared/customizerPlans";

type Auth = (req: any, res: any, next: any) => void;

export function registerPricingModellerRoutes(
  app: Express,
  deps: { isAuthenticated: Auth },
) {
  const { isAuthenticated } = deps;

  app.get("/api/platform/pricing/active", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const catalogue = await getActiveCatalogue();
      res.json({ catalogue });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to load active catalogue" });
    }
  });

  app.get("/api/platform/pricing/catalogues", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const catalogues = await listPricingCatalogues();
      res.json({ catalogues });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to list catalogues" });
    }
  });

  app.get("/api/platform/pricing/catalogues/:id", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
      const catalogue = await getCatalogueById(id);
      res.json({ catalogue });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to load catalogue" });
    }
  });

  app.post("/api/platform/pricing/catalogues/commit", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const body = req.body ?? {};
      const label = String(body.label || "").trim();
      const overageSchedule = body.overageSchedule as OveragePriceTier[];
      const plans = body.plans as CataloguePlanRow[];
      const aiCostPerGenUsd =
        body.aiCostPerGenUsd != null ? Number(body.aiCostPerGenUsd) : undefined;
      const catalogue = await commitPricingCatalogue({
        label,
        overageSchedule,
        plans,
        aiCostPerGenUsd,
        createdBy: req.shopDomain ?? null,
      });
      const active = await getActiveCatalogue();
      res.json({
        catalogue,
        activeCatalogueId: active.id,
        note: "Committed only — live billing unchanged until activate.",
      });
    } catch (e: any) {
      res.status(400).json({ error: e?.message ?? "Commit failed" });
    }
  });

  app.post("/api/platform/pricing/catalogues/:id/activate", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
      const confirm = String(req.body?.confirm || "");
      if (confirm !== "ACTIVATE") {
        return res.status(400).json({
          error: 'Send { "confirm": "ACTIVATE" } to activate. This changes new-subscription offer numbers.',
        });
      }
      const catalogue = await activatePricingCatalogue(id);
      res.json({
        catalogue,
        note: "Active offer updated for new subscriptions. Existing shops keep their stamped pricingVersion until re-subscribe.",
      });
    } catch (e: any) {
      res.status(400).json({ error: e?.message ?? "Activate failed" });
    }
  });
}
