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

export function shopifyThrottled(body: { errors?: Array<{ message?: string; extensions?: { code?: string } }> }): boolean {
  return (body.errors || []).some((err) =>
    err?.extensions?.code === "THROTTLED" || /throttl/i.test(String(err?.message || "")),
  );
}
