/**
 * My Pet device identification — cookie only, no sign-in (plan: "device-specific,
 * no cross-device sync, no sign-in"). Caps combine this with IP (see my-pet.ts).
 *
 * The cookie value is `<deviceId>.<hmac>` so a shopper cannot forge another
 * device's id to pool caps across cookie clears; clearing cookies still resets
 * their own cap (accepted limitation — same one every cookie-based cap has).
 */
import { createHmac, randomUUID } from "crypto";
import type { CookieOptions, Request, Response } from "express";

export const MY_PET_DEVICE_COOKIE = "appai_my_pet_device";

function secret(): string {
  return process.env.MY_PET_DEVICE_SECRET || process.env.SESSION_SECRET || "my-pet-dev-secret";
}

function sign(deviceId: string): string {
  return createHmac("sha256", secret()).update(deviceId).digest("hex").slice(0, 32);
}

function cookieOptions(req: Request): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 400 * 24 * 60 * 60 * 1000, // ~13 months — well past the 30-day/7-day content retention
    path: "/",
  };
}

/** Verify a signed `<deviceId>.<hmac>` blob. Returns the deviceId if valid, else null. */
function verifySignedDeviceKey(raw: string): string | null {
  const s = String(raw || "");
  const dot = s.lastIndexOf(".");
  if (dot <= 0) return null;
  const deviceId = s.slice(0, dot);
  const mac = s.slice(dot + 1);
  if (!deviceId || !mac || sign(deviceId) !== mac) return null;
  return deviceId;
}

/** Produce the full signed value (`<deviceId>.<hmac>`) from a deviceId. */
export function signMyPetDeviceKey(deviceId: string): string {
  return `${deviceId}.${sign(deviceId)}`;
}

/** Reads a valid signed device id from the request cookie, or null if absent/tampered. */
export function readMyPetDeviceKey(req: Request): string | null {
  return verifySignedDeviceKey(String(req.cookies?.[MY_PET_DEVICE_COOKIE] || ""));
}

/**
 * Preferred reader for App-Proxy storefront routes. Shopify strips the Cookie
 * header before forwarding to the backend, so the storefront JS sends the
 * signed device key as a `deviceKey` field on body (POST) or query (GET).
 * Falls back to the cookie only for legacy / non-proxy callers.
 *
 * Accepts the full signed `<deviceId>.<hmac>` blob — tampered or malformed
 * values are rejected (returns null) and the caller mints a fresh key.
 */
export function readMyPetDeviceKeyFromProxy(req: Request): string | null {
  const body = (req as any).body;
  const bodyKey = body && typeof body === "object" && typeof body.deviceKey === "string" ? body.deviceKey : "";
  const queryKey = typeof (req.query as any)?.deviceKey === "string" ? String((req.query as any).deviceKey) : "";
  return (
    verifySignedDeviceKey(bodyKey) ||
    verifySignedDeviceKey(queryKey) ||
    readMyPetDeviceKey(req)
  );
}

export type EnsuredMyPetDeviceKey = {
  /** Unsigned deviceId for DB lookups and composition with other keys. */
  deviceKey: string;
  /** Full signed `<deviceId>.<hmac>` blob to echo back for the client to persist. */
  signed: string;
};

/**
 * Reads the existing device key or mints and sets a new one. Returns both the
 * unsigned id (for DB scoping) and the signed blob (for the client to persist
 * in localStorage). Also sets the back-compat cookie — it still reaches the
 * browser via Set-Cookie through the proxy, even though the browser can't
 * send it back to us on subsequent App-Proxy calls.
 */
export function ensureMyPetDeviceKeyFromProxy(req: Request, res: Response): EnsuredMyPetDeviceKey {
  const existing = readMyPetDeviceKeyFromProxy(req);
  const deviceId = existing || randomUUID();
  const signed = signMyPetDeviceKey(deviceId);
  if (!existing) {
    res.cookie(MY_PET_DEVICE_COOKIE, signed, cookieOptions(req));
  }
  return { deviceKey: deviceId, signed };
}

/** @deprecated Prefer `ensureMyPetDeviceKeyFromProxy` for App-Proxy routes. */
export function ensureMyPetDeviceKey(req: Request, res: Response): string {
  return ensureMyPetDeviceKeyFromProxy(req, res).deviceKey;
}
