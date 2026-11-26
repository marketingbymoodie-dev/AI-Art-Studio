/** Platform-admin status/ensure for the base-variant checkout validation. */
import type { Express, Response } from "express";
import { requirePlatformAdmin } from "../platformAdmin";
import {
  ensureBaseVariantGuard,
  ensureBaseVariantGuardAllShops,
  getBaseVariantGuardStatus,
} from "../checkout-guard";
import { normalizeMyshopifyShopDomain } from "../shopDomain";

type Auth = (req: any, res: any, next: any) => void;

export function registerCheckoutGuardRoutes(app: Express, deps: { isAuthenticated: Auth }) {
  const { isAuthenticated } = deps;

  app.get("/api/platform/checkout-guard/:shop", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    res.json(await getBaseVariantGuardStatus(normalizeMyshopifyShopDomain(req.params.shop)));
  });

  app.post("/api/platform/checkout-guard/:shop/ensure", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    res.json(await ensureBaseVariantGuard(normalizeMyshopifyShopDomain(req.params.shop)));
  });

  setTimeout(() => {
    ensureBaseVariantGuardAllShops().catch((e) =>
      console.error("[checkout-guard] boot sweep failed:", e?.message || e),
    );
  }, 3 * 60 * 1000);
}
