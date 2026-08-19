import type { Express, Request, Response } from "express";
import { requirePlatformAdmin } from "../platformAdmin";
import { checkCreatorRateLimit, clientIpFromReq } from "../creator-rate-limit";
import { normalizeMyshopifyShopDomain } from "../shopDomain";
import {
  isNewsletterSource,
  listStudioNewsletterSubscribers,
  subscribeToStudioNewsletter,
} from "../studio-newsletter";

export function registerStudioGrowthRoutes(
  app: Express,
  deps: { isAuthenticated: any },
) {
  const { isAuthenticated } = deps;

  app.post("/api/studio/newsletter/subscribe", async (req: Request, res: Response) => {
    const rl = checkCreatorRateLimit({
      key: `newsletter:${clientIpFromReq(req)}`,
      limit: 12,
      windowMs: 60 * 60 * 1000,
    });
    if (!rl.ok) {
      res.setHeader("Retry-After", String(rl.retryAfterSec));
      return res.status(429).json({ error: "Too many tries. Wait a bit and try again." });
    }
    try {
      const body = req.body ?? {};
      const source = String(body.source || "");
      if (!isNewsletterSource(source)) {
        return res.status(400).json({ error: "Unknown signup source." });
      }
      const result = await subscribeToStudioNewsletter({
        email: String(body.email || ""),
        source,
        shopDomain: body.shop || body.shopDomain || null,
        creatorUsername: body.creatorUsername || null,
        customerId: body.customerId || null,
      });
      if (!result.ok) {
        return res.status(400).json({ error: result.reason });
      }
      return res.json(result);
    } catch (e: any) {
      console.error("[newsletter] subscribe failed:", e);
      return res.status(500).json({ error: e?.message || "Could not join the list." });
    }
  });

  app.get("/api/platform/newsletter", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const limit = Number(req.query.limit) || 500;
      const subscribers = await listStudioNewsletterSubscribers(limit);
      res.json({ subscribers });
    } catch (e: any) {
      console.error("[newsletter] list failed:", e);
      res.status(500).json({ error: e?.message || "Failed to load newsletter list" });
    }
  });

  app.get("/api/storefront/credit-packs", async (req: Request, res: Response) => {
    try {
      const shop = normalizeMyshopifyShopDomain(String(req.query.shop || ""));
      if (!shop) return res.status(400).json({ error: "shop is required" });
      const { listMerchantPacksForSale, ensureMerchantPackVariants } = await import(
        "../merchant-packs"
      );
      let packs = await listMerchantPacksForSale(shop);
      if (packs.some((p) => !p.variantReady)) {
        try {
          await ensureMerchantPackVariants(shop);
          packs = await listMerchantPacksForSale(shop);
        } catch (e: any) {
          console.warn("[merchant-packs] ensure on list failed:", e?.message || e);
        }
      }
      res.json({
        packs: packs.map((p) => ({
          packId: p.packId,
          credits: p.credits,
          priceInCents: p.priceInCents,
          label: p.label,
          variantReady: p.variantReady,
        })),
      });
    } catch (e: any) {
      console.error("[merchant-packs] list failed:", e);
      res.status(500).json({ error: e?.message || "Failed to list packs" });
    }
  });

  app.post("/api/storefront/credit-packs/checkout", async (req: Request, res: Response) => {
    const rl = checkCreatorRateLimit({
      key: `merchant-pack:${clientIpFromReq(req)}`,
      limit: 30,
      windowMs: 60 * 60 * 1000,
    });
    if (!rl.ok) {
      res.setHeader("Retry-After", String(rl.retryAfterSec));
      return res.status(429).json({ error: "Too many checkout attempts. Try again later." });
    }
    try {
      const body = req.body ?? {};
      const { createMerchantPackCheckout } = await import("../merchant-packs");
      const result = await createMerchantPackCheckout({
        shop: String(body.shop || body.shopDomain || ""),
        packId: String(body.packId || ""),
        customerId: String(body.customerId || ""),
      });
      res.json({
        success: true,
        checkoutUrl: result.checkoutUrl,
        pack: result.pack,
      });
    } catch (e: any) {
      console.error("[merchant-packs] checkout failed:", e);
      const msg = e?.message || "Failed to start pack checkout";
      const status = /required|Unknown|not authorized/i.test(msg) ? 400 : 500;
      res.status(status).json({ error: msg });
    }
  });
}
