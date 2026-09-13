import { describe, expect, it } from "vitest";
import {
  ATC_MAX_CART_ADD_CALLS_PER_TAP,
  ATC_RETRY_AFTER_DEFAULT_MS,
  ATC_RETRY_AFTER_MAX_MS,
  ATC_RETRY_AFTER_MIN_MS,
  ATC_SHADOW_PREVIEW_NOT_READY,
  ATC_SHADOW_STILL_PREPARING,
  ATC_STOREFRONT_PROPAGATION_WAITS_MS,
  atcCustomerSafeError,
  classifyCartAddFailure,
  parseRetryAfterMs,
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

  it("splits preview-not-ready copy from replica-lag copy", () => {
    expect(ATC_SHADOW_PREVIEW_NOT_READY).toMatch(/preview is still uploading/i);
    expect(ATC_SHADOW_PREVIEW_NOT_READY).not.toMatch(/still being prepared/i);
    expect(atcCustomerSafeError("Preview is still uploading.")).toBe(
      ATC_SHADOW_PREVIEW_NOT_READY,
    );
    expect(atcCustomerSafeError("Cart add failed: HTTP 429")).toBe(
      ATC_SHADOW_STILL_PREPARING,
    );
    expect(atcCustomerSafeError("HTTP 500")).toBe(ATC_SHADOW_STILL_PREPARING);
  });

  it("caps cart/add.js calls per tap", () => {
    expect(ATC_MAX_CART_ADD_CALLS_PER_TAP).toBe(10);
    expect(ATC_STOREFRONT_PROPAGATION_WAITS_MS.length + 1).toBe(
      ATC_MAX_CART_ADD_CALLS_PER_TAP,
    );
  });
});

describe("parseRetryAfterMs", () => {
  it("reads delta-seconds and clamps to 1–30s", () => {
    expect(parseRetryAfterMs("8")).toBe(8_000);
    expect(parseRetryAfterMs("0")).toBe(ATC_RETRY_AFTER_MIN_MS);
    expect(parseRetryAfterMs("120")).toBe(ATC_RETRY_AFTER_MAX_MS);
    expect(parseRetryAfterMs("")).toBe(ATC_RETRY_AFTER_DEFAULT_MS);
    expect(parseRetryAfterMs("nope")).toBe(ATC_RETRY_AFTER_DEFAULT_MS);
  });

  it("reads HTTP-date headers", () => {
    const when = new Date(Date.now() + 12_000).toUTCString();
    const ms = parseRetryAfterMs(when);
    expect(ms).toBeGreaterThanOrEqual(10_000);
    expect(ms).toBeLessThanOrEqual(14_000);
  });
});

describe("classifyCartAddFailure", () => {
  it("skips the next /cart.js only after a clean 422 not-found", () => {
    expect(
      classifyCartAddFailure({
        status: 422,
        message: "Cannot find the variant",
      }),
    ).toEqual({
      kind: "not_found",
      retryable: true,
      skipCartJsOnNext: true,
    });
  });

  it("re-runs /cart.js after 429, timeout, network, 5xx, or sold-out", () => {
    const mustDedup: Array<Parameters<typeof classifyCartAddFailure>[0]> = [
      { status: 429, message: "Too many requests" },
      { timeout: true },
      { networkError: true },
      { status: 503, message: "unavailable" },
      { status: 422, message: "This product is sold out" },
    ];
    for (const input of mustDedup) {
      const c = classifyCartAddFailure(input);
      expect(c.retryable).toBe(true);
      expect(c.skipCartJsOnNext).toBe(false);
    }
  });

  it("does not retry unknown 4xx but never leaks a raw status to the shopper", () => {
    const c = classifyCartAddFailure({ status: 400, message: "bad request" });
    expect(c.kind).toBe("fatal");
    expect(c.retryable).toBe(false);
    expect(atcCustomerSafeError("Cart add failed: HTTP 400")).toBe(
      ATC_SHADOW_STILL_PREPARING,
    );
  });
});
