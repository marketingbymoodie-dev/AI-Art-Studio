/** Strip `job::mockupHash` / `job::size::color` down to the generation job id. */
export function shadowJobPrefix(designId: string): string {
  const raw = String(designId || "").trim();
  if (!raw) return "";
  const idx = raw.indexOf("::");
  return idx === -1 ? raw : raw.slice(0, idx);
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
 * Canonical reusable shadow key: one variant per generation job.
 * Size/colour live on the base variant used at create time; placement edits
 * reuse this row and refresh the mockup image (see resolve-design-variant).
 */
export function reusableShadowDesignId(jobId: string): string {
  return shadowJobPrefix(jobId) || String(jobId || "").trim() || "design";
}

/** Lookup order: incoming id, legacy URL-hash, bare job (PreShadow). */
export function shadowLookupKeys(designId: string, mockupUrl?: string): string[] {
  const incoming = String(designId || "").trim();
  const job = shadowJobPrefix(incoming) || incoming;
  const keys: string[] = [];
  if (incoming) keys.push(incoming);
  if (job && mockupUrl) keys.push(shadowDesignIdForCart(job, mockupUrl));
  if (job) keys.push(job);
  return [...new Set(keys.filter(Boolean))];
}
