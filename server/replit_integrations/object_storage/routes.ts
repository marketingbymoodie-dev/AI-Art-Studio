import type { Express, Request, RequestHandler } from "express";
import { ObjectStorageService, ObjectNotFoundError, getStorageDir } from "./objectStorage";
import { getSupabaseDesignPublicUrl } from "../../supabaseDesigns";
import { isAuthenticated } from "../auth";
import { creatorIdFromRequest } from "../../creator-auth";
import { checkCreatorRateLimit, clientIpFromReq } from "../../creator-rate-limit";
import path from "path";

function contentTypeToExt(contentType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  const base = contentType.split(";")[0].trim().toLowerCase();
  return map[base] || "bin";
}

/**
 * Hard ceiling for the anonymous storefront upload.
 *
 * Measured against 26,096 real objects in the staging `uploads/` prefix
 * (2026-08): median 0.50 MB, p90 1.10 MB, p99 4.50 MB, max 24.16 MB. This
 * endpoint carries full print files, not just preview PNGs, so a "few MB" cap
 * would reject roughly 1% of legitimate checkouts. 32 MB clears the observed
 * maximum with headroom while still bounding the write.
 */
const STOREFRONT_UPLOAD_MAX_BYTES = 32 * 1024 * 1024;

/** Signature check — the declared Content-Type is caller-controlled and is not evidence. */
function sniffImageType(buffer: Buffer): "image/png" | "image/jpeg" | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
}

type DecodedUpload =
  | { ok: true; buffer: Buffer; contentType: string; ext: string }
  | { ok: false; status: number; error: string };

/**
 * Accepts two body formats:
 *   1. JSON  { "dataUrl": "data:image/png;base64,...", "name": "file.png" }
 *   2. Raw binary body with the correct Content-Type header (e.g. image/png)
 */
function decodeUploadBody(req: Request): DecodedUpload {
  const bodyContentType = String(req.headers["content-type"] || "");
  if (bodyContentType.toLowerCase().includes("application/json")) {
    const { dataUrl, name } = req.body as { dataUrl?: string; name?: string };
    if (!dataUrl) return { ok: false, status: 400, error: "Missing dataUrl in JSON body" };
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) return { ok: false, status: 400, error: "Invalid data URL format" };
    const contentType = match[1];
    const buffer = Buffer.from(match[2], "base64");
    const ext = name
      ? name.split(".").pop() || contentTypeToExt(contentType)
      : contentTypeToExt(contentType);
    return { ok: true, buffer, contentType, ext };
  }

  const buffer = req.body as Buffer;
  if (!Buffer.isBuffer(buffer)) {
    return { ok: false, status: 400, error: "Expected a binary body or a JSON dataUrl" };
  }
  const contentType = bodyContentType.split(";")[0].trim() || "application/octet-stream";
  return { ok: true, buffer, contentType, ext: contentTypeToExt(contentType) };
}

/**
 * Admin/creator upload auth.
 *
 * Two distinct credential systems reach this endpoint: platform admin pages
 * carry a Shopify App Bridge session JWT (`isAuthenticated`), while the Creator
 * Portal carries its own OTP identity token in a cookie. A request with neither
 * falls through to `isAuthenticated`, which rejects it with 401.
 */
const requireUploadAuth: RequestHandler = (req, res, next) => {
  if (creatorIdFromRequest(req)) return next();
  return isAuthenticated(req, res, next);
};

/**
 * Register object storage routes.
 *
 * Routes:
 *   POST /api/uploads/upload            — authenticated upload (admin + creator portal)
 *   POST /api/storefront/uploads/design — anonymous storefront upload, rate/size/type limited
 *   GET  /objects/:path(*)              — serve stored files
 *
 * The old POST /api/uploads/request-url is kept as a compatibility shim that
 * redirects clients to use the new endpoint, returning a 503 with a clear
 * message rather than silently failing.
 */
