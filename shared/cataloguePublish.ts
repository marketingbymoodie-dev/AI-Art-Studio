/**
 * What the Studio publish button still has to do for one product type.
 * A listing already stored for that type is finished. A stored print file,
 * listing description, or mockup for that type is not repeated.
 */

/** Colour names to tick for one product type. A missing list is every offered colour. An empty list stays empty. */
export function publishColourNames(saved: string[] | undefined, offered: string[]): string[] {
  if (!saved) return [...offered];
  const byKey = new Map(offered.map((name) => [name.toLowerCase(), name]));
  const seen = new Set<string>();
  const names: string[] = [];
  for (const name of saved) {
    const canonical = byKey.get(String(name || "").trim().toLowerCase());
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    names.push(canonical);
  }
  return names;
}

/** One type's saved ticks. Other types stay as they were when this patch is merged. */
export function publishColorTickPatch(productTypeId: number, names: string[]): Record<string, string[]> {
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const name of names) {
    const trimmed = String(name || "").trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key) || clean.length >= 60) continue;
    seen.add(key);
    clean.push(trimmed);
  }
  return { [String(productTypeId)]: clean };
}

export function readPublishColorTicks(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const ticks: Record<string, string[]> = {};
  for (const [key, names] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d+$/.test(key) || !Array.isArray(names)) continue;
    ticks[key] = names.map((name) => String(name || "").trim()).filter(Boolean);
  }
  return ticks;
}

/** Omitted stays on. Only an explicit false writes the My Pet metafield off. */
export function myPetMetafieldValue(enabled: boolean | null | undefined): "true" | "false" {
  return enabled === false ? "false" : "true";
}

export type PublishWorkPhase = "print" | "listing" | "mockups" | "shopify";

export const PUBLISH_PHASE_LABEL: Record<PublishWorkPhase | "done", string> = {
  print: "Preparing print file",
  listing: "Writing listing",
  mockups: "Compositing mockups",
  shopify: "Creating Shopify product",
  done: "Done",
};

export type CatalogueJobPhase = "queued" | PublishWorkPhase | "done" | "failed";

const JOB_LABEL: Record<CatalogueJobPhase, string> = {
  queued: "Queued",
  print: "Preparing print file",
  listing: "Writing listing",
  mockups: "Compositing mockups",
  shopify: "Creating Shopify product",
  done: "Done",
  failed: "Failed",
};

/** Queue text. A failure includes the reason. */
export function catalogueJobLabel(phase: string, error = ""): string {
  const label = JOB_LABEL[phase as CatalogueJobPhase] || "";
  if (phase === "failed") {
    const reason = error.replace(/\s+/g, " ").trim();
    return reason ? `Failed: ${reason}` : "Failed";
  }
  return label;
}

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
