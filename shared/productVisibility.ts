/**
 * Which kind of Shopify product this is. Required at every create.
 * There is no default: a missing kind throws and names the caller.
 *
 * published — a flywheel catalogue product
 * unlisted  — a customizer base product (createShopifyProductForType)
 * hidden    — a shadow cart product
 *
 * Publish-now / draft is a separate timing choice and only applies to published.
 */
export const PRODUCT_VISIBILITY_KINDS = ["published", "unlisted", "hidden"] as const;

export type ProductVisibilityKind = (typeof PRODUCT_VISIBILITY_KINDS)[number];

function callSite(): string {
  const lines = new Error().stack?.split("\n").slice(1) ?? [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("at ")) continue;
    if (
      trimmed.includes("callSite")
      || trimmed.includes("requireProductVisibility")
      || trimmed.includes("shopifyStatusForVisibility")
    ) continue;
    return trimmed.replace(/^at /, "");
  }
  return "unknown call site";
}

export function requireProductVisibility(kind: unknown): ProductVisibilityKind {
  if (kind === "published" || kind === "unlisted" || kind === "hidden") return kind;
  throw new Error(`Visibility kind is required: published | unlisted | hidden. Omitted at ${callSite()}`);
}

/**
 * Shopify product status for a kind.
 * A hidden shadow stays `unlisted` so the cart can add it. It is not a catalogue product.
 * Draft timing holds a published product. It does not turn it into an unlisted base.
 */
export function shopifyStatusForVisibility(
  kind: unknown,
  timing: "publish" | "draft" = "publish",
): "active" | "draft" | "unlisted" {
  const visibility = requireProductVisibility(kind);
  if (visibility === "published") return timing === "draft" ? "draft" : "active";
  return "unlisted";
}
