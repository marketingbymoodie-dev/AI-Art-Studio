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

/** Waits before the 2nd, 3rd, and 4th attempt after a Printify 429. */
export const PRINTIFY_429_BACKOFF_MS = [1500, 3000, 6000];

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Catalog GET with 429 backoff. A non-429 response is returned as-is,
 * including other errors, so the caller can mark that product failed.
 */
export async function fetchPrintifyCatalog(
  url: string,
  apiToken: string,
  opts?: { fetchFn?: typeof fetch; sleep?: (ms: number) => Promise<void> },
): Promise<Response> {
  const fetchFn = opts?.fetchFn ?? fetch;
  const sleep = opts?.sleep ?? defaultSleep;
  const headers = { Authorization: `Bearer ${apiToken}` };
  let last: Response | null = null;
  for (let attempt = 0; attempt <= PRINTIFY_429_BACKOFF_MS.length; attempt++) {
    const res = await fetchFn(url, { headers });
    if (res.status !== 429) return res;
    last = res;
    const wait = PRINTIFY_429_BACKOFF_MS[attempt];
    if (wait == null) break;
    await sleep(wait);
  }
  return last as Response;
}

/**
 * Fetch full catalog (+ in-stock ids). Falls back to in-stock-only if the
 * show-out-of-stock request fails, so import/refresh still work.
 */
export async function fetchPrintifyProviderVariantsDual(
  blueprintId: number | string,
  providerId: number | string,
  apiToken: string,
  opts?: { fetchFn?: typeof fetch; sleep?: (ms: number) => Promise<void> },
): Promise<PrintifyCatalogVariantsDual> {
  const fetchFn = opts?.fetchFn ?? fetch;
  const sleep = opts?.sleep;

  const [inStockResp, allResp] = await Promise.all([
    fetchPrintifyCatalog(printifyProviderVariantsUrl(blueprintId, providerId, false), apiToken, { fetchFn, sleep }),
    fetchPrintifyCatalog(printifyProviderVariantsUrl(blueprintId, providerId, true), apiToken, { fetchFn, sleep }),
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
