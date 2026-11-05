import { describe, expect, it } from "vitest";
import { vendorRetryDelayMs, VENDOR_RETRY_BACKOFF_MS } from "./vendorBackoff";

describe("vendor backoff", () => {
  it("waits on 429 and Shopify throttle, and stops after the last attempt", () => {
    expect(vendorRetryDelayMs(429, null, 0)).toBe(VENDOR_RETRY_BACKOFF_MS[0]);
    expect(vendorRetryDelayMs(200, null, 0, true)).toBe(VENDOR_RETRY_BACKOFF_MS[0]);
    expect(vendorRetryDelayMs(503, null, 1)).toBe(VENDOR_RETRY_BACKOFF_MS[1]);
    expect(vendorRetryDelayMs(429, "7", 0)).toBe(7_000);
    expect(vendorRetryDelayMs(429, "9999", 0)).toBe(120_000);
    expect(vendorRetryDelayMs(400, null, 0)).toBeNull();
    expect(vendorRetryDelayMs(429, null, VENDOR_RETRY_BACKOFF_MS.length)).toBeNull();
  });
});
