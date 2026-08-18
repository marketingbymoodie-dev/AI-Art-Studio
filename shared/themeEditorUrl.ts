/** Theme app-embed block filename without `.liquid`. */
export const THEME_EMBED_HANDLE = "ai-art-embed";

function activateQuery(apiKey: string): string {
  return apiKey
    ? `&activateAppId=${encodeURIComponent(`${apiKey}/${THEME_EMBED_HANDLE}`)}`
    : "";
}

/**
 * HTTPS Admin URL (fallback / server status). Prefer `buildThemeEditorShopifyHref`
 * from the embedded app so App Bridge keeps Setup in history.
 */
export function buildThemeEditorUrl(shopDomain: string, apiKey: string): string | null {
  const shop = shopDomain.replace(/^https?:\/\//, "").toLowerCase();
  const handle = shop.replace(/\.myshopify\.com$/, "").replace(/\/.*$/, "");
  if (!handle || handle.includes(".")) return null;
  return `https://admin.shopify.com/store/${handle}/themes/current/editor?context=apps${activateQuery(apiKey)}`;
}

/**
 * App Bridge admin protocol. Use with target=_top (or window.open(_, '_top')).
 * A full https://admin.shopify.com/... assignment wipes Admin history so the
 * browser back button cannot return to Setup.
 */
export function buildThemeEditorShopifyHref(apiKey: string): string {
  return `shopify://admin/themes/current/editor?context=apps${activateQuery(apiKey)}`;
}

/** Convert an admin.shopify.com / {shop}/admin theme-editor URL to shopify:// */
export function httpsAdminUrlToShopifyProtocol(url: string): string {
  try {
    const parsed = new URL(url);
    const themePath = parsed.pathname.match(/\/themes\/.+$/);
    const path = themePath ? themePath[0] : parsed.pathname.replace(/^\/store\/[^/]+/, "");
    if (!path.startsWith("/themes/")) return url;
    return `shopify://admin${path}${parsed.search}`;
  } catch {
    return url;
  }
}
