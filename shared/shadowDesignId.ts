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

/**
 * True when the id is `job::catalogVariantId::printConfigHash`.
 * Legacy `job::urlHash` (2 parts) and `job::M::black` (non-numeric middle) are not cfg-keyed.
 */
export function hasPrintConfigSuffix(designId: string): boolean {
  const parts = String(designId || "").trim().split("::");
  if (parts.length < 3) return false;
  return /^\d+$/.test(parts[1]) && !!parts[2];
}

export function printConfigHashFromDesignId(designId: string): string {
  if (!hasPrintConfigSuffix(designId)) return "";
  return String(designId).trim().split("::").slice(2).join("::");
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
 * Canonical reusable shadow key: generation job + catalog size/colour + optional
 * print-config fingerprint. Same snapshot re-added increments the cart line.
 * A different print snapshot (background, sides, placement, …) mints its own shadow.
 * Pass `printConfigHash` only at ATC commit — not on edit / PreShadow.
 */
export function reusableShadowDesignId(
  jobId: string,
  baseVariantId?: string | number | null,
  printConfigHash?: string | null,
): string {
  const job = shadowJobPrefix(jobId) || String(jobId || "").trim() || "design";
  const vid = numericVariantId(baseVariantId);
  const cfg =
    String(printConfigHash || "").trim() || printConfigHashFromDesignId(String(jobId || ""));
  if (vid && cfg) return `${job}::${vid}::${cfg}`;
  if (vid) return `${job}::${vid}`;
  return job;
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
  const cfg = printConfigHashFromDesignId(incoming);
  if (cfg) {
    const exact = reusableShadowDesignId(incoming, baseVariantId || vid, cfg);
    return [...new Set([incoming, exact].filter(Boolean))];
  }
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
