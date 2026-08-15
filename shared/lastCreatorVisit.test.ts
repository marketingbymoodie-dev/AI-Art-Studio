import { describe, expect, it } from "vitest";
import {
  creatorCheckoutRememberUrl,
  isSafeShopifyCheckoutNext,
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
});
