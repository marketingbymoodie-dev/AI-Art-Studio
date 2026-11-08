import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
}));
vi.mock("./mockup-library-store", () => ({
  signedLibraryUrl: vi.fn(async () => "https://example.invalid/signed"),
}));

import {
  PET_PRINTIFY_RETRY_DELAYS_MS,
  nextPetRetryDelayMs,
  petFailureIsRetryable,
  planMyPetRetry,
} from "./my-pet-printify-retry";

describe("My Pet Printify retry", () => {
  it("waits 1m, 5m, 30m, then 2h, and stops after the fifth try", () => {
    expect(PET_PRINTIFY_RETRY_DELAYS_MS).toEqual([60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000]);
    expect(nextPetRetryDelayMs(1)).toBe(60_000);
    expect(nextPetRetryDelayMs(2)).toBe(5 * 60_000);
    expect(nextPetRetryDelayMs(3)).toBe(30 * 60_000);
    expect(nextPetRetryDelayMs(4)).toBe(2 * 60 * 60_000);
    expect(nextPetRetryDelayMs(5)).toBeNull();

    expect(planMyPetRetry(0, true)).toEqual({ status: "retrying", attempt: 1, delayMs: 60_000 });
    expect(planMyPetRetry(1, true)).toEqual({ status: "retrying", attempt: 2, delayMs: 5 * 60_000 });
    expect(planMyPetRetry(3, true)).toEqual({ status: "retrying", attempt: 4, delayMs: 2 * 60 * 60_000 });
    expect(planMyPetRetry(4, true)).toEqual({ status: "failed", attempt: 5, delayMs: null });
  });

  it("retries Printify and print-file failures, and stops on missing artwork or credentials", () => {
    expect(petFailureIsRetryable("Printify 502 on /shops/1/orders.json")).toBe(true);
    expect(petFailureIsRetryable("my-pet print file failed: upscaler timed out")).toBe(true);
    expect(petFailureIsRetryable("my-pet design job-1 has no stored edited artwork")).toBe(false);
    expect(petFailureIsRetryable("woodcut has no print path")).toBe(false);
    expect(petFailureIsRetryable("my-pet design job-1 has no productTypeId")).toBe(false);
    expect(petFailureIsRetryable("merchant for product type 54 missing Printify credentials")).toBe(false);
    expect(petFailureIsRetryable("tenant check failed: job shop does not match")).toBe(false);
    expect(planMyPetRetry(0, false)).toEqual({ status: "failed", attempt: 1, delayMs: null });
  });
});
