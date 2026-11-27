/**
 * Warm Shopify's resized product images before a customer asks for them.
 * The Petposterous theme (main theme, product gallery, cards, and colour
 * swatches) requests these widths:
 *   120 thumbnail — sections/product-information.liquid
 *   240, 352, 832, 1200 — snippets/product-media-gallery-content.liquid
 *   3840 — snippets/product-media.liquid high-res src
 *   1024 — gallery image_url
 *   500 — snippets/product-card.liquid
 *   600 — snippets/card-colour-swatches.liquid
 *   480, 640, 700, 1600, 1920 — sections/bmp-curated-product-card.liquid
 * A first request can come back as an empty 502 until the resizer has made
 * that size; a later request is cached.
 */
export const CATALOGUE_IMAGE_WIDTHS = [
  120, 240, 352, 480, 500, 600, 640, 700, 832, 1024, 1200, 1600, 1920, 3840,
] as const;

const BACKOFF_MS = [300, 600, 1200, 2000];

export function resizedImageUrl(raw: string, width: number): string {
  const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
  url.searchParams.set("width", String(width));
  return url.toString();
}

export async function warmCatalogueImageUrls(
  urls: string[],
  opts: {
    widths?: readonly number[];
    maxTries?: number;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<{ warmed: number; failed: Array<{ url: string; width: number; status: number }> }> {
  const widths = opts.widths ?? CATALOGUE_IMAGE_WIDTHS;
  const maxTries = opts.maxTries ?? 5;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const unique = [...new Set(urls.map((url) => String(url || "").trim()).filter(Boolean))];
  const failed: Array<{ url: string; width: number; status: number }> = [];
  let warmed = 0;
  for (const url of unique) {
    for (const width of widths) {
      const sized = resizedImageUrl(url, width);
      let status = 0;
      for (let attempt = 0; attempt < maxTries; attempt++) {
        try {
          const res = await fetchImpl(sized, { method: "GET", redirect: "follow" });
          status = res.status;
          await res.arrayBuffer().catch(() => undefined);
        } catch {
          status = 0;
        }
        if (status === 200) break;
        if (attempt < maxTries - 1) await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
      }
      if (status === 200) warmed += 1;
      else failed.push({ url: sized, width, status });
    }
  }
  return { warmed, failed };
}
