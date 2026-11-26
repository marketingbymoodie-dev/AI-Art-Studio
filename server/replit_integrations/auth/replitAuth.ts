import type { Express, RequestHandler } from "express";
import * as jwt from "jsonwebtoken";
import { shopDomainFromSessionClaim } from "../../shopDomain";
import { listShopifyAppCredentials } from "../../shopify-app-credentials";

/**
 * Shopify-native auth (NO Replit OIDC)
 *
 * This replaces the old Replit OIDC + Passport session approach.
 * In Shopify Admin, your frontend must send a Shopify session token (JWT) on API calls:
 *
 *   Authorization: Bearer <sessionToken>
 *
 * Shopify signs session tokens with your app's API secret (HS256).
 */

type ShopifySessionTokenPayload = {
  iss?: string;
  dest?: string; // e.g. https://{shop}.myshopify.com
  aud?: string; // your SHOPIFY_API_KEY
  sub?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  jti?: string;
  sid?: string;
};

// Type for our Shopify-based user object
export interface ShopifyUser {
  claims: {
    sub: string;
  };
}

declare global {
  // Lightweight place to stash shop info for downstream handlers if needed.
  // (Avoids forcing you to refactor other files right now.)
  // eslint-disable-next-line no-var
  namespace Express {
    interface Request {
      shopDomain?: string;
      shopOrigin?: string;
      shopifySession?: ShopifySessionTokenPayload;
    }
  }
}

// Extend the Request type with our user property
// Using module augmentation that doesn't conflict with Passport
declare module "express-serve-static-core" {
  interface Request {
    user?: ShopifyUser | any;
  }
}

function getShopifyApiKey() {
  const key = process.env.SHOPIFY_API_KEY;
  if (!key) throw new Error("Missing env SHOPIFY_API_KEY");
  return key;
}

function getShopifyApiSecret() {
  const secret =
    process.env.SHOPIFY_API_SECRET ||
    process.env.SHOPIFY_API_SECRET_KEY ||
    process.env.SHOPIFY_API_SECRET_SECRET;
  if (!secret) {
    throw new Error("Missing env SHOPIFY_API_SECRET (or SHOPIFY_API_SECRET_KEY)");
  }
  return secret;
}

function verifySessionJwt(token: string): { payload: ShopifySessionTokenPayload; label: string | null } | null {
  const apps = listShopifyAppCredentials();
  if (apps.length === 0) {
    try {
      const decoded = jwt.verify(token, getShopifyApiSecret(), { algorithms: ["HS256"] });
      if (!decoded || typeof decoded !== "object") return null;
      const payload = decoded as ShopifySessionTokenPayload;
      if (payload.aud && payload.aud !== getShopifyApiKey()) return null;
      return { payload, label: "primary" };
    } catch {
      return null;
    }
  }

  for (const app of apps) {
    try {
      const decoded = jwt.verify(token, app.apiSecret, { algorithms: ["HS256"] });
      if (!decoded || typeof decoded !== "object") continue;
      const payload = decoded as ShopifySessionTokenPayload;
      // The signature and the client id must belong to the same app.
      if (payload.aud && payload.aud !== app.apiKey) continue;
      return { payload, label: app.label };
    } catch {
      // try next app secret
    }
  }
  return null;
}

function getBearerToken(req: any): string | null {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (!header || typeof header !== "string") return null;
  const parts = header.split(" ");
  if (parts.length !== 2) return null;
  if (parts[0].toLowerCase() !== "bearer") return null;
  return parts[1] || null;
}

/**
 * Core verifier used by middleware
 */
const verifyShopifySessionToken: RequestHandler = (req, res, next) => {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ message: "Unauthorized: missing session token" });
  }

  const verified = verifySessionJwt(token);
  if (!verified) {
    return res.status(401).json({ message: "Unauthorized: invalid token" });
  }
  const payload = verified.payload;

  // Attach shop info for later handlers.
  // `dest` may be bare `shop.myshopify.com` (no scheme) — fall back to `iss`.
  const { shopDomain, shopOrigin } = shopDomainFromSessionClaim(payload.dest, payload.iss);
  req.shopDomain = shopDomain;
  req.shopOrigin = shopOrigin;
  req.shopifySession = payload;

  // Bridge to req.user.claims.sub for compatibility with existing routes.
  const userId = shopDomain ? `shopify:merchant:${shopDomain}` : payload.sub || "unknown";
  req.user = {
    claims: {
      sub: userId,
    },
  };

  void (async () => {
    if (shopDomain && verified.label) {
      try {
        const { storage } = await import("../../storage");
        const installation = await storage.getShopifyInstallationByShop(shopDomain);
        if (installation?.shopifyApp && installation.shopifyApp !== verified.label) {
          res.status(401).json({ message: "Unauthorized: shop is installed through a different app" });
          return;
        }
        if (installation && !installation.shopifyApp) {
          await storage.updateShopifyInstallation(installation.id, { shopifyApp: verified.label });
        }
      } catch (err) {
        next(err);
        return;
      }
    }
    next();
  })();
};

/**
 * DEV-ONLY bypass middleware.
 * Injects a fake merchant user so all isAuthenticated-guarded routes work
 * without a real Shopify session token. NEVER active in production.
 */
const devBypassAuth: RequestHandler = (req, _res, next) => {
  req.shopDomain = "dev.localhost";
  req.shopOrigin = "http://localhost";
  req.user = {
    claims: {
      sub: "dev:merchant:localhost",
    },
  };
  return next();
};

/**
 * Export name used by your app.
 * In development: skips token verification entirely.
 * In production: enforces Shopify JWT verification.
 */
export const isAuthenticated: RequestHandler =
  process.env.NODE_ENV === "development"
    ? devBypassAuth
    : verifyShopifySessionToken;

/**
 * Legacy hook: some codebases call setupAuth(app).
 * With Shopify session tokens, we do not need to register any auth routes here.
 */
export async function setupAuth(_app: Express) {
  // no-op
}
