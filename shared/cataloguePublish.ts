/**
 * What the Studio publish button still has to do.
 * A stored Shopify product is finished. A stored print file, listing, or
 * mockup is not repeated.
 */

export type PublishWorkPhase = "print" | "listing" | "mockups" | "shopify";

export const PUBLISH_PHASE_LABEL: Record<PublishWorkPhase | "done", string> = {
  print: "Preparing print file...",
  listing: "Writing listing...",
  mockups: "Compositing mockups...",
  shopify: "Creating Shopify product...",
  done: "Done",
};

export function publishWork(input: {
  hasPrint: boolean;
  hasListing: boolean;
  hasMockups: boolean;
  hasProduct: boolean;
}): PublishWorkPhase[] {
  if (input.hasProduct) return [];
  const phases: PublishWorkPhase[] = [];
  if (!input.hasPrint) phases.push("print");
  if (!input.hasListing) phases.push("listing");
  if (!input.hasMockups) phases.push("mockups");
  phases.push("shopify");
  return phases;
}

/** One list for the button. Promote's wording wins when both name the same gap. */
export function publishPreflightMessages(recipeGaps: string[], blockers: string[]): string[] {
  const skip = new Set<string>();
  if (blockers.some((reason) => reason.startsWith("No colours"))) skip.add("No colours selected.");
  if (blockers.some((reason) => reason.startsWith("No mockup panel is chosen"))) skip.add("Scene is not stored.");
  return [...new Set([...recipeGaps.filter((gap) => !skip.has(gap)), ...blockers])];
}

export function formatCatalogueSpend(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0.00";
  const digits = usd < 0.01 ? 4 : 2;
  return `$${usd.toFixed(digits)}`;
}

export function shopifyAdminProductUrl(shopDomain: string, productId: string): string {
  const store = String(shopDomain || "").replace(/\.myshopify\.com$/i, "");
  const id = String(productId || "").replace(/\D/g, "");
  return `https://admin.shopify.com/store/${store}/products/${id}`;
}
