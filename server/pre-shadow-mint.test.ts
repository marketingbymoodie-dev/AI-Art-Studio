import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PRE_SHADOW_AWAIT_MS,
  PRE_SHADOW_FLIGHT_MAX_AGE_MS,
  awaitExistingFlight,
  awaitInFlightOrGenerate,
  getPreShadowInFlight,
  preShadowFlightKey,
  registerPreShadowInFlight,
} from "./pre-shadow-mint";
import {
  RESOLVE_DESIGN_VARIANT_DEADLINE_MS,
  RESOLVE_FLIGHT_JOIN_MS,
} from "@shared/atcStorefrontRetry";

describe("preShadowFlightKey", () => {
  it("keys shop + persist designId so 16x16 cannot satisfy 20x20", () => {
    const job = "job1";
    const a = preShadowFlightKey("shop.myshopify.com", `${job}::111::hashA`);
    const b = preShadowFlightKey("shop.myshopify.com", `${job}::222::hashA`);
    expect(a).not.toBe(b);
  });
});

describe("awaitInFlightOrGenerate", () => {
  it("joins the exact key and does not call generate twice", async () => {
    const key = "shop::job::vid::cfg";
    let runs = 0;
    const generate = () => {
      runs += 1;
      return new Promise<{ shopifyProductId: string; shopifyVariantId: string }>((resolve) => {
        setTimeout(() => resolve({ shopifyProductId: "p", shopifyVariantId: "v" }), 40);
      });
    };
    const [first, second] = await Promise.all([
      awaitInFlightOrGenerate(key, generate, 5_000),
      awaitInFlightOrGenerate(key, generate, 5_000),
    ]);
    expect(runs).toBe(1);
    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
  });

  it("times out without cancelling the in-flight mint", async () => {
    const key = "shop::job::vid::slow";
    let finished = false;
    const generate = () =>
      new Promise<{ shopifyProductId: string; shopifyVariantId: string }>((resolve) => {
        setTimeout(() => {
          finished = true;
          resolve({ shopifyProductId: "p", shopifyVariantId: "v" });
        }, 80);
      });
    const timed = await awaitInFlightOrGenerate(key, generate, 20);
    expect(timed.status).toBe("timeout");
    expect(finished).toBe(false);
    const joined = await awaitInFlightOrGenerate(key, generate, 5_000);
    expect(joined.status).toBe("ok");
    expect(finished).toBe(true);
  });

  it("PRE_SHADOW_AWAIT_MS is 30s", () => {
    expect(PRE_SHADOW_AWAIT_MS).toBe(30_000);
  });
});

describe("in-flight eviction", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("evicts a mint that never settles so later resolves stop joining it", async () => {
    vi.useFakeTimers();
    const key = "shop::job::vid::hung";
    const never = new Promise<void>(() => {});
    expect(registerPreShadowInFlight(key, never)).toBe(true);
    expect(getPreShadowInFlight(key)).toBe(never);
    vi.advanceTimersByTime(PRE_SHADOW_FLIGHT_MAX_AGE_MS + 1);
    expect(getPreShadowInFlight(key)).toBeUndefined();
    expect(await awaitExistingFlight(key, 10)).toBe("none");
  });
});

describe("resolve deadline budget", () => {
  it("answers before the storefront's 30s abort and joins flights inside that", () => {
    expect(RESOLVE_DESIGN_VARIANT_DEADLINE_MS).toBeLessThan(30_000);
    expect(RESOLVE_FLIGHT_JOIN_MS).toBeLessThan(RESOLVE_DESIGN_VARIANT_DEADLINE_MS);
  });
});
