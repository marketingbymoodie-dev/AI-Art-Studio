/**
 * Bake a full-bleed flat print file for Printers Mockup requests.
 *
 *   POST /api/storefront/bake-flat-print  (shop install auth)
 *   POST /api/mockup/bake-flat-print      (admin / tester session)
 */
import type { Express, Request, Response } from "express";
import { bakeFlatPrintForMockup } from "../bake-flat-print-mockup";

type StorageLike = {
  getProductType(id: number): Promise<any>;
  getMerchant(id: number): Promise<any>;
  getMerchantByUserId(userId: string): Promise<any>;
};

type Deps = {
  storage: StorageLike;
  isAuthenticated: any;
  getAuthorizedInstallation: (shop: string) => Promise<any>;
  resolveStorefrontProductType: (
    productTypeId: number,
    merchantId: number,
    logPrefix?: string,
  ) => Promise<{ productType: any; resolvedFrom?: string } | { error: string }>;
  adminProductTypeAccessError: (
    req: any,
    productType: any,
    merchant: any,
  ) => { status: number; error: string; code?: string } | null;
};

function publicOriginFromReq(req: Request): string {
  const env =
    process.env.PUBLIC_APP_URL ||
    process.env.APP_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : "");
  if (env) return env.replace(/\/$/, "");
  const host = req.get("host");
  if (!host) return "";
  return `${req.protocol || "https"}://${host}`;
}

export function registerBakeFlatPrintRoutes(app: Express, deps: Deps) {
  const {
    storage,
    isAuthenticated,
    getAuthorizedInstallation,
    resolveStorefrontProductType,
    adminProductTypeAccessError,
  } = deps;

  app.post("/api/storefront/bake-flat-print", async (req: Request, res: Response) => {
    try {
      const {
        shop,
        productTypeId,
        artworkUrl,
        sizeId,
        colorId,
        placement,
        backgroundColor,
        view,
      } = req.body || {};

      if (!shop || typeof shop !== "string") {
        return res.status(400).json({ error: "Shop domain required" });
      }
      if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop)) {
        return res.status(400).json({ error: "Invalid shop domain format" });
      }
      const installation = await getAuthorizedInstallation(shop);
      if (!installation?.merchantId) {
        return res.status(403).json({ error: "Shop not authorized" });
      }
      if (!productTypeId || !artworkUrl) {
        return res.status(400).json({ error: "productTypeId and artworkUrl required" });
      }

      const resolved = await resolveStorefrontProductType(
        parseInt(String(productTypeId), 10),
        installation.merchantId,
        "[Storefront BakeFlatPrint]",
      );
      if ("error" in resolved) {
        return res.status(400).json({ error: resolved.error });
      }

      const result = await bakeFlatPrintForMockup({
        productTypeId: resolved.productType.id,
        productType: resolved.productType,
        artworkUrl: String(artworkUrl),
        sizeId: sizeId != null ? String(sizeId) : undefined,
        colorId: colorId != null ? String(colorId) : undefined,
        placement,
        backgroundColor,
        view: view != null ? String(view) : "front",
        publicOrigin: publicOriginFromReq(req),
      });
      if (!result.ok) {
        return res.status(400).json({ error: result.error });
      }
      return res.json({ url: result.url, width: result.width, height: result.height });
    } catch (err: any) {
      console.error("[Storefront BakeFlatPrint]", err);
      return res.status(500).json({ error: err?.message || "Bake failed" });
    }
  });

  app.post("/api/mockup/bake-flat-print", isAuthenticated, async (req: any, res: Response) => {
    try {
      const userId = req.user?.claims?.sub;
      const merchant = await storage.getMerchantByUserId(userId);
      if (!merchant) {
        return res.status(404).json({ error: "Merchant not found" });
      }

      const {
        productTypeId,
        artworkUrl,
        sizeId,
        colorId,
        placement,
        backgroundColor,
        view,
      } = req.body || {};

      if (!productTypeId || !artworkUrl) {
        return res.status(400).json({ error: "productTypeId and artworkUrl required" });
      }

      const productType = await storage.getProductType(parseInt(String(productTypeId), 10));
      const accessErr = adminProductTypeAccessError(req, productType, merchant);
      if (accessErr) {
        return res.status(accessErr.status).json({
          error: accessErr.error,
          code: accessErr.code,
        });
      }

      const result = await bakeFlatPrintForMockup({
        productTypeId: productType.id,
        productType,
        artworkUrl: String(artworkUrl),
        sizeId: sizeId != null ? String(sizeId) : undefined,
        colorId: colorId != null ? String(colorId) : undefined,
        placement,
        backgroundColor,
        view: view != null ? String(view) : "front",
        publicOrigin: publicOriginFromReq(req),
      });
      if (!result.ok) {
        return res.status(400).json({ error: result.error });
      }
      return res.json({ url: result.url, width: result.width, height: result.height });
    } catch (err: any) {
      console.error("[Mockup BakeFlatPrint]", err);
      return res.status(500).json({ error: err?.message || "Bake failed" });
    }
  });
}
