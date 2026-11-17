/**
 * Tests for the design-product cap resolver — the single reader that layers
 * owner bypass → per-shop override → plan tier. Pattern follows the owner
 * bypass tests in platformAdmin.test.ts (save + restore env var in each case).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canActivateDesignProductEffective,
  getEffectiveDesignProductLimit,
  getEffectivePlan,
} from "./customizer-plans";

describe("getEffectiveDesignProductLimit", () => {
  const originalOwner = process.env.OWNER_SHOP_DOMAIN;
  const originalBypass = process.env.OWNER_BYPASS_QUOTA;

  beforeEach(() => {
    delete process.env.OWNER_SHOP_DOMAIN;
    delete process.env.OWNER_BYPASS_QUOTA;
  });

  afterEach(() => {
    if (originalOwner === undefined) delete process.env.OWNER_SHOP_DOMAIN;
    else process.env.OWNER_SHOP_DOMAIN = originalOwner;
    if (originalBypass === undefined) delete process.env.OWNER_BYPASS_QUOTA;
    else process.env.OWNER_BYPASS_QUOTA = originalBypass;
  });

  it("falls back to plan tier when there's no override and the shop isn't an owner", () => {
    expect(
      getEffectiveDesignProductLimit({ planName: "starter" }, "random-merchant.myshopify.com"),
    ).toBe(1);
    expect(
      getEffectiveDesignProductLimit({ planName: "pro_plus" }, "random-merchant.myshopify.com"),
    ).toBe(30);
    expect(
      getEffectiveDesignProductLimit({ planName: null }, "random-merchant.myshopify.com"),
    ).toBe(0);
  });

  it("returns Infinity for the owner shop (owner bypass enabled by default)", () => {
    process.env.OWNER_SHOP_DOMAIN = "my-owner.myshopify.com";
    expect(
      getEffectiveDesignProductLimit({ planName: "trial" }, "my-owner.myshopify.com"),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it("built-in demo shop (aiartstudio-gizsmzs2) is treated as owner without env override", () => {
    expect(
      getEffectiveDesignProductLimit({ planName: "starter" }, "aiartstudio-gizsmzs2.myshopify.com"),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it("keeps the Petposterous shop unlimited when the env bypass is off", () => {
    process.env.OWNER_BYPASS_QUOTA = "false";
    expect(
      getEffectiveDesignProductLimit({ planName: "trial", designProductLimitOverride: 1 }, "h7epay-gh.myshopify.com"),
    ).toBe(Number.POSITIVE_INFINITY);
    expect(getEffectivePlan({ planName: "trial", planStatus: "trialing" }, "h7epay-gh.myshopify.com")).toMatchObject({
      planName: "pro_plus",
      planStatus: "active",
      displayName: "Pro Plus (Owner)",
      requiresPlan: false,
      pageLimit: Number.POSITIVE_INFINITY,
    });
  });

  it("keeps a normal merchant on the trial cap when the env bypass is off", () => {
    process.env.OWNER_BYPASS_QUOTA = "false";
    expect(
      getEffectivePlan({ planName: "trial", planStatus: "trialing" }, "other-merchant.myshopify.com").pageLimit,
    ).toBe(1);
  });

  it("falls back to plan when OWNER_BYPASS_QUOTA is disabled, even on owner shop", () => {
    process.env.OWNER_SHOP_DOMAIN = "my-owner.myshopify.com";
    process.env.OWNER_BYPASS_QUOTA = "false";
    expect(
      getEffectiveDesignProductLimit({ planName: "starter" }, "my-owner.myshopify.com"),
    ).toBe(1);
  });

  it("-1 override means unlimited for non-owner shops too", () => {
    expect(
      getEffectiveDesignProductLimit(
        { planName: "starter", designProductLimitOverride: -1 },
        "beta-tester.myshopify.com",
      ),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it("positive integer override sets an explicit per-shop cap", () => {
    expect(
      getEffectiveDesignProductLimit(
        { planName: "starter", designProductLimitOverride: 100 },
        "beta-tester.myshopify.com",
      ),
    ).toBe(100);
    expect(
      getEffectiveDesignProductLimit(
        { planName: "trial", designProductLimitOverride: 0 },
        "beta-tester.myshopify.com",
      ),
    ).toBe(0);
  });

  it("override of null falls back to plan", () => {
    expect(
      getEffectiveDesignProductLimit(
        { planName: "dabbler", designProductLimitOverride: null },
        "merchant.myshopify.com",
      ),
    ).toBe(5);
  });

  it("owner bypass wins over a lower per-shop override (safety for operator)", () => {
    process.env.OWNER_SHOP_DOMAIN = "my-owner.myshopify.com";
    expect(
      getEffectiveDesignProductLimit(
        { planName: "trial", designProductLimitOverride: 1 },
        "my-owner.myshopify.com",
      ),
    ).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("canActivateDesignProductEffective", () => {
  const originalOwner = process.env.OWNER_SHOP_DOMAIN;
  const originalBypass = process.env.OWNER_BYPASS_QUOTA;

  beforeEach(() => {
    delete process.env.OWNER_SHOP_DOMAIN;
    delete process.env.OWNER_BYPASS_QUOTA;
  });

  afterEach(() => {
    if (originalOwner === undefined) delete process.env.OWNER_SHOP_DOMAIN;
    else process.env.OWNER_SHOP_DOMAIN = originalOwner;
    if (originalBypass === undefined) delete process.env.OWNER_BYPASS_QUOTA;
    else process.env.OWNER_BYPASS_QUOTA = originalBypass;
  });

  it("blocks at the plan cap for normal shops", () => {
    expect(
      canActivateDesignProductEffective({ planName: "starter" }, "merchant.myshopify.com", 1),
    ).toEqual({ allowed: false, limit: 1, currentCount: 1 });
    expect(
      canActivateDesignProductEffective({ planName: "starter" }, "merchant.myshopify.com", 0),
    ).toEqual({ allowed: true, limit: 1, currentCount: 0 });
  });

  it("allows unlimited for owner shops regardless of currentActiveCount", () => {
    expect(
      canActivateDesignProductEffective(
        { planName: "trial" },
        "aiartstudio-gizsmzs2.myshopify.com",
        99999,
      ),
    ).toEqual({ allowed: true, limit: Number.POSITIVE_INFINITY, currentCount: 99999 });
  });

  it("allows unlimited for -1 override shops regardless of plan", () => {
    expect(
      canActivateDesignProductEffective(
        { planName: "trial", designProductLimitOverride: -1 },
        "internal.myshopify.com",
        500,
      ),
    ).toEqual({ allowed: true, limit: Number.POSITIVE_INFINITY, currentCount: 500 });
  });
});
