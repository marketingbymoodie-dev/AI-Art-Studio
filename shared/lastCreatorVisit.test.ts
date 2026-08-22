import { describe, expect, it } from "vitest";
import {
  creatorCheckoutRememberUrl,
  creatorShopPath,
  isHandleLikeShopName,
  isSafeShopifyCheckoutNext,
  parseCreatorShopVisits,
  parseLastCreatorVisit,
  serializeLastCreatorVisit,
} from "./lastCreatorVisit";

describe("lastCreatorVisit", () => {
  it("round-trips a safe visit", () => {
    const raw = serializeLastCreatorVisit({
      username: "madclowncore",
      shopName: "Mad Clown Core",
      returnUrl: "https://ai-art-studio-staging.up.railway.app/c/madclowncore",
      visitedAt: 1,
    });
    const parsed = parseLastCreatorVisit(raw);
    expect(parsed?.username).toBe("madclowncore");
    expect(parsed?.shopName).toBe("Mad Clown Core");
    expect(parsed?.returnUrl).toContain("/c/madclowncore");
  });

  it("treats a handle-only label as not a public shop name", () => {
    expect(isHandleLikeShopName("bigmeltingpod", "bigmeltingpod")).toBe(true);
    expect(isHandleLikeShopName("mad-clown-core", "madclowncore")).toBe(true);
    expect(isHandleLikeShopName("Mad Clown Core", "madclowncore")).toBe(false);
  });

  it("rejects a stranger return URL", () => {
    expect(
      parseLastCreatorVisit({
        username: "max",
        shopName: "Max",
        returnUrl: "https://evil.com/c/max",
        visitedAt: 1,
      }),
    ).toBeNull();
  });

  it("builds a same-origin remember bounce", () => {
    const checkout =
      "https://ai-art-studio-staging.myshopify.com/checkouts/cn/abc";
    const bounce = creatorCheckoutRememberUrl({
      checkoutUrl: checkout,
      username: "madclowncore",
      shopName: "Mad Clown Core",
      returnUrl: "https://ai-art-studio-staging.up.railway.app/c/madclowncore",
    });
    expect(bounce).toContain("/apps/appai/remember-creator");
    expect(bounce).toContain("next=");
    expect(
      isSafeShopifyCheckoutNext(checkout, "ai-art-studio-staging.myshopify.com"),
    ).toBe(true);
    expect(isSafeShopifyCheckoutNext("https://evil.com/checkouts/x", "ai-art-studio-staging.myshopify.com")).toBe(
      false,
    );
  });

  it("keeps a unique newest-first shop list and drops the current shop", () => {
    const a = {
      username: "alice",
      shopName: "Alice Shop",
      returnUrl: "https://aiartstudio.app/c/alice",
      visitedAt: 20,
    };
    const b = {
      username: "bob",
      shopName: "Bob Shop",
      returnUrl: "https://aiartstudio.app/c/bob",
      visitedAt: 10,
    };
    const listed = parseCreatorShopVisits([b, a, { ...a, visitedAt: 5 }]);
    expect(listed.map((v) => v.username)).toEqual(["alice", "bob"]);
    expect(creatorShopPath("bob")).toBe("/c/bob");
  });
});
