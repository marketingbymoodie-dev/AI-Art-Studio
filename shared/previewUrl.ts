/**
 * Preview-URL normalize for saved-design mockups.
 *
 * Tester flat apply can pin canvas.toDataURL() as the gallery preview.
 * An older host-concat treated `data:` as a relative path and persisted
 * `https://<host>/data:image/…`. One unwrap heals that at write and read.
 */

export function isDataPreviewUrl(url: string): boolean {
  return url.startsWith("data:");
}

export function isHostedHttpUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

/**
 * Peel a host/prefix off a data: payload, and peel an embedded http(s)
 * URL that was wrapped in `/apps/appai/…`.
 *
 *   data:…                              → unchanged
 *   https://host/data:…                 → data:…
 *   https://host/apps/appai/data:…      → data:…
 *   /data:…                             → data:…
 *   /apps/appai/data:…                  → data:…
 *   /apps/appai/https://cdn/…           → https://cdn/…
 *   real https://host/objects/…         → unchanged
 */
export function unwrapMangledPreviewUrl(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return raw ?? null;
  if (typeof raw !== "string") return null;
  const u = raw.trim();
  if (!u) return u;
  if (isDataPreviewUrl(u)) return u;

  const relativeData = u.match(/^\/(?:apps\/appai\/)?(data:.*)$/);
  if (relativeData) return relativeData[1];

  const hostedData = u.match(
    /^https?:\/\/[^/?#]+(?:\/apps\/appai)?\/(data:.*)$/i,
  );
  if (hostedData) return hostedData[1];

  const embeddedHttp = Math.max(u.lastIndexOf("https://"), u.lastIndexOf("http://"));
  if (embeddedHttp > 0) return u.slice(embeddedHttp);

  return u;
}

/**
 * Shared preview-URL normalize.
 *
 * - data: (including unwrapped mangled rows) → unchanged
 * - real hosted http(s) → unchanged
 * - genuine relative path → resolveRelative, or returned as-is
 */
export function normalizePreviewUrl(
  raw: string | null | undefined,
  resolveRelative?: (relativePath: string) => string,
): string | null {
  const unwrapped = unwrapMangledPreviewUrl(raw);
  if (unwrapped == null || unwrapped === "") return unwrapped;
  if (isDataPreviewUrl(unwrapped)) return unwrapped;
  if (isHostedHttpUrl(unwrapped)) return unwrapped;
  if (resolveRelative) return resolveRelative(unwrapped);
  return unwrapped;
}

/** URLs save-mockups may persist (hosted or a data: preview). */
export function isPersistablePreviewUrl(url: string): boolean {
  return isDataPreviewUrl(url) || isHostedHttpUrl(url);
}
