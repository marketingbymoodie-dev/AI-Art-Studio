/**
 * Single source of truth for "has this merchant connected their own Printify
 * account yet". Kept dependency-free (no storage/db imports) so both
 * generation-quota.ts and merchant-setup.ts can import it without a cycle.
 *
 * Locked product rule (see merchant setup rail plan): a customizer page must
 * never be publicly reachable, and generation must never exceed the
 * trial/tester allowance, until this returns true.
 */
export function isPrintifyConnected(
  merchant: { printifyApiToken?: string | null; printifyShopId?: string | null } | null | undefined,
): boolean {
  return !!(merchant?.printifyApiToken?.trim() && merchant?.printifyShopId?.trim());
}
