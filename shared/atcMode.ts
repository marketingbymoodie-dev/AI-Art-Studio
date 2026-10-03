/**
 * Per-shop add-to-cart architecture. Unknown / missing values always resolve to
 * `shadow-direct` so a bad rollout degrades to the synchronous resolve path.
 */
export const ATC_MODES = ["shadow-direct", "base-first", "no-shadow"] as const;
export type AtcMode = (typeof ATC_MODES)[number];
export const DEFAULT_ATC_MODE: AtcMode = "shadow-direct";

export function normalizeAtcMode(raw: unknown): AtcMode {
  const s = String(raw ?? "").trim().toLowerCase();
  return (ATC_MODES as readonly string[]).includes(s) ? (s as AtcMode) : DEFAULT_ATC_MODE;
}
