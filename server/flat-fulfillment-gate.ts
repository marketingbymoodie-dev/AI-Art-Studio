/**
 * Printify submission from orders/paid.
 * The env flag is a global kill switch. The per-shop flag defaults off.
 * Both must be on before a shop's paid order is submitted.
 */
export type FlatFulfillmentDecision = "submit" | "kill-switch" | "shop-disabled";

export function flatFulfillmentDecision(
  envValue: string | undefined,
  shopEnabled: boolean,
): FlatFulfillmentDecision {
  if (envValue !== "true") return "kill-switch";
  if (shopEnabled !== true) return "shop-disabled";
  return "submit";
}
