/**
 * An app/uninstalled delivery is not, by itself, proof the app is gone.
 * Shopify can deliver that webhook after the offline token has merely expired.
 * Shipping maps are deleted only when the refresh token is revoked or the
 * shop rejects the token after a refresh. An expired token is refreshed, or
 * the shop is marked for re-auth, and the maps stay.
 */
export type UninstallCleanupDecision = "skip" | "reauth" | "confirm";

export function decideUninstallCleanup(input: {
  /** ensureValidOfflineAccessToken returned a usable access token. */
  tokenReady: boolean;
  /** Refresh/migration failed because Shopify rejected the credential. */
  needsReinstall: boolean;
  /**
   * shop.json check of the token we would use.
   * null when no usable token was available to check.
   */
  shopStatus: number | null;
}): UninstallCleanupDecision {
  if (input.tokenReady && input.shopStatus != null && input.shopStatus >= 200 && input.shopStatus < 300) {
    return "skip";
  }
  if (input.tokenReady && (input.shopStatus === 401 || input.shopStatus === 403)) {
    return "confirm";
  }
  if (input.tokenReady) return "reauth";
  if (input.needsReinstall) return "confirm";
  return "reauth";
}
