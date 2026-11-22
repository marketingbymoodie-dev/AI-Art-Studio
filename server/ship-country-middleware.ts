/**
 * Phase 4 Slice B — one ship-to country per request.
 * cookie > GeoLite2 IP > US. Attaches req.shipCountry for listing + generate.
 */
import type { CookieOptions, NextFunction, Request, Response } from "express";
import { clientIpFromReq } from "./creator-rate-limit";
import { lookupCountryForIp } from "./geoip";
import {
  DEFAULT_SHIP_COUNTRY,
  SHIP_COUNTRY_COOKIE,
  normalizeShipCountry,
  resolveShipCountryDecision,
  type ShipCountrySource,
} from "@shared/ship-country";

export { SHIP_COUNTRY_COOKIE, DEFAULT_SHIP_COUNTRY, normalizeShipCountry };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      shipCountry?: string;
      shipCountrySource?: ShipCountrySource;
    }
  }
}

function cookieHeaderValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return part.slice(idx + 1).trim();
      }
    }
  }
  return undefined;
}

export function readShipCountryCookie(req: Request): string | null {
  return (
    normalizeShipCountry(req.cookies?.[SHIP_COUNTRY_COOKIE]) ||
    normalizeShipCountry(cookieHeaderValue(req.headers.cookie, SHIP_COUNTRY_COOKIE))
  );
}

export function shipCountryCookieOptions(req: Request): CookieOptions {
  const host = String(req.hostname || req.headers.host || "")
    .split(":")[0]
    .toLowerCase();
  const opts: CookieOptions = {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 365 * 24 * 60 * 60 * 1000,
    path: "/",
  };
  if (host === "aiartstudio.app" || host.endsWith(".aiartstudio.app")) {
    opts.domain = ".aiartstudio.app";
  }
  return opts;
}

export function applyResolvedShipCountry(
  req: Request,
  res: Response,
  country: string,
  source: ShipCountrySource,
): void {
  req.shipCountry = country;
  req.shipCountrySource = source;
  res.setHeader("X-Ship-Country", country);
  res.setHeader("X-Ship-Country-Source", source);
}

export function writeShipCountryCookie(req: Request, res: Response, country: string): void {
  const normalized = normalizeShipCountry(country);
  const value = normalized && normalized !== "ROW" ? normalized : DEFAULT_SHIP_COUNTRY;
  res.cookie(SHIP_COUNTRY_COOKIE, value, shipCountryCookieOptions(req));
  applyResolvedShipCountry(req, res, value, "cookie");
}

export async function attachShipCountry(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const cookieCountry = readShipCountryCookie(req);
    let ipCountry: string | null = null;
    if (!cookieCountry || cookieCountry === "ROW") {
      ipCountry = await lookupCountryForIp(clientIpFromReq(req));
    }
    const decided = resolveShipCountryDecision({
      cookieCountry,
      ipCountry,
    });
    applyResolvedShipCountry(req, res, decided.country, decided.source);
  } catch (e: any) {
    console.warn("[ship-country] resolve failed, defaulting US:", e?.message || e);
    applyResolvedShipCountry(req, res, DEFAULT_SHIP_COUNTRY, "default");
  }
  next();
}

export function resolvedShipCountryFromReq(req: Request): {
  country: string;
  source: ShipCountrySource;
} {
  return {
    country: req.shipCountry || DEFAULT_SHIP_COUNTRY,
    source: req.shipCountrySource || "default",
  };
}
