import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { storage } from "./storage";
import { registerShopifyGdprRoutes } from "./shopify-gdpr";
import { exchangeAuthorizationCode } from "./shopify-offline-token";
import {
  credentialsForInstallHint,
  getPrimaryShopifyCredentials,
  hasShopifyAppCredentials,
  hmacBase64MatchesAnySecret,
  listShopifyAppCredentials,
  reinstallKeyForShop,
  verifyOAuthQueryHmac,
  verifyReinstallKey,
} from "./shopify-app-credentials";
import { ensureCreatorCheckoutWebhooks } from "./creator-checkout-webhooks";
import {
  ensureShopifyCarrierService,
  parseCarrierRateRequest,
  quoteShopifyCarrierRates,
} from "./printify-checkout-shipping";

const SHOPIFY_SCOPES = "read_products,read_themes,write_products,write_themes,write_content,read_content,write_publications,read_online_store_navigation,write_online_store_navigation,read_locations,write_inventory,read_customers,write_customers,read_orders,write_shipping";

function primaryKey(): string {
  return getPrimaryShopifyCredentials()?.apiKey || "";
}

function primarySecret(): string {
  return getPrimaryShopifyCredentials()?.apiSecret || "";
}

export async function registerCartScript(shop: string, accessToken: string): Promise<void> {
  const appUrl = getAppUrl();
  const scriptUrl = `${appUrl}/scripts/ai-art-cart.js`;

  try {
    const existingResponse = await fetch(
      `https://${shop}/admin/api/2025-10/script_tags.json`,
      {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      }
    );

    if (existingResponse.ok) {
      const data = await existingResponse.json();
      const existing = data.script_tags?.find((s: any) => s.src.includes('ai-art-cart.js'));
      if (existing) {
        console.log(`ScriptTag already exists for ${shop}`);
        return;
      }
    }

    const response = await fetch(
      `https://${shop}/admin/api/2025-10/script_tags.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          script_tag: {
            event: "onload",
            src: scriptUrl,
            display_scope: "online_store",
          },
        }),
      }
    );

    if (response.ok) {
      console.log(`Registered cart script for ${shop}`);
    } else {
      const error = await response.text();
      console.error(`Failed to register cart script for ${shop}:`, error);
    }
  } catch (error) {
    console.error(`Error registering cart script for ${shop}:`, error);
  }
}

export function getAppUrl(): string {
  // Staging often sets PUBLIC_APP_URL only; OAuth redirect_uri must be the
  // public Railway URL — never localhost — or Shopify install never saves a token.
  // Prefer APP_URL so reconnect links match /shopify/callback (not the apex
  // marketing host, which would set a cookie Shopify never sends back).
  const appUrl = process.env.APP_URL || process.env.PUBLIC_APP_URL;
  if (appUrl) {
    return appUrl.replace(/\/$/, "");
  }

  return `http://localhost:${process.env.PORT || 5000}`;
}

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** Cookie-independent CSRF token: HMAC(shop + timestamp + nonce). */
export function createOAuthState(shop: string, secret = primarySecret()): string {
  const payload = Buffer.from(
    JSON.stringify({ s: shop, t: Date.now(), n: crypto.randomBytes(16).toString("hex") }),
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyOAuthState(
  state: string | undefined,
  shop: string,
  secret = primarySecret(),
  now = Date.now(),
): boolean {
  if (!state || !shop || !secret) return false;
  const lastDot = state.lastIndexOf(".");
  if (lastDot <= 0) return false;
  const payload = state.slice(0, lastDot);
  const sig = state.slice(lastDot + 1);
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  if (expected.length !== sig.length) return false;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return false;
  } catch {
    return false;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      s?: string;
      t?: number;
    };
    if (parsed.s !== shop || typeof parsed.t !== "number") return false;
    return Math.abs(now - parsed.t) <= OAUTH_STATE_TTL_MS;
  } catch {
    return false;
  }
}

function verifyOAuthStateAny(state: string | undefined, shop: string): boolean {
  return listShopifyAppCredentials().some((c) => verifyOAuthState(state, shop, c.apiSecret));
}

function verifyHmac(query: Record<string, any>): boolean {
  return verifyOAuthQueryHmac(query);
}

function isValidShopDomain(shop: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

// Validate that an access token is still valid by making a simple API call
export async function validateShopifyToken(shop: string, accessToken: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const response = await fetch(
      `https://${shop}/admin/api/2025-10/shop.json`,
      {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      }
    );
    
    if (response.ok) {
      return { valid: true };
    }
    
    if (response.status === 401) {
      return { valid: false, error: "Token expired or revoked - reinstall required" };
    }
    
    if (response.status === 403) {
      return { valid: false, error: "Insufficient permissions - reinstall with updated scopes required" };
    }
    
    return { valid: false, error: `Unexpected status: ${response.status}` };
  } catch (error: any) {
    return { valid: false, error: error.message || "Network error" };
  }
}

// Helper to make Shopify API calls with automatic token validation
export async function shopifyApiCall(
  shop: string, 
  accessToken: string, 
  endpoint: string, 
  options: RequestInit = {}
): Promise<{ ok: boolean; data?: any; error?: string; needsReinstall?: boolean }> {
  try {
    const response = await fetch(
      `https://${shop}/admin/api/2025-10/${endpoint}`,
      {
        ...options,
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
          ...options.headers,
        },
      }
    );
    
    if (response.ok) {
      const data = await response.json();
      return { ok: true, data };
    }
    
    if (response.status === 401) {
      console.error(`[Shopify API] 401 Unauthorized for ${shop} - token may need refresh`);
      // Do NOT automatically downgrade status here — a single 401 can be transient
      // (e.g. a stale request in-flight right after an OAuth reinstall). Only mark
      // token_invalid if the token fails a direct validation check.
      return { ok: false, error: "Access token is invalid - shop needs to reinstall the app", needsReinstall: true };
    }
    
    if (response.status === 403) {
      return { ok: false, error: "Insufficient permissions for this operation", needsReinstall: true };
    }
    
    const errorText = await response.text();
    return { ok: false, error: `API error ${response.status}: ${errorText}` };
  } catch (error: any) {
    return { ok: false, error: error.message || "Network error" };
  }
}

export function registerShopifyRoutes(app: Express): void {
  console.log(`[shopify] OAuth scopes configured: ${SHOPIFY_SCOPES}`);
  registerShopifyGdprRoutes(app);

  app.post("/shopify/carrier-service/rates", async (req: Request, res: Response) => {
    const hmacHeader = req.headers["x-shopify-hmac-sha256"] as string;
    const shopHeader = req.headers["x-shopify-shop-domain"] as string;
    const rawBody = (req as { rawBody?: Buffer | string }).rawBody;
    const bodyBuf = Buffer.isBuffer(rawBody)
      ? rawBody
      : typeof rawBody === "string"
        ? Buffer.from(rawBody, "utf8")
        : Buffer.from(JSON.stringify(req.body ?? {}), "utf8");
    if (!hmacHeader || !hmacBase64MatchesAnySecret(bodyBuf, hmacHeader)) {
      return res.status(401).send("HMAC verification failed");
    }
    const parsed = parseCarrierRateRequest(req.body);
    try {
      const rates = await quoteShopifyCarrierRates({
        shop: shopHeader || "",
        destinationCountry: parsed.destinationCountry,
        currency: parsed.currency,
        items: parsed.items,
      });
      return res.status(200).json({ rates });
    } catch (e: any) {
      console.warn("[carrier-shipping] quote failed:", e?.message || e);
      return res.status(200).json({ rates: [] });
    }
  });

  if (!hasShopifyAppCredentials()) {
    console.log("Shopify OAuth disabled - SHOPIFY_API_KEY/SECRET not configured");
    
    app.get("/shopify/install", (_req: Request, res: Response) => {
      res.status(503).send(`
        <h1>Shopify Integration Not Configured</h1>
        <p>To enable Shopify integration, set these environment variables:</p>
        <ul>
          <li>SHOPIFY_API_KEY</li>
          <li>SHOPIFY_API_SECRET</li>
          <li>CREATOR_SHOPIFY_API_KEY / CREATOR_SHOPIFY_API_SECRET (optional clone)</li>
        </ul>
        <p>Create a Shopify app in your <a href="https://partners.shopify.com">Shopify Partners Dashboard</a> to get these credentials.</p>
      `);
    });
    return;
  }

  app.get("/shopify/install", async (req: Request, res: Response) => {
    const shop = req.query.shop as string;

    if (!shop || !isValidShopDomain(shop)) {
      return res.status(400).send(`
        <h1>Missing or Invalid Shop</h1>
        <p>Please use the format: <code>/shopify/install?shop=yourstore.myshopify.com</code></p>
      `);
    }

    const creds = credentialsForInstallHint(req.query.app as string | undefined);
    if (!creds) {
      return res.status(503).send("Shopify API credentials are not configured");
    }
    const state = createOAuthState(shop, creds.apiSecret);
    const redirectUri = `${getAppUrl()}/shopify/callback`;

    const authUrl = `https://${shop}/admin/oauth/authorize?` +
      `client_id=${creds.apiKey}&` +
      `scope=${SHOPIFY_SCOPES}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `state=${state}`;

    res.cookie("shopify_state", state, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 600000
    });

   // Try to capture merchant ID from Shopify session
if (res.locals.shopify?.session?.shop) {
  const shop = res.locals.shopify.session.shop;
  const merchant = await storage.getMerchantByShop(shop);

  if (merchant) {
    res.cookie("shopify_merchant", merchant.id, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 600000,
    });
  }
}

    res.redirect(authUrl);
  });

  app.get("/shopify/callback", async (req: Request, res: Response) => {
    const { shop, code, state } = req.query as Record<string, string>;
    const storedState = req.cookies?.shopify_state;

    if (!shop || !code) {
      return res.status(400).send("Missing shop or code parameter");
    }

    if (!isValidShopDomain(shop)) {
      return res.status(400).send("Invalid shop domain");
    }

    const signedStateOk = verifyOAuthStateAny(state, shop);
    const cookieStateOk = !!storedState && storedState === state;
    if (!signedStateOk && !cookieStateOk) {
      console.warn(
        `[shopify/callback] State mismatch for ${shop} (signed=${signedStateOk} cookie=${cookieStateOk} hasCookie=${!!storedState})`,
      );
      return res.status(403).send("State verification failed - possible CSRF attack");
    }

    if (!verifyHmac(req.query as Record<string, any>)) {
      return res.status(400).send("HMAC verification failed");
    }

    try {
      // Public apps require expiring offline tokens (expiring=1).
      const tokenResult = await exchangeAuthorizationCode(shop, code);
      if (!tokenResult.ok) {
        console.error("Shopify token exchange failed:", tokenResult.status, tokenResult.error);
        return res.status(500).send("Failed to get access token from Shopify");
      }

      const { fields } = tokenResult;
      const access_token = fields.accessToken;
      const scope = fields.scope || "";

      console.log(`Shopify OAuth completed for ${shop}`);
      console.log(`Scopes granted: ${scope || "NONE"}`);
      console.log(`Requested scopes were: ${SHOPIFY_SCOPES}`);
      console.log(
        `Token mode: ${fields.refreshToken ? "expiring offline" : "non-expiring offline (unexpected)"}`,
      );

      // Get merchant ID from cookie if available
      const merchantId = req.cookies?.shopify_merchant || null;
      if (merchantId) {
        console.log(`Associating installation with merchant: ${merchantId}`);
      }

      let installation = await storage.getShopifyInstallationByShop(shop);

      if (installation) {
        const updates: any = {
          accessToken: access_token,
          refreshToken: fields.refreshToken,
          accessTokenExpiresAt: fields.accessTokenExpiresAt,
          refreshTokenExpiresAt: fields.refreshTokenExpiresAt,
          scope,
          status: "active",
          installedAt: new Date(),
          uninstalledAt: null,
          embedConfirmedAt: null,
        };
        // Always update merchant ID on reinstall if we have one (handles reinstall with different logged-in user)
        if (merchantId) {
          updates.merchantId = merchantId;
          console.log(`Reinstall: Updating merchant ID from ${installation.merchantId || "none"} to ${merchantId}`);
        }
        await storage.updateShopifyInstallation(installation.id, updates);
        console.log(`Updated existing installation for ${shop} (reinstall detected)`);
      } else {
        installation = await storage.createShopifyInstallation({
          shopDomain: shop,
          accessToken: access_token,
          refreshToken: fields.refreshToken,
          accessTokenExpiresAt: fields.accessTokenExpiresAt,
          refreshTokenExpiresAt: fields.refreshTokenExpiresAt,
          scope,
          status: "active",
          installedAt: new Date(),
          merchantId: merchantId,
        });
        console.log(`Created new installation for ${shop}${merchantId ? ` with merchant ${merchantId}` : ""}`);
      }

      await registerCartScript(shop, access_token);
      void ensureCreatorCheckoutWebhooks({ shop, accessToken: access_token }).catch((e: any) =>
        console.warn("[creator-webhooks] post-OAuth register failed:", e?.message || e),
      );
      void ensureShopifyCarrierService({ shop, accessToken: access_token }).then((r) => {
        if (!r.ok) console.warn("[carrier-shipping] post-OAuth register:", r.reason);
        else console.log("[carrier-shipping] post-OAuth", r.reason, shop);
      });

      res.clearCookie("shopify_state");
      res.clearCookie("shopify_merchant");

      // Deep-link straight into the embedded app's setup rail instead of the
      // generic Shopify "Apps" list. /admin/setup is safe to land on even for
      // reinstalls of an already-configured shop — completed steps just show
      // as done (see docs/merchant-setup-rail.md).
      const setupPath = "/admin/setup";
      const embedKey = tokenResult.credentials?.apiKey || primaryKey();
      const redirectUrl = embedKey
        ? `https://${shop}/admin/apps/${embedKey}${setupPath}`
        : `https://${shop}/admin/apps`;
      res.redirect(redirectUrl);
    } catch (error) {
      console.error("Shopify OAuth error:", error);
      res.status(500).send("Failed to complete Shopify installation");
    }
  });

  app.get("/shopify/status", async (req: Request, res: Response) => {
    const shop = req.query.shop as string;
    const validate = req.query.validate === "true";

    if (!shop) {
      return res.json({ installed: false, error: "No shop provided" });
    }

    const installation = await storage.getShopifyInstallationByShop(shop);

    if (!installation) {
      return res.json({ 
        installed: false, 
        status: "not_installed",
        reinstallUrl: `/shopify/install?shop=${encodeURIComponent(shop)}`
      });
    }

    // If validation requested or status is questionable, validate the token
    let tokenValid = installation.status === "active";
    let tokenError: string | undefined;
    
    if (validate && installation.accessToken) {
      const validation = await validateShopifyToken(shop, installation.accessToken);
      tokenValid = validation.valid;
      tokenError = validation.error;
      
      // Update status and clear token if invalid
      if (!validation.valid && installation.status === "active") {
        await storage.updateShopifyInstallation(installation.id, {
          status: "token_invalid",
          accessToken: "", // Clear invalid token to prevent reuse
        });
      }
    }

    // Check if the stored token is missing any required scopes.
    // Note: Shopify's OAuth token response only lists write_ scopes; write_X implies read_X.
    // So we expand the granted set: if write_X is present, treat read_X as also granted.
    const REQUIRED_SCOPES = SHOPIFY_SCOPES.split(",").map(s => s.trim());
    const grantedScopes = (installation.scope || "").split(",").map(s => s.trim());
    const expandedGranted = new Set(grantedScopes);
    for (const s of grantedScopes) {
      if (s.startsWith("write_")) expandedGranted.add(s.replace("write_", "read_"));
    }
    const missingScopes = REQUIRED_SCOPES.filter(s => !expandedGranted.has(s));
    const scopesMissing = missingScopes.length > 0;

    res.json({
      installed: installation.status === "active" && tokenValid,
      status: installation.status,
      tokenValid: tokenValid,
      tokenError: tokenError,
      shop: installation.shopDomain,
      scope: installation.scope,
      installedAt: installation.installedAt,
      missingScopes: scopesMissing ? missingScopes : [],
      needsReinstall: !tokenValid || installation.status === "token_invalid" || scopesMissing,
      reinstallUrl: `/shopify/install?shop=${encodeURIComponent(shop)}`
    });
  });

  app.post("/shopify/webhooks/uninstall", async (req: Request, res: Response) => {
    const hmacHeader = req.headers["x-shopify-hmac-sha256"] as string;
    const topic = req.headers["x-shopify-topic"] as string;
    const shop = req.headers["x-shopify-shop-domain"] as string;

    if (topic !== "app/uninstalled") {
      return res.status(200).send("OK");
    }

    const rawBody = (req as { rawBody?: Buffer | string }).rawBody;
    const bodyBuf = Buffer.isBuffer(rawBody)
      ? rawBody
      : typeof rawBody === "string"
        ? Buffer.from(rawBody, "utf8")
        : Buffer.from(JSON.stringify(req.body ?? {}), "utf8");
    if (!hmacHeader || !hmacBase64MatchesAnySecret(bodyBuf, hmacHeader)) {
      return res.status(401).send("HMAC verification failed");
    }

    const installation = await storage.getShopifyInstallationByShop(shop);
    if (installation) {
      // Guard against a late-arriving uninstall webhook overwriting a fresh reinstall.
      // Shopify can deliver app/uninstalled seconds to minutes after removal.
      const ageMs = Date.now() - new Date(installation.installedAt).getTime();
      if (ageMs < 90_000) {
        console.warn(
          `[uninstall-webhook] Skipping stale uninstall for ${shop} — ` +
          `installation is only ${Math.round(ageMs / 1000)}s old (fresh reinstall detected)`
        );
        return res.status(200).send("OK");
      }
      // Stronger guard: if the stored token still works, the app was reinstalled
      // and this webhook is stale (can arrive well after the 90s window).
      if (
        installation.accessToken &&
        installation.accessToken !== "NEEDS_RECONNECT" &&
        installation.status === "active"
      ) {
        const stillValid = await validateShopifyToken(shop, installation.accessToken);
        if (stillValid.valid) {
          console.warn(
            `[uninstall-webhook] Skipping stale uninstall for ${shop} — access token still valid (reinstalled)`,
          );
          return res.status(200).send("OK");
        }
      }
      await storage.updateShopifyInstallation(installation.id, {
        status: "uninstalled",
        uninstalledAt: new Date(),
        embedConfirmedAt: null,
      });
      console.log(`[uninstall-webhook] Marked ${shop} as uninstalled`);

      // Phase 3 shipping cleanup: token is revoked so no Shopify calls — clear
      // the delivery-profile ID map + flip mode off (Shopify removes app-owned
      // shipping resources itself). Never block the webhook response.
      import("./shipping-reconciler")
        .then((m) => m.clearShopShippingState(shop))
        .then(() => console.log(`[uninstall-webhook] Cleared shipping state for ${shop}`))
        .catch((e) =>
          console.error(`[uninstall-webhook] shipping cleanup failed for ${shop}:`, e?.message || e),
        );
    }

    res.status(200).send("OK");
  });

  // Returns a signed reinstall URL for the given shop. Only callable by authenticated
  // admin sessions (auth guard applied in routes.ts after this file registers routes).
  // The resulting URL includes a time-stable HMAC key that the /shopify/reinstall
  // route validates, ensuring no unauthenticated actor can trigger revocation.
  app.get("/shopify/reinstall-url", async (req: Request, res: Response) => {
    const shop = req.query.shop as string;
    if (!shop || !isValidShopDomain(shop)) {
      return res.status(400).json({ error: "Invalid or missing shop domain" });
    }
    const key = reinstallKeyForShop(shop) || "dev";
    const url = `/shopify/reinstall?shop=${encodeURIComponent(shop)}&key=${key}`;
    res.json({ url });
  });

  // Revoke token and redirect to reinstall (forces new permission prompt).
  // Protected: requires a valid HMAC key to prevent unauthenticated calls from
  // automated probes/health-checks from accidentally revoking live tokens.
  // Generate the key via GET /shopify/reinstall-url?shop=X (admin-authenticated).
  app.get("/shopify/reinstall", async (req: Request, res: Response) => {
    const shop = req.query.shop as string;
    const key  = req.query.key  as string;

    if (!shop || !isValidShopDomain(shop)) {
      return res.status(400).send("Invalid or missing shop domain");
    }

    // Require a time-stable HMAC(secret, shop) so only someone with the API
    // secret (i.e. the server / admin UI) can trigger token revocation.
    if (hasShopifyAppCredentials()) {
      if (!verifyReinstallKey(shop, key)) {
        console.warn(`[shopify/reinstall] Blocked unauthenticated request for ${shop} from ${req.ip}`);
        return res.status(403).send("Forbidden — reinstall requires a valid key");
      }
    }

    try {
      const installation = await storage.getShopifyInstallationByShop(shop);
      
      if (installation?.accessToken) {
        // Revoke the existing token
        console.log(`Revoking token for ${shop} to force re-authorization`);
        
        const revokeResponse = await fetch(
          `https://${shop}/admin/api_permissions/current.json`,
          {
            method: "DELETE",
            headers: {
              "X-Shopify-Access-Token": installation.accessToken,
            },
          }
        );
        
        if (revokeResponse.ok) {
          console.log(`Token revoked successfully for ${shop}`);
          // Mark as needing reinstall
          await storage.updateShopifyInstallation(installation.id, {
            status: "pending_reinstall",
            accessToken: "",
            scope: "",
          });
        } else {
          console.log(`Token revoke response: ${revokeResponse.status}`);
        }
      }

      // Redirect to install flow
      res.redirect(`/shopify/install?shop=${encodeURIComponent(shop)}`);
    } catch (error) {
      console.error("Error revoking Shopify token:", error);
      // Still try to reinstall even if revoke failed
      res.redirect(`/shopify/install?shop=${encodeURIComponent(shop)}`);
    }
  });

  console.log("Shopify OAuth routes registered");
}
