/**
 * Softstyle catalogue prices. Studio preview and promote both read these
 * through shippingPricesBySize, so a size change lands in both places.
 * 3XL matches 2XL.
 */
export const SOFTSTYLE_CATALOGUE_PRICES: Readonly<Record<string, { price: string; compareAtPrice: string }>> = {
  XS: { price: "29.95", compareAtPrice: "34.95" },
  S: { price: "29.95", compareAtPrice: "34.95" },
  M: { price: "29.95", compareAtPrice: "34.95" },
  L: { price: "29.95", compareAtPrice: "34.95" },
  XL: { price: "29.95", compareAtPrice: "34.95" },
  "2XL": { price: "33.95", compareAtPrice: "39.50" },
  "3XL": { price: "33.95", compareAtPrice: "39.50" },
};

export function applySoftstyleCataloguePrices(discovered: Record<string, string>): {
  pricesBySize: Record<string, string>;
  compareAtBySize: Record<string, string>;
} {
  const pricesBySize: Record<string, string> = { ...discovered };
  const compareAtBySize: Record<string, string> = {};
  for (const size of Object.keys(pricesBySize)) {
    const row = SOFTSTYLE_CATALOGUE_PRICES[size];
    if (!row) continue;
    pricesBySize[size] = row.price;
    compareAtBySize[size] = row.compareAtPrice;
  }
  return { pricesBySize, compareAtBySize };
}
