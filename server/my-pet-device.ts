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

/** Reads a valid signed device id from the request cookie, or null if absent/tampered. */
export function readMyPetDeviceKey(req: Request): string | null {
  const raw = String(req.cookies?.[MY_PET_DEVICE_COOKIE] || "");
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const deviceId = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  if (!deviceId || !mac || sign(deviceId) !== mac) return null;
  return deviceId;
}

/** Reads the existing device key, or mints and sets a new one. Always returns a usable key. */
export function ensureMyPetDeviceKey(req: Request, res: Response): string {
  const existing = readMyPetDeviceKey(req);
  if (existing) return existing;
  const deviceId = randomUUID();
  const value = `${deviceId}.${sign(deviceId)}`;
  res.cookie(MY_PET_DEVICE_COOKIE, value, cookieOptions(req));
  return deviceId;
}
