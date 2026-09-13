import { describe, expect, it } from "vitest";
import {
  ATC_SHADOW_STILL_PREPARING,
  ATC_STOREFRONT_PROPAGATION_WAITS_MS,
} from "./atcStorefrontRetry";

describe("ATC storefront propagation retry", () => {
  it("waits long enough for Admin → Ajax replica lag", () => {
    const sum = ATC_STOREFRONT_PROPAGATION_WAITS_MS.reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThanOrEqual(30_000);
    expect(ATC_STOREFRONT_PROPAGATION_WAITS_MS.length).toBeGreaterThanOrEqual(8);
  });

  it("asks the shopper to wait and retry, not refresh", () => {
    expect(ATC_SHADOW_STILL_PREPARING).toMatch(/still being prepared/i);
    expect(ATC_SHADOW_STILL_PREPARING).not.toMatch(/isn't listed/i);
    expect(ATC_SHADOW_STILL_PREPARING).not.toMatch(/refresh/i);
  });
});
