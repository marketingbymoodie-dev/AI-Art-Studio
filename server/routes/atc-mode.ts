/**
 * Platform-admin per-shop add-to-cart mode (Branch C kill switch).
 * Storefront picks the value up on the next customizer-page load
 * (proxy payload is cached up to ~45s + SWR).
 */
import type { Express, Response } from "express";
import { requirePlatformAdmin } from "../platformAdmin";
import { storage } from "../storage";
import { ATC_MODES, normalizeAtcMode } from "@shared/atcMode";

type Auth = (req: any, res: any, next: any) => void;

export function registerAtcModeRoutes(app: Express, deps: { isAuthenticated: Auth }) {
  const { isAuthenticated } = deps;

  app.get("/api/platform/atc-mode", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const all = await storage.getAllShopifyInstallations();
      res.json({
        modes: ATC_MODES,
        shops: all
          .filter((i) => i.status === "active")
          .map((i) => ({
            installationId: i.id,
            shopDomain: i.shopDomain,
            atcMode: normalizeAtcMode((i as { atcMode?: string }).atcMode),
          }))
          .sort((a, b) => a.shopDomain.localeCompare(b.shopDomain)),
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to load ATC modes" });
    }
  });

  app.patch("/api/platform/atc-mode", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const shopDomain = String(req.body?.shopDomain || "").trim().toLowerCase();
      const raw = String(req.body?.atcMode || "").trim().toLowerCase();
      if (!shopDomain) return res.status(400).json({ error: "shopDomain required" });
      if (!(ATC_MODES as readonly string[]).includes(raw)) {
        return res.status(400).json({ error: `atcMode must be one of ${ATC_MODES.join(", ")}` });
      }
      const inst = await storage.getShopifyInstallationByShop(shopDomain);
      if (!inst) return res.status(404).json({ error: "Installation not found" });
      const before = normalizeAtcMode((inst as { atcMode?: string }).atcMode);
      await storage.updateShopifyInstallation(inst.id, { atcMode: raw } as any);
      console.log(`[AtcMode] ${shopDomain}: ${before} -> ${raw} by=${req.user?.claims?.sub ?? "?"}`);
      res.json({ shopDomain, atcMode: raw, previous: before });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to update ATC mode" });
    }
  });
}
