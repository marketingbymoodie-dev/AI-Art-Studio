/**
 * Promote copies a delivery profile from a studio variant that is already in
 * the shipping map. Those rows exist only after a customizer page has created
 * the unlisted studio product and the reconciler has associated it.
 * A product type with none of them must not publish: the reconciler leaves
 * the new variants on the General profile.
 */

export class PromoteShippingError extends Error {
  readonly status = 409;
  constructor(productTypeName: string) {
    super(promoteShippingRefusal(productTypeName));
    this.name = "PromoteShippingError";
  }
}

export function promoteShippingRefusal(productTypeName: string): string {
  const name = productTypeName.trim() || "This product type";
  return `${name} has no mapped studio variants. A customizer page is required before this product type can be promoted.`;
}

/** Numeric Shopify variant ids from product_types.shopifyVariantIds maps. */
export function collectStudioVariantIds(maps: unknown[]): string[] {
  const ids = new Set<string>();
  for (const map of maps) {
    if (!map || typeof map !== "object" || Array.isArray(map)) continue;
    for (const value of Object.values(map as Record<string, unknown>)) {
      const id = variantIdToken(value);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

/**
 * Table mode is the only mode that publishes onto a copied profile.
 * Off / missing settings keep the General profile on purpose.
 */
export function promoteBlockedWithoutMappedStudioVariants(input: {
  shippingMode: string | null | undefined;
  studioVariantIds: readonly string[];
  mappedVariantIds: readonly string[];
}): boolean {
  if (input.shippingMode !== "table") return false;
  const mapped = new Set(input.mappedVariantIds);
  return !input.studioVariantIds.some((id) => mapped.has(id));
}

function variantIdToken(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const id = String(Math.trunc(value));
    return /^\d+$/.test(id) ? id : null;
  }
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}
