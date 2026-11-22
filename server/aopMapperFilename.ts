/**
 * Filename allowlist for AOP mapper assets.
 *
 * GET /api/platform/aop-mapper/mockups/:filename is public (storefront <img>
 * cannot send a session cookie). This check is the only gate on that route —
 * it must reject path traversal, encoded dots, and anything that is not a
 * single basename + known image extension.
 */
import path from "node:path";

/** Anchored: one basename, no slashes/dots in the stem, known image suffix. */
export const SAFE_FILENAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_\-]*\.(png|jpg|jpeg|webp)$/i;

const MAX_FILENAME_LEN = 96;

export function isSafeMapperFilename(name: unknown): boolean {
  if (typeof name !== "string") return false;
  if (name.length === 0 || name.length > MAX_FILENAME_LEN) return false;
  if (name.includes("\0") || name.includes("%") || name.includes("/") || name.includes("\\")) {
    return false;
  }
  if (name.includes("..")) return false;
  if (path.basename(name) !== name) return false;
  return SAFE_FILENAME_RE.test(name);
}

const MAPPER_MOCKUP_SRC_RE =
  /\/(?:api\/(?:platform\/aop-mapper|dev\/hoodie-mapper)\/)?mockups\/([^/?#]+)/i;

/** True when a template mockup.src still points at the admin authoring route. */
export function isMapperMockupSrc(src: unknown): boolean {
  if (typeof src !== "string" || !src) return false;
  return (
    src.includes("/api/platform/aop-mapper/mockups/") ||
    src.includes("/api/dev/hoodie-mapper/mockups/")
  );
}

/** Basename from a mapper (or leftover /mockups/) URL, if it passes the allowlist. */
export function mapperMockupFilenameFromSrc(src: unknown): string | null {
  if (typeof src !== "string" || !src) return null;
  const match = src.match(MAPPER_MOCKUP_SRC_RE);
  if (!match?.[1]) return null;
  let decoded = match[1];
  try {
    decoded = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return isSafeMapperFilename(decoded) ? decoded : null;
}
