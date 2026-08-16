/** Stable shadow-SKU key so two mockups never share one checkout variant. */
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
