import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAuthorizedShopCache,
  forgetAuthorizedShop,
  rememberAuthorizedShop,
  takeAuthorizedShop,
} from "./authorized-shop-cache";

const shop = "demo.myshopify.com";

function installation(expiresInMs: number | null) {
  return {
    id: 7,
    shopDomain: shop,
    status: "active",
    accessToken: "shpat_live",
    refreshToken: "shprt_live",
    accessTokenExpiresAt: expiresInMs == null ? null : new Date(Date.now() + expiresInMs),
  };
}

afterEach(() => {
  clearAuthorizedShopCache();
  vi.useRealTimers();
});

describe("authorized shop cache", () => {
  it("misses until a shop token is stored", () => {
    expect(takeAuthorizedShop(shop)).toBeNull();
  });

  it("returns a copy of the shop and token on hit", () => {
    rememberAuthorizedShop(shop, installation(60 * 60 * 1000), "shpat_live");
    const hit = takeAuthorizedShop("demo");
    expect(hit?.accessToken).toBe("shpat_live");
    expect(hit?.installation.refreshToken).toBe("shprt_live");
    hit!.installation.accessToken = "mutated";
    expect(takeAuthorizedShop(shop)?.accessToken).toBe("shpat_live");
  });

  it("misses after the 5 minute TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T00:00:00Z"));
    rememberAuthorizedShop(shop, installation(60 * 60 * 1000), "shpat_live");
    vi.setSystemTime(new Date("2026-11-10T00:05:01Z"));
    expect(takeAuthorizedShop(shop)).toBeNull();
  });

  it("does not store a token inside the refresh skew", () => {
    rememberAuthorizedShop(shop, installation(60 * 1000), "shpat_live");
    expect(takeAuthorizedShop(shop)).toBeNull();
  });

  it("drops the shop when forgotten", () => {
    rememberAuthorizedShop(shop, installation(60 * 60 * 1000), "shpat_live");
    forgetAuthorizedShop("demo");
    expect(takeAuthorizedShop(shop)).toBeNull();
  });
});
