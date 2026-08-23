/** Strip `job::mockupHash` / `job::variantId` / `job::size::color` down to the generation job id. */
export function shadowJobPrefix(designId: string): string {
  const raw = String(designId || "").trim();
  if (!raw) return "";
  const idx = raw.indexOf("::");
  return idx === -1 ? raw : raw.slice(0, idx);
}

function numericVariantId(raw: string | number | null | undefined): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/** Legacy key: one Shopify shadow per job + mockup URL (URL churn minted duplicates). */
export function shadowDesignIdForCart(jobId: string, mockupUrl: string): string {
  const job = String(jobId || "").trim() || "design";
  const url = String(mockupUrl || "").trim();
  let h = 0;
  for (let i = 0; i < url.length; i++) {
    h = (Math.imul(31, h) + url.charCodeAt(i)) | 0;
  }
  const hash = Math.abs(h).toString(36);
  return `${job}::${hash}`;
}

/**
 * Canonical reusable shadow key: one variant per generation job + catalog size/colour.
 * Same job+variant increments the cart line. A different size/colour mints its own
 * shadow so cart title and price match what the customer picked.
 */
export function reusableShadowDesignId(
  jobId: string,
  baseVariantId?: string | number | null,
): string {
  const job = shadowJobPrefix(jobId) || String(jobId || "").trim() || "design";
  const vid = numericVariantId(baseVariantId);
  return vid ? `${job}::${vid}` : job;
}

/** Lookup order: incoming id, job+variant, legacy URL-hash, bare job (PreShadow). */
export function shadowLookupKeys(
  designId: string,
  mockupUrl?: string,
  baseVariantId?: string | number | null,
): string[] {
  const incoming = String(designId || "").trim();
  const job = shadowJobPrefix(incoming) || incoming;
  const vid = numericVariantId(baseVariantId);
  const keyed = vid ? `${job}::${vid}` : "";
  const keys: string[] = [];
  if (incoming) keys.push(incoming);
  if (keyed && keyed !== incoming) keys.push(keyed);
  if (job && mockupUrl) keys.push(shadowDesignIdForCart(job, mockupUrl));
  if (job) keys.push(job);
  return [...new Set(keys.filter(Boolean))];
}

/** True when a stored shadow was created for this catalog variant. */
export function shadowMatchesBaseVariant(
  storedBaseVariantId: string | number | null | undefined,
  incomingVariantId: string | number | null | undefined,
): boolean {
  const a = numericVariantId(storedBaseVariantId);
  const b = numericVariantId(incomingVariantId);
  return !!a && !!b && a === b;
}
