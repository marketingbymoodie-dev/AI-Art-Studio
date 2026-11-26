/** True when this tab was not opened by Shopify Admin. Latched by the caller. */
export function openedOutsideShopify(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.has("host") || params.has("shop")) return false;
  try {
    if (sessionStorage.getItem("shopify_host") || sessionStorage.getItem("shopify_shop")) return false;
  } catch {
    return false;
  }
  try {
    if (window.top !== window.self) return false;
  } catch {
    return false;
  }
  return true;
}
