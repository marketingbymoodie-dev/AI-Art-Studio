/** Per-visitor saved artwork library on a creator storefront. */

/** Hard cap — oldest unique artworks are unlinked so new gens can auto-save. */
export const CREATOR_ARTWORK_LIMIT = 50;

/** Thumbnails shown inline under "Your artwork" before "See more". */
export const CREATOR_ARTWORK_STRIP_LIMIT = 8;

export function dedupeCreatorArtworksByUrl<T extends { artworkUrl: string }>(
  rows: T[],
  limit = Number.POSITIVE_INFINITY,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const artworkUrl = String(row.artworkUrl || "").trim();
    if (!artworkUrl || seen.has(artworkUrl)) continue;
    seen.add(artworkUrl);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * `rowsNewestFirst` is already newest-first. When unique artwork count is
 * over `limit`, return every job ID whose artwork URL is among the oldest
 * overflow images (keeps the newest `limit`).
 */
export function pickOldestCreatorArtworkJobIdsToEvict(
  rowsNewestFirst: Array<{ jobId: string; artworkUrl: string }>,
  limit: number,
): string[] {
  const jobId = (row: { jobId: string }) => String(row.jobId || "").trim();
  const url = (row: { artworkUrl: string }) => String(row.artworkUrl || "").trim();
  if (limit <= 0) return rowsNewestFirst.map(jobId).filter(Boolean);
  const unique = dedupeCreatorArtworksByUrl(rowsNewestFirst);
  if (unique.length <= limit) return [];
  const evictUrls = new Set(unique.slice(limit).map(url).filter(Boolean));
  return rowsNewestFirst
    .filter((row) => evictUrls.has(url(row)))
    .map(jobId)
    .filter(Boolean);
}
