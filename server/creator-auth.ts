/**
 * Creator Portal auth (Phase 6) — OTP via Resend + JWT identity token.
 */
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { eq, sql } from "drizzle-orm";
import { canCreatorAccessPortal } from "@shared/creatorMarketplace";
import { creators, type Creator } from "@shared/schema";
import { db } from "./db";
import { isCreatorMarketplaceEnabled } from "./creator-config";

const CREATOR_IDENTITY_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
export const CREATOR_AUTH_COOKIE = "appai_creator_token";

function getIdentitySecret(): string {
  const secret = process.env.APPAI_IDENTITY_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("APPAI_IDENTITY_SECRET or SESSION_SECRET must be set");
    }
    return "appai-dev-identity-secret";
  }
  return secret;
}

export function signCreatorIdentityToken(creatorId: string): string {
  return jwt.sign(
    { sub: creatorId, typ: "creator_identity" },
    getIdentitySecret(),
    { expiresIn: CREATOR_IDENTITY_TOKEN_TTL_SECONDS },
  );
}

export function verifyCreatorIdentityToken(token: string): { creatorId: string } | null {
  try {
    const payload = jwt.verify(token, getIdentitySecret()) as jwt.JwtPayload;
    if (!payload?.sub || payload.typ !== "creator_identity") return null;
    return { creatorId: String(payload.sub) };
  } catch {
    return null;
  }
}

function extractBearerOrCookie(req: Request): string | null {
  const auth = req.headers.authorization || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice("bearer ".length).trim() || null;
  }
  const cookieHeader = req.headers.cookie || "";
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === CREATOR_AUTH_COOKIE) {
      return decodeURIComponent(rest.join("=") || "");
    }
  }
  return null;
}

export type CreatorAuthedRequest = Request & {
  creatorId?: string;
  creator?: Creator;
};

export async function requireCreator(
  req: CreatorAuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!isCreatorMarketplaceEnabled()) {
    res.status(404).json({ error: "Creator Marketplace is not enabled." });
    return;
  }
  const token = extractBearerOrCookie(req);
  if (!token) {
    res.status(401).json({ error: "Not signed in." });
    return;
  }
  const verified = verifyCreatorIdentityToken(token);
  if (!verified) {
    res.status(401).json({ error: "Session expired. Please sign in again." });
    return;
  }
  const [row] = await db
    .select()
    .from(creators)
    .where(eq(creators.id, verified.creatorId))
    .limit(1);
  if (!row || !canCreatorAccessPortal(row.status)) {
    res.status(403).json({ error: "This creator account cannot access the portal." });
    return;
  }
  req.creatorId = row.id;
  req.creator = row;
  next();
}

export function setCreatorAuthCookie(res: Response, token: string): void {
  const maxAge = CREATOR_IDENTITY_TOKEN_TTL_SECONDS;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${CREATOR_AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`,
  );
}

export function clearCreatorAuthCookie(res: Response): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${CREATOR_AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  );
}

export async function findPortalCreatorByEmail(email: string): Promise<Creator | null> {
  const emailNorm = email.toLowerCase().trim();
  if (!emailNorm || !emailNorm.includes("@")) return null;
  const [row] = await db
    .select()
    .from(creators)
    .where(sql`lower(${creators.email}) = ${emailNorm}`)
    .limit(1);
  if (!row || !canCreatorAccessPortal(row.status)) return null;
  return row;
}

export async function setCreatorOtp(creatorId: string, code: string, expiresAt: Date): Promise<void> {
  await db
    .update(creators)
    .set({ otpCode: code, otpExpiresAt: expiresAt, updatedAt: new Date() })
    .where(eq(creators.id, creatorId));
}

export async function clearCreatorOtp(creatorId: string): Promise<void> {
  await db
    .update(creators)
    .set({ otpCode: null, otpExpiresAt: null, updatedAt: new Date() })
    .where(eq(creators.id, creatorId));
}

export async function sendCreatorPortalOtpEmail(email: string, code: string): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    throw new Error("Email service not configured");
  }
  const from =
    process.env.CREATOR_PORTAL_EMAIL_FROM ||
    process.env.RESEND_FROM ||
    "AI Art Studio <onboarding@resend.dev>";
  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Your Creator Portal login code",
      html: `<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:20px">
        <h2 style="text-align:center">Creator Portal</h2>
        <p style="text-align:center;color:#666">Your login code</p>
        <div style="background:#f5f5f5;border-radius:8px;padding:20px;text-align:center;margin:20px 0">
          <span style="font-size:32px;letter-spacing:8px;font-weight:bold">${code}</span>
        </div>
        <p style="color:#666;text-align:center">Expires in 10 minutes.</p>
      </div>`,
    }),
  });
  if (!emailRes.ok) {
    const errText = await emailRes.text();
    console.error("[Creator OTP] Resend error:", errText);
    throw new Error("Failed to send email");
  }
}

/** Public-safe creator profile (never OTP / share internals beyond display). */
export function publicCreatorProfile(c: Creator) {
  return {
    id: c.id,
    username: c.username,
    displayName: c.displayName,
    email: c.email,
    status: c.status,
    niche: c.niche,
    profileImageUrl: c.profileImageUrl,
    bio: c.bio,
    branding: c.branding,
    freeGensPerCustomer: c.freeGensPerCustomer,
    monthlyGenerationAllowance: c.monthlyGenerationAllowance,
    monthlyGenerationsUsed: c.monthlyGenerationsUsed,
    generationMonth: c.generationMonth,
    shareBasis: c.shareBasis,
    revenueShareCreatorPct: c.revenueShareCreatorPct,
    betaStartAt: c.betaStartAt,
    betaEndAt: c.betaEndAt,
  };
}
