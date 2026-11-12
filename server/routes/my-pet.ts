/**
 * My Pet — storefront (app proxy) + admin settings routes.
 * See server/my-pet.ts for the orchestration this calls into.
 */
import type { Express, Request, RequestHandler, Response } from "express";
import { isMyPetSettingsShop } from "@shared/myPetSettings";
import { resubmitMyPetPrintify } from "../my-pet-printify-retry";
import { clientIpFromReq } from "../creator-rate-limit";
import { ensureMyPetDeviceKeyFromProxy } from "../my-pet-device";
import {
  MyPetCandidateIneligibleError,
  checkMyPetCap,
  generateMyPetRender,
  getEligibleCandidateForMyPet,
  getMyPetOrderDetails,
  getMyPetRenderForAddToCart,
  myPetShadowDesignId,
  getMyPetSettings,
  recompositeMyPetRender,
  resolveMyPetEmailToken,
  listMyPetRendersForDevice,
  resolveMyPetRenderById,
  sendMyPetEmailSave,
  startMyPetSweepInterval,
  updateMyPetSettings,
  uploadMyPetPhoto,
} from "../my-pet";
import { generationErrorCategory } from "../generation-events";
import { normalizeMyshopifyShopDomain } from "../shopDomain";
import { verifyAppProxySignature } from "../shopify-app-credentials";
import { db } from "../db";
import { and, asc, eq } from "drizzle-orm";
import { designProducts } from "@shared/schema";
import { storage } from "../storage";
import { ensureValidOfflineAccessToken } from "../shopify-offline-token";
import { setProductMyPetEnabled } from "../my-pet-metafields";

function friendlyGenerateError(err: unknown): string {
  const category = generationErrorCategory(err);
  if (category === "moderation") return "This photo couldn't be used. Please try a different one.";
  if (category === "reference_unavailable") return "We couldn't read your photo. Please upload it again.";
  if (category === "rate_limit") return "We're creating a lot of designs right now. Please try again in a minute.";
  if (category === "credential_missing") return "My Pet is temporarily unavailable for this store. Please try again later.";
  return "We couldn't create this design right now. Please try again.";
}

/** App Proxy HMAC verification — mirrors routes.ts's proxyAuth for standalone route modules. */
function myPetProxyAuth(req: Request, res: Response, next: Function) {
  const query = req.query as Record<string, string>;
  if (!verifyAppProxySignature(query)) {
    if (process.env.NODE_ENV === "production") {
      return res.status(401).json({ error: "Invalid proxy signature" });
    }
  }
  (req as any).proxyShop = normalizeMyshopifyShopDomain(query.shop ?? "");
  next();
}

