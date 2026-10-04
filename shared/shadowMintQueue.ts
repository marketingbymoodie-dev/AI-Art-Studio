/**
 * Pure policy for the background shadow mint queue.
 * Dead after 3 attempts. The first two failures wait 5s then 30s.
 * The 120s slot is recorded so the schedule stays visible, and is not used:
 * the third failure is terminal.
 */
export const SHADOW_MINT_MAX_IN_FLIGHT_PER_SHOP = 2;
export const SHADOW_MINT_MAX_IN_FLIGHT_GLOBAL = 8;
export const SHADOW_MINT_LEASE_MS = 60_000;
export const SHADOW_MINT_MAX_ATTEMPTS = 3;
export const SHADOW_MINT_BACKOFF_MS = [5_000, 30_000, 120_000] as const;

/** Delay before the next attempt after `attempts` failures. null = dead. */
export function shadowMintRetryDelayMs(attempts: number): number | null {
  if (attempts >= SHADOW_MINT_MAX_ATTEMPTS) return null;
  if (attempts <= 1) return SHADOW_MINT_BACKOFF_MS[0];
  return SHADOW_MINT_BACKOFF_MS[1];
}

/**
 * Newer key for the same job::variant cancels older pending keys.
 * `jobId::variantId::cfg` → prefix `jobId::variantId::`.
 */
export function shadowMintSupersedePrefix(key: string): string | null {
  const parts = String(key || "").split("::");
  if (parts.length < 3 || !parts[0] || !parts[1]) return null;
  return `${parts[0]}::${parts[1]}::`;
}

export function shadowMintLikePrefix(prefix: string): string {
  return `${prefix.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/** Nearest-rank percentile. `sorted` must be ascending. */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}
