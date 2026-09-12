/** Fallback when no storefront / creator shop name is available. */
export const DEFAULT_MOBILE_SHELL_BRAND = "AI Art Studio";

function trimName(value: string | null | undefined): string {
  return String(value || "").trim();
}

/**
 * Storefront-scoped mobile top-bar brand.
 *
 * Creator storefronts use the creator's public shop name (never the platform
 * Shopify shop). Independent merchants use the shop display name from theme
 * (`shopName` URL) or merchant `storeName`. Fuller white-label (logo / colours)
 * stays a separate decision — this only resolves the text label.
 */
export function resolveMobileShellBrandName(input: {
  isCreatorStorefront?: boolean;
  creatorStoreName?: string | null;
  merchantStoreName?: string | null;
  shopNameParam?: string | null;
}): string {
  if (input.isCreatorStorefront) {
    return trimName(input.creatorStoreName) || DEFAULT_MOBILE_SHELL_BRAND;
  }
  return (
    trimName(input.shopNameParam) ||
    trimName(input.merchantStoreName) ||
    DEFAULT_MOBILE_SHELL_BRAND
  );
}