export function registerMyPetRoutes(app: Express, deps: { isAuthenticated: RequestHandler }) {
  const { isAuthenticated } = deps;

  if (process.env.NODE_ENV !== "test") startMyPetSweepInterval();

  // ── Admin settings (Petposterous-only today; see isMyPetSettingsShop) ──────
  app.get("/api/admin/my-pet-settings", isAuthenticated, async (req: any, res: Response) => {
    if (!isMyPetSettingsShop(req.shopDomain)) {
      return res.status(403).json({ error: "My Pet settings are not available for this store" });
    }
    const settings = await getMyPetSettings(req.shopDomain);
    res.json({ settings });
  });

  app.put("/api/admin/my-pet-settings", isAuthenticated, async (req: any, res: Response) => {
    if (!isMyPetSettingsShop(req.shopDomain)) {
      return res.status(403).json({ error: "My Pet settings are not available for this store" });
    }
    try {
      const settings = await updateMyPetSettings(req.shopDomain, req.body || {});
      res.json({ settings });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "Could not save settings" });
    }
  });

  app.get("/api/admin/my-pet-settings/products", isAuthenticated, async (req: any, res: Response) => {
    const shop = normalizeMyshopifyShopDomain(req.shopDomain);
    if (!isMyPetSettingsShop(shop)) {
      return res.status(403).json({ error: "My Pet settings are not available for this store" });
    }
    const products = await db
      .select({
        id: designProducts.id,
        title: designProducts.title,
        shopifyProductId: designProducts.shopifyProductId,
        myPetEnabled: designProducts.myPetEnabled,
        status: designProducts.status,
      })
      .from(designProducts)
      .where(eq(designProducts.shop, shop))
      .orderBy(asc(designProducts.title));
    res.json({ products });
  });

  app.patch("/api/admin/my-pet-settings/products/:id", isAuthenticated, async (req: any, res: Response) => {
    const shop = normalizeMyshopifyShopDomain(req.shopDomain);
    if (!isMyPetSettingsShop(shop)) {
      return res.status(403).json({ error: "My Pet settings are not available for this store" });
    }
    const enabled = req.body?.enabled;
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be true or false" });
    }
    const [row] = await db
      .select()
      .from(designProducts)
      .where(and(eq(designProducts.id, String(req.params.id || "")), eq(designProducts.shop, shop)))
      .limit(1);
    if (!row) return res.status(404).json({ error: "Design product not found" });
    if (!row.shopifyProductId) {
      return res.status(409).json({ error: "This listing has no Shopify product yet." });
    }
    const installation = await storage.getShopifyInstallationByShop(shop);
    if (!installation?.accessToken) {
      return res.status(409).json({ error: "Shopify token is not stored for this store." });
    }
    const tokenReady = await ensureValidOfflineAccessToken(installation);
    const token = tokenReady.ok ? tokenReady.accessToken : installation.accessToken;
    try {
      await setProductMyPetEnabled(shop, token, row.shopifyProductId, enabled);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(502).json({ error: message });
    }
    const [updated] = await db
      .update(designProducts)
      .set({ myPetEnabled: enabled, updatedAt: new Date() })
      .where(eq(designProducts.id, row.id))
      .returning({
        id: designProducts.id,
        title: designProducts.title,
        shopifyProductId: designProducts.shopifyProductId,
        myPetEnabled: designProducts.myPetEnabled,
        status: designProducts.status,
      });
    res.json({ product: updated });
  });

  // ── Storefront (App Proxy) ──────────────────────────────────────────────
  //
  // IMPORTANT: Shopify App Proxy strips the Cookie header before forwarding
  // storefront requests to the backend. The signed device key must flow in the
  // request body/query (sent by appai-my-pet.js from localStorage) and be
  // echoed back in every success response as `deviceKey` so the client can
  // persist/refresh it. The HMAC in the signed blob prevents a shopper from
  // hand-crafting someone else's uuid to pool caps.
  app.get("/api/proxy/my-pet/cap-status", myPetProxyAuth, async (req: Request, res: Response) => {
    const shop = (req as any).proxyShop as string;
    const shopifyProductId = String(req.query.productId || "");
    if (!shop || !shopifyProductId) return res.status(400).json({ error: "productId is required" });
    const { deviceKey, signed } = ensureMyPetDeviceKeyFromProxy(req, res);
    const clientIp = clientIpFromReq(req);
    const result = await checkMyPetCap({ shop, shopifyProductId, deviceKey, clientIp });
    res.json({ ...result, deviceKey: signed });
  });

  app.post("/api/proxy/my-pet/upload-photo", myPetProxyAuth, async (req: Request, res: Response) => {
    const shop = (req as any).proxyShop as string;
    const imageData = String(req.body?.imageData || "");
    if (!shop || !imageData) return res.status(400).json({ error: "imageData is required" });
    const { deviceKey, signed } = ensureMyPetDeviceKeyFromProxy(req, res);
    try {
      const { photoId } = await uploadMyPetPhoto(shop, deviceKey, imageData);
      res.json({ ok: true, photoId, deviceKey: signed });
    } catch (err: any) {
      // User-facing (photo too large / bad data) — surface at 200 so Shopify's
      // App Proxy doesn't wrap it in HTML. Server crashes keep their 4xx/5xx.
      res.json({ ok: false, code: "upload_failed", error: err?.message || "Could not upload photo", deviceKey: signed });
    }
  });

  app.post("/api/proxy/my-pet/generate", myPetProxyAuth, async (req: Request, res: Response) => {
    const shop = (req as any).proxyShop as string;
    const { candidateId, shopifyProductId, photoId, colorName, sizeId } = req.body || {};
    if (!shop || !candidateId || !shopifyProductId || !photoId) {
      return res.status(400).json({ error: "candidateId, shopifyProductId and photoId are required" });
    }
    const { deviceKey, signed } = ensureMyPetDeviceKeyFromProxy(req, res);
    const clientIp = clientIpFromReq(req);
    try {
      const candidate = await getEligibleCandidateForMyPet(shop, String(candidateId));
      const cap = await checkMyPetCap({ shop, shopifyProductId: String(shopifyProductId), deviceKey, clientIp });
      if (!cap.allowed) {
        return res.json({ ok: false, code: cap.reason, message: cap.message, deviceKey: signed });
      }
      const result = await generateMyPetRender({
        shop,
        shopifyProductId: String(shopifyProductId),
        candidate,
        photoId: String(photoId),
        deviceKey,
        clientIp,
        colorName: colorName ? String(colorName) : null,
        sizeId: sizeId ? String(sizeId) : null,
      });
      res.json({ ok: true, ...result, deviceKey: signed });
    } catch (err: any) {
      if (err instanceof MyPetCandidateIneligibleError) {
        // Catalogue removed this candidate (unpromoted/missing artwork) — user-
        // facing, not a server crash. 200 so Shopify doesn't HTML-wrap it.
        return res.json({ ok: false, code: "candidate_ineligible", error: err.message, deviceKey: signed });
      }
      const msg = String(err?.message || err);
      const userFacing =
        msg.startsWith("Pet photo not found") ||
        msg.startsWith("Photo is too large") ||
        msg === "Original edit is missing — please generate again";
      if (userFacing) {
        console.warn("[my-pet] generate user-facing error:", msg);
        return res.json({ ok: false, code: "photo_not_found", error: msg, deviceKey: signed });
      }
      // Genuine server crash: Replicate crash, DB down, OOM. 500 is appropriate;
      // Shopify will wrap it in HTML but by the time we get here the shopper
      // already has a 5xx-worthy problem that warrants retry.
      console.error("[my-pet] generate failed:", msg);
      res.status(500).json({ ok: false, code: "server_error", error: friendlyGenerateError(err), deviceKey: signed });
    }
  });

  app.post("/api/proxy/my-pet/recomposite", myPetProxyAuth, async (req: Request, res: Response) => {
    const shop = (req as any).proxyShop as string;
    const { renderId, colorName } = req.body || {};
    if (!shop || !renderId || !colorName) {
      return res.status(400).json({ error: "renderId and colorName are required" });
    }
    const { deviceKey, signed } = ensureMyPetDeviceKeyFromProxy(req, res);
    try {
      const result = await recompositeMyPetRender({ shop, deviceKey, renderId: String(renderId), colorName: String(colorName) });
      res.json({ ok: true, ...result, deviceKey: signed });
    } catch (err: any) {
      res.json({ ok: false, code: "recomposite_failed", error: err?.message || "Could not update colour", deviceKey: signed });
    }
  });

  app.post("/api/proxy/my-pet/email-save", myPetProxyAuth, async (req: Request, res: Response) => {
    const shop = (req as any).proxyShop as string;
    const { renderId, email, marketingConsent, pageUrl, colorName } = req.body || {};
    if (!shop || !renderId || !email || !pageUrl) {
      return res.status(400).json({ error: "renderId, email and pageUrl are required" });
    }
    const { deviceKey, signed } = ensureMyPetDeviceKeyFromProxy(req, res);
    try {
      await sendMyPetEmailSave({
        shop,
        deviceKey,
        renderId: String(renderId),
        email: String(email),
        marketingConsent: !!marketingConsent,
        pageUrl: String(pageUrl),
        colorName: colorName ? String(colorName) : undefined,
      });
      res.json({ ok: true, deviceKey: signed });
    } catch (err: any) {
      res.json({ ok: false, code: "email_save_failed", error: err?.message || "Could not send email", deviceKey: signed });
    }
  });

  // Thin server-to-server forward to the existing shadow-SKU endpoint every other
  // customizer flow already uses — keeps the storefront JS from needing to know
  // the app's own domain (catalogue products carry no ai_art_studio.app_url meta).
  // Theme and modal adds both land here. Extends the shadow from 6h to 7d.
  app.post("/api/proxy/my-pet/cart-added", myPetProxyAuth, async (req: Request, res: Response) => {
    const shop = (req as any).proxyShop as string;
    const variantId = String(req.body?.variantId || "");
    if (!shop || !variantId) return res.status(400).json({ ok: false, error: "variantId is required" });
    try {
      const row = await storage.findActiveShadowProduct(shop, { variantId });
      if (!row) return res.json({ ok: false, error: "shadow not found" });
      await storage.markShadowProductCartAdded(row.id);
      console.log(`[ShadowProduct] Extended expiry to 7d for variant ${row.shopifyVariantId} (my-pet cart-added)`);
      return res.json({ ok: true, variantId: row.shopifyVariantId });
    } catch (err: any) {
      console.error("[ShadowProduct] my-pet cart-added error:", err?.message);
      return res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  app.post("/api/proxy/my-pet/resolve-variant", myPetProxyAuth, async (req: Request, res: Response) => {
    const shop = (req as any).proxyShop as string;
    const { renderId, variantId, colorName, sizeName, mockupUrl: clientMockupRaw } = req.body || {};
    if (!shop || !renderId || !variantId) {
      return res.status(400).json({ success: false, error: "renderId and variantId are required" });
    }
    const { deviceKey } = ensureMyPetDeviceKeyFromProxy(req, res);
    try {
      const colour = colorName ? String(colorName) : "";
      const size = sizeName ? String(sizeName) : "";
      const clientMockup = typeof clientMockupRaw === "string" ? clientMockupRaw.trim() : "";
      const clientPath = clientMockup.split("?")[0].split("#")[0];
      const clientIsGeneration = clientPath.endsWith(`/${String(renderId)}.png`);
      const clientColourUrl = clientMockup.startsWith("https://") && !clientIsGeneration ? clientMockup : "";
      const { jobId, previewUrl, designLabel, designId } = await getMyPetRenderForAddToCart({
        shop,
        deviceKey,
        renderId: String(renderId),
        colorName: colour,
        sizeName: size,
        variantId: String(variantId),
        knownPreviewUrl: clientColourUrl,
      });
      // Click-time gallery URL wins. The signed colour file is the fallback
      // when that map entry was not ready yet.
      const mockupUrl = clientColourUrl || previewUrl;
      const shadowDesignId = designId || myPetShadowDesignId(jobId, String(variantId), String(renderId), colour, size);
      const tail = (url: string) => String(url || "").split("?")[0].split("#")[0].split("/").pop() || "";
      console.log(
        `[my-pet] resolve-variant colour=${colour || "?"} size=${size || "?"} ` +
          `clientTail=${tail(clientMockup) || "none"} mockupTail=${tail(mockupUrl)} designId=${shadowDesignId}`,
      );
      const base = (process.env.PUBLIC_APP_URL || process.env.APP_URL || "").replace(/\/$/, "");
      if (!base) return res.status(500).json({ success: false, error: "App URL is not configured" });
      const upstream = await fetch(`${base}/api/storefront/resolve-design-variant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop,
          variantId: String(variantId),
          designId: shadowDesignId,
          mockupUrl,
          source: "my-pet",
          colorName: colour,
          sizeName: size,
          // Matches generationJobs.sessionId set at generate time — satisfies
          // resolve-design-variant's ownership check for this anonymous device.
          sessionId: deviceKey,
        }),
      });
      const data = await upstream.json().catch(() => ({}));
      // Pass the data back verbatim and tack on the fields the client needs for
      // line-item properties (jobId, previewUrl, renderId, designLabel). The
      // upstream response already carries { success, variantId, code } — our
      // additions let the storefront attach _mockup_url / _appai_job_id /
      // _appai_my_pet_render_id / _design_id without a second round-trip.
      if (data && data.success) {
        data.jobId = jobId;
        data.previewUrl = mockupUrl;
        data.colorName = colour;
        data.renderId = String(renderId);
        data.designLabel = designLabel;
        if (!data.shadowImage) data.shadowImage = mockupUrl;
        console.log(
          `[my-pet] resolve-variant image colour=${colour || "?"} mockupTail=${tail(mockupUrl)} ` +
            `shadowTail=${tail(String(data.shadowImage || ""))} shadowVariant=${data.variantId}`,
        );
      } else {
        // Bug 1a: "Shop not authorized" / "not_design_owner" surfaced to the
        // shopper as a bare string with no trace of *why*. Log loudly here —
        // shop, the base variant id the shopper picked, the job/design id
        // prefix, and the exact upstream status + code — so a Railway search
        // on "[my-pet] resolve-variant refused" during a smoke test points
        // straight at the failing path (expired OAuth token vs ownership
        // check vs still-preparing) instead of guessing from the client error.
        console.error(
          `[my-pet] resolve-variant refused shop=${shop} baseVariantId=${variantId} ` +
            `designId=${jobId.slice(0, 8)} renderId=${String(renderId).slice(0, 8)} ` +
            `upstreamStatus=${upstream.status} code=${data?.code ?? "none"} error=${data?.error ?? "none"}`,
        );
      }
      res.status(upstream.status).json(data);
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message || "Could not add to cart" });
    }
  });

  // UX 6: same-device cross-session restore. Client keeps { renderId, jobId,
  // candidateId } in localStorage (never the signed previewUrl, which expires
  // in an hour) and calls this on return visits to get a fresh signed URL, or
  // a clean not_found if the render was swept or belongs to a different
  // device_key since.
  // This device's successful renders for one product, newest first.
  // Thumbnails only — choosing one goes through resolve-render for the colour map.
  app.get("/api/proxy/my-pet/renders", myPetProxyAuth, async (req: Request, res: Response) => {
    const shop = (req as any).proxyShop as string;
    const shopifyProductId = String(req.query.productId || "");
    if (!shop || !shopifyProductId) return res.status(400).json({ ok: false, error: "productId is required" });
    const { deviceKey, signed } = ensureMyPetDeviceKeyFromProxy(req, res);
    try {
      const renders = await listMyPetRendersForDevice({ shop, deviceKey, shopifyProductId });
      res.json({ ok: true, renders, deviceKey: signed });
    } catch (err: any) {
      res.json({ ok: false, error: err?.message || "Could not list designs", deviceKey: signed });
    }
  });

  app.get("/api/proxy/my-pet/resolve-render", myPetProxyAuth, async (req: Request, res: Response) => {
    const shop = (req as any).proxyShop as string;
    const renderId = String(req.query.renderId || "");
    if (!shop || !renderId) return res.status(400).json({ ok: false, error: "renderId is required" });
    const { deviceKey, signed } = ensureMyPetDeviceKeyFromProxy(req, res);
    try {
      const result = await resolveMyPetRenderById({ shop, deviceKey, renderId });
      if (!result) return res.json({ ok: false, code: "not_found", deviceKey: signed });
      res.json({ ok: true, ...result, deviceKey: signed });
    } catch (err: any) {
      res.json({ ok: false, code: "not_found", error: err?.message || "Could not restore design", deviceKey: signed });
    }
  });

  // Admin audit (Issue 11): "Which My Pet renders went into this order?"
  // Merchants can search by order name (#1234) or Shopify order id. Backs the
  // Order lookup card on the My Pet settings admin page.
  app.get("/api/admin/my-pet-orders", isAuthenticated, async (req: any, res: Response) => {
    if (!isMyPetSettingsShop(req.shopDomain)) {
      return res.status(403).json({ error: "My Pet is not available for this store" });
    }
    const rawName = String(req.query.orderName || "").trim();
    const orderName = rawName && !rawName.startsWith("#") ? `#${rawName}` : (rawName || null);
    const orderId = String(req.query.orderId || "").trim() || null;
    if (!orderName && !orderId) return res.status(400).json({ error: "orderName or orderId is required" });
    const result = await getMyPetOrderDetails({ shop: req.shopDomain, orderName, orderId });
    res.json(result);
  });

  app.post("/api/admin/my-pet-orders/resubmit", isAuthenticated, async (req: any, res: Response) => {
    if (!isMyPetSettingsShop(req.shopDomain)) {
      return res.status(403).json({ error: "My Pet is not available for this store" });
    }
    const orderId = String(req.body?.orderId || "").trim();
    if (!orderId) return res.status(400).json({ error: "orderId is required" });
    const result = await resubmitMyPetPrintify(req.shopDomain, orderId);
    if (!result.ok) {
      const status = /another shop/i.test(result.error) ? 403 : /already submitted|no stored payload/i.test(result.error) ? 409 : 404;
      return res.status(status).json({ error: result.error });
    }
    res.json({ ok: true });
  });

  app.get("/api/proxy/my-pet/resolve-token", myPetProxyAuth, async (req: Request, res: Response) => {
    const token = String(req.query.token || "");
    if (!token) return res.status(400).json({ error: "token is required" });
    const resolved = await resolveMyPetEmailToken(token);
    if (!resolved) return res.status(404).json({ ok: false, error: "This link has expired" });
    res.json({ ok: true, ...resolved });
  });
}
