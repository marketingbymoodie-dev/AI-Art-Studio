/**
 * Dual-fetch Printify provider catalog variants.
 * - Default list = in-stock only (availability signal)
 * - show-out-of-stock=1 = full catalog for import/refresh/variantMap (incl. fully OOS colors)
 */

export type PrintifyCatalogVariantsDual = {
  /** Prefer this for sizes/colors/variantMap (full catalog when available). */
  variants: any[];
  /** Full JSON body used for variants (views, etc.). */
  payload: any;
  inStockVariantIds: number[];
  usedFullCatalog: boolean;
};

function extractVariants(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data?.variants)) return data.variants;
  if (Array.isArray(data)) return data;
  return [];
}

function extractIds(variants: any[]): number[] {
  const ids: number[] = [];
  for (const v of variants) {
    const id = Number(v?.id);
    if (Number.isFinite(id) && id > 0) ids.push(id);
  }
  return ids;
}

export function printifyProviderVariantsUrl(
  blueprintId: number | string,
  providerId: number | string,
  showOutOfStock: boolean,
): string {
  const qs = showOutOfStock ? "?show-out-of-stock=1" : "";
  return `https://api.printify.com/v1/catalog/blueprints/${blueprintId}/print_providers/${providerId}/variants.json${qs}`;
}

/**
 * Fetch full catalog (+ in-stock ids). Falls back to in-stock-only if the
 * show-out-of-stock request fails, so import/refresh still work.
 */
export async function fetchPrintifyProviderVariantsDual(
  blueprintId: number | string,
  providerId: number | string,
  apiToken: string,
  opts?: { fetchFn?: typeof fetch },
): Promise<PrintifyCatalogVariantsDual> {
  const fetchFn = opts?.fetchFn ?? fetch;
  const headers = { Authorization: `Bearer ${apiToken}` };

  const [inStockResp, allResp] = await Promise.all([
    fetchFn(printifyProviderVariantsUrl(blueprintId, providerId, false), { headers }),
    fetchFn(printifyProviderVariantsUrl(blueprintId, providerId, true), { headers }),
  ]);

  let inStockPayload: any = null;
  let inStockVariants: any[] = [];
  if (inStockResp.ok) {
    inStockPayload = await inStockResp.json();
    inStockVariants = extractVariants(inStockPayload);
  }
  const inStockVariantIds = extractIds(inStockVariants);

  if (allResp.ok) {
    const payload = await allResp.json();
    const variants = extractVariants(payload);
    if (variants.length > 0) {
      return {
        variants,
        payload,
        inStockVariantIds,
        usedFullCatalog: true,
      };
    }
  }

  if (inStockVariants.length > 0 && inStockPayload) {
    return {
      variants: inStockVariants,
      payload: inStockPayload,
      inStockVariantIds,
      usedFullCatalog: false,
    };
  }

  const status = !allResp.ok ? allResp.status : inStockResp.status;
  throw new Error(`Failed to fetch Printify catalog variants: ${status}`);
}
