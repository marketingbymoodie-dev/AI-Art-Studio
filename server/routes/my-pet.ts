/**
 * My Pet — storefront (app proxy) + admin settings routes.
 * See server/my-pet.ts for the orchestration this calls into.
 */
import type { Express, Request, RequestHandler, Response } from "express";
import { isMyPetSettingsShop } from "@shared/myPetSettings";
import { clientIpFromReq } from "../creator-rate-limit";
import { ensureMyPetDeviceKeyFromProxy } from "../my-pet-device";
import {
  MyPetCandidateIneligibleError,
  checkMyPetCap,
  generateMyPetRender,
  getEligibleCandidateForMyPet,
  getMyPetOrderDetails,
  getMyPetRenderForAddToCart,
  getMyPetSettings,
  recompositeMyPetRender,
  resolveMyPetEmailToken,
  resolveMyPetRenderById,
  sendMyPetEmailSave,
  startMyPetSweepInterval,
  updateMyPetSettings,
  uploadMyPetPhoto,
} from "../my-pet";
import { generationErrorCategory } from "../generation-events";
import { normalizeMyshopifyShopDomain } from "../shopDomain";
import { verifyAppProxySignature } from "../shopify-app-credentials";

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
    const { renderId, email, marketingConsent, pageUrl } = req.body || {};
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
      });
      res.json({ ok: true, deviceKey: signed });
    } catch (err: any) {
      res.json({ ok: false, code: "email_save_failed", error: err?.message || "Could not send email", deviceKey: signed });
    }
  });

  // Thin server-to-server forward to the existing shadow-SKU endpoint every other
  // customizer flow already uses — keeps the storefront JS from needing to know
  // the app's own domain (catalogue products carry no ai_art_studio.app_url meta).
  app.post("/api/proxy/my-pet/resolve-variant", myPetProxyAuth, async (req: Request, res: Response) => {
    const shop = (req as any).proxyShop as string;
    const { renderId, variantId, price } = req.body || {};
    if (!shop || !renderId || !variantId) {
      return res.status(400).json({ success: false, error: "renderId and variantId are required" });
    }
    const { deviceKey } = ensureMyPetDeviceKeyFromProxy(req, res);
    try {
      const { jobId, previewUrl, designLabel } = await getMyPetRenderForAddToCart({ shop, deviceKey, renderId: String(renderId) });
      const base = (process.env.PUBLIC_APP_URL || process.env.APP_URL || "").replace(/\/$/, "");
      if (!base) return res.status(500).json({ success: false, error: "App URL is not configured" });
      const upstream = await fetch(`${base}/api/storefront/resolve-design-variant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop,
          variantId: String(variantId),
          designId: jobId,
          mockupUrl: previewUrl,
          // Matches generationJobs.sessionId set at generate time — satisfies
          // resolve-design-variant's ownership check for this anonymous device.
          sessionId: deviceKey,
          ...(price ? { price: String(price) } : {}),
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
        data.previewUrl = previewUrl;
        data.renderId = String(renderId);
        data.designLabel = designLabel;
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

  app.get("/api/proxy/my-pet/resolve-token", myPetProxyAuth, async (req: Request, res: Response) => {
    const token = String(req.query.token || "");
    if (!token) return res.status(400).json({ error: "token is required" });
    const resolved = await resolveMyPetEmailToken(token);
    if (!resolved) return res.status(404).json({ ok: false, error: "This link has expired" });
    res.json({ ok: true, ...resolved });
  });
}
