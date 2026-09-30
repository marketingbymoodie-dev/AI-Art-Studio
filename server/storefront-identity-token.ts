/** Storefront identity tokens (signed JWT, 30 days). Issued by bootstrap refresh and sign-in only. */
import jwt from "jsonwebtoken";

export const STOREFRONT_IDENTITY_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

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

export function signStorefrontIdentityToken(customerId: string, shop: string, ttlSeconds = STOREFRONT_IDENTITY_TOKEN_TTL_SECONDS): string {
  return jwt.sign({ sub: customerId, shop, typ: "storefront_identity" }, getIdentitySecret(), { expiresIn: ttlSeconds });
}

/** Verified token from an Authorization header value, or null (missing, invalid, expired, wrong type). */
export function verifyStorefrontIdentityHeader(authorization: string | undefined | null): { customerId: string; shop?: string } | null {
  const auth = authorization || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  try {
    const payload = jwt.verify(auth.slice("bearer ".length), getIdentitySecret()) as jwt.JwtPayload;
    if (!payload?.sub || payload.typ !== "storefront_identity") return null;
    return { customerId: String(payload.sub), shop: typeof payload.shop === "string" ? payload.shop : undefined };
  } catch {
    return null;
  }
}
