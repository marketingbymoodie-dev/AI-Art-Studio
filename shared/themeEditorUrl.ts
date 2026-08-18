/** Theme app-embed block filename without `.liquid`. */
export const THEME_EMBED_HANDLE = "ai-art-embed";

/**
 * Same-tab Shopify Admin deep link into App embeds, focused on our block.
 * Opening this with target=_top keeps Admin history so the editor back arrow
 * returns to the app instead of a blank new tab → Home.
 */
export function buildThemeEditorUrl(shopDomain: string, apiKey: string): string | null {
  const shop = shopDomain.replace(/^https?:\/\//, "").toLowerCase();
  const handle = shop.replace(/\.myshopify\.com$/, "").replace(/\/.*$/, "");
  if (!handle || handle.includes(".")) return null;
  const activate = apiKey
    ? `&activateAppId=${encodeURIComponent(`${apiKey}/${THEME_EMBED_HANDLE}`)}`
    : "";
  return `https://admin.shopify.com/store/${handle}/themes/current/editor?context=apps${activate}`;
}
