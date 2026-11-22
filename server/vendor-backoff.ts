/**
 * Shared spacing for catalogue promote.
 * Printify's general cap is 600/minute. Product creates sit under the tighter
 * publishing cap. Shopify is cost-based and answers 429 / THROTTLED when full.
 */
import { vendorRetryDelayMs } from "@shared/vendorBackoff";

export { vendorRetryDelayMs };

const GAP_MS = {
  printify: 1_000,
  "printify-product": 8_000,
  shopify: 500,
} as const;

type Lane = keyof typeof GAP_MS;

const nextAt: Record<Lane, number> = { printify: 0, "printify-product": 0, shopify: 0 };
const chains: Record<Lane, Promise<void>> = {
  printify: Promise.resolve(),
  "printify-product": Promise.resolve(),
  shopify: Promise.resolve(),
};

export function paceVendor(lane: Lane): Promise<void> {
  const run = chains[lane].then(async () => {
    const now = Date.now();
    const at = Math.max(now, nextAt[lane]);
    nextAt[lane] = at + GAP_MS[lane];
    if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
  });
  chains[lane] = run.then(() => undefined, () => undefined);
  return run;
}

type ShopifyGraphqlError = { message?: string; extensions?: { code?: string } };

/** Shopify sometimes returns `errors` as a string or one object, not a list. */
export function shopifyGraphqlErrors(body: { errors?: unknown } | null | undefined): ShopifyGraphqlError[] {
  const errors = body?.errors;
  if (!errors) return [];
  if (Array.isArray(errors)) return errors;
  if (typeof errors === "string") return [{ message: errors }];
  if (typeof errors === "object") return [errors as ShopifyGraphqlError];
  return [];
}

export function shopifyThrottled(body: { errors?: unknown } | null | undefined): boolean {
  return shopifyGraphqlErrors(body).some((err) =>
    err?.extensions?.code === "THROTTLED" || /throttl/i.test(String(err?.message || "")),
  );
}
