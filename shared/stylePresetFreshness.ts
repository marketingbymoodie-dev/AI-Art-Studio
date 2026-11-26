/** Same-origin admin → embed refresh. Shopify PDP parent cannot hear this channel. */
export const STYLE_PRESETS_CHANNEL = "appai-style-presets";
export const STYLE_PRESETS_STORAGE_KEY = "appai-style-presets-ts";

export function notifyStylePresetsChanged(): void {
  const ts = String(Date.now());
  try {
    localStorage.setItem(STYLE_PRESETS_STORAGE_KEY, ts);
  } catch {
    /* private mode */
  }
  try {
    const ch = new BroadcastChannel(STYLE_PRESETS_CHANNEL);
    ch.postMessage({ type: "invalidate", ts });
    ch.close();
  } catch {
    /* unsupported */
  }
}

/** After the iframe owns a successful fetch, ignore parent dumps unless the product changed. */
export function shouldApplyParentStylePresets(opts: {
  owned: boolean;
  incomingProductTypeId?: string | null;
  currentProductTypeId?: string | null;
}): boolean {
  const incoming = String(opts.incomingProductTypeId || "").trim();
  const current = String(opts.currentProductTypeId || "").trim();
  const productChanged = !!(
    incoming &&
    current &&
    incoming !== "0" &&
    current !== "0" &&
    incoming !== current
  );
  if (productChanged) return true;
  return !opts.owned;
}
