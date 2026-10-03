export type BindingProductType = {
  productTypeId: number;
  title: string;
  /** Shopify base product id; null when the type was never sent to Shopify. */
  productId: string | null;
  printifyBlueprintId?: number | null;
  printifyProviderId?: number | null;
};

export type BindingPage = { handle: string; productTypeId: number | null };

export type DivergentProductType = {
  productTypeId: number;
  title: string;
  providerId: number | null;
  pageHandles: string[];
};

function providerText(providerId: number | null | undefined): string {
  return providerId != null ? `Printify provider ${providerId}` : "no Printify provider";
}

/** "pt 30 — Men's Lightweight Fashion Tee, Printify provider 99" */
export function describeProductTypeBinding(pt: {
  productTypeId: number;
  title: string;
  providerId: number | null | undefined;
}): string {
  return `pt ${pt.productTypeId} — ${pt.title}, ${providerText(pt.providerId)}`;
}

/**
 * Other product types for the same Printify blueprint that the merchant has
 * already set up (a customizer page or a Shopify product). Binding a new page
 * to a different type is allowed, but its variants, prices and Shopify product
 * are separate — so it must never happen silently.
 */
export function findDivergentProductTypes(
  boundProductTypeId: number,
  blueprintId: number | null | undefined,
  productTypes: BindingProductType[],
  pages: BindingPage[],
): DivergentProductType[] {
  if (blueprintId == null) return [];
  return productTypes
    .filter((pt) => pt.productTypeId !== boundProductTypeId && pt.printifyBlueprintId === blueprintId)
    .map((pt) => ({
      productTypeId: pt.productTypeId,
      title: pt.title,
      providerId: pt.printifyProviderId ?? null,
      pageHandles: pages.filter((p) => p.productTypeId === pt.productTypeId).map((p) => p.handle),
      onShopify: !!pt.productId,
    }))
    .filter((pt) => pt.pageHandles.length > 0 || pt.onShopify)
    .map(({ onShopify: _onShopify, ...rest }) => rest);
}

export function describeDivergence(
  bound: { productTypeId: number },
  other: DivergentProductType,
): string {
  const where = other.pageHandles.length
    ? `used by ${other.pageHandles.map((h) => `/pages/${h}`).join(", ")}`
    : "already on Shopify";
  return (
    `pt ${other.productTypeId} — ${other.title}, ${providerText(other.providerId)} is also set up for this product (${where}). ` +
    `This page binds to pt ${bound.productTypeId} instead, with its own variants, prices and Shopify product.`
  );
}