export function registerObjectStorageRoutes(app: Express): void {
  const objectStorageService = new ObjectStorageService();

  /**
   * Direct file upload endpoint (authenticated).
   *
   * Response: { "objectPath": "/objects/uploads/uuid.png" }
   */
  app.post("/api/uploads/upload", requireUploadAuth, async (req, res) => {
    try {
      const decoded = decodeUploadBody(req);
      if (!decoded.ok) return res.status(decoded.status).json({ error: decoded.error });

      const objectPath = await objectStorageService.saveUploadedBuffer(
        decoded.buffer,
        decoded.contentType,
        decoded.ext,
      );
      res.json({ objectPath });
    } catch (error) {
      console.error("Error uploading file:", error);
      res.status(500).json({ error: "Failed to upload file" });
    }
  });

  /**
   * Storefront design upload — deliberately unauthenticated.
   *
   * The caller is an anonymous storefront visitor turning a generated design
   * data URL into a hosted URL for add-to-cart and print files
   * (client/src/pages/embed-design.tsx). User auth here would break checkout for
   * every visitor, so it is protected by shape instead: per-IP rate limit, a
   * measured hard size cap, and magic-byte validation that the payload really is
   * a PNG or JPEG. Note this is NOT behind `marketplaceGate` — that gate 404s
   * when the Creator Marketplace flag is off, which would break ordinary
   * merchant storefronts.
   */
  app.post("/api/storefront/uploads/design", async (req, res) => {
    try {
      const rate = checkCreatorRateLimit({
        key: `sf-upload-ip:${clientIpFromReq(req)}`,
        limit: 60,
        windowMs: 60 * 60 * 1000,
      });
      if (!rate.ok) {
        res.setHeader("Retry-After", String(rate.retryAfterSec));
        return res.status(429).json({ error: "Too many uploads. Please try again shortly." });
      }

      const decoded = decodeUploadBody(req);
      if (!decoded.ok) return res.status(decoded.status).json({ error: decoded.error });

      if (decoded.buffer.length > STOREFRONT_UPLOAD_MAX_BYTES) {
        return res.status(413).json({
          error: `Image is too large (max ${Math.floor(STOREFRONT_UPLOAD_MAX_BYTES / 1024 / 1024)} MB).`,
        });
      }

      const sniffed = sniffImageType(decoded.buffer);
      if (!sniffed) {
        return res.status(415).json({ error: "Only PNG and JPEG images are accepted." });
      }

      const objectPath = await objectStorageService.saveUploadedBuffer(
        decoded.buffer,
        sniffed,
        sniffed === "image/png" ? "png" : "jpg",
      );
      res.json({ objectPath });
    } catch (error) {
      console.error("Error uploading storefront design:", error);
      res.status(500).json({ error: "Failed to upload file" });
    }
  });

  /**
   * Legacy compatibility shim.
   * Old clients that still call /api/uploads/request-url receive a clear 410 Gone
   * instead of a cryptic 500, prompting them to use the new endpoint.
   */
  app.post("/api/uploads/request-url", (_req, res) => {
    res.status(410).json({
      error: "This endpoint has been replaced. Use POST /api/uploads/upload instead.",
    });
  });

  /**
   * Serve stored files.
   * GET /objects/:objectPath(*)
   *
   * CORS note: these files are loaded by PatternCustomizer canvas with crossOrigin="anonymous"
   * from Shopify storefront origins and other cross-origin contexts. The wildcard ACAO header
   * is safe here — all stored design images are already public-readable (no auth required).
   */
  app.get("/objects/:objectPath(*)", async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    try {
      // Path traversal protection
      const storageDir = getStorageDir();
      const relativePath = req.params.objectPath;
      const resolved = path.resolve(storageDir, relativePath);
      if (!resolved.startsWith(path.resolve(storageDir))) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      await objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        // For designs/ path: try Supabase redirect (files may be in Supabase Storage)
        const relativePath = req.params.objectPath as string;
        if (relativePath?.startsWith("designs/")) {
          const filename = relativePath.slice("designs/".length);
          if (filename && !filename.includes("..") && !filename.includes("/")) {
            const supabaseUrl = getSupabaseDesignPublicUrl(filename);
            if (supabaseUrl) return res.redirect(302, supabaseUrl);
          }
        }
        return res.status(404).json({ error: "Object not found" });
      }
      console.error("Error serving object:", error);
      return res.status(500).json({ error: "Failed to serve object" });
    }
  });
}

export const __testables = {
  requireUploadAuth,
  sniffImageType,
  decodeUploadBody,
  STOREFRONT_UPLOAD_MAX_BYTES,
};
