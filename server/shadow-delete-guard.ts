/**
 * Scheduled cleanups may delete only a product that is still a shadow.
 * Catalogue listings carry ai_art_studio.design_candidate_id and are never
 * tagged appai-shadow. A failed lookup is not permission to delete.
 */
export type LiveShadowProduct = {
  id: string;
  title: string;
  tags: string[];
  productType: string;
  hasDesignCandidate: boolean;
};

export type ShadowDeleteDecision = "delete" | "skip" | "missing";

export function shadowDeleteDecision(
  product: LiveShadowProduct | null | undefined,
  opts: { requireProductType: boolean },
): ShadowDeleteDecision {
  if (!product) return "missing";
  const tagged = product.tags.some((tag) => tag.trim().toLowerCase() === "appai-shadow");
  const typeOk = !opts.requireProductType || product.productType.trim().toLowerCase() === "appai-shadow";
  if (tagged && typeOk && !product.hasDesignCandidate) return "delete";
  return "skip";
}

