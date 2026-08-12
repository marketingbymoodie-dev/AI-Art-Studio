import { describe, expect, it } from "vitest";
import { isCreatorPlatformShop, sanitizeCreatorForAdmin } from "./creator-host";

describe("creator-host Phase 10 helpers", () => {
  it("sanitizeCreatorForAdmin strips OTP fields", () => {
    const row = {
      id: "c1",
      username: "max",
      otpCode: "123456",
      otpExpiresAt: new Date(),
      email: "a@b.com",
    };
    const out = sanitizeCreatorForAdmin(row as any);
    expect((out as any).otpCode).toBeUndefined();
    expect((out as any).otpExpiresAt).toBeUndefined();
    expect(out.username).toBe("max");
    expect(out.email).toBe("a@b.com");
  });

  it("isCreatorPlatformShop compares normalized domains", () => {
    const prev = process.env.CREATOR_PLATFORM_SHOP_DOMAIN;
    process.env.CREATOR_PLATFORM_SHOP_DOMAIN = "ai-art-studio-staging.myshopify.com";
    expect(isCreatorPlatformShop("ai-art-studio-staging.myshopify.com")).toBe(true);
    expect(isCreatorPlatformShop("https://ai-art-studio-staging.myshopify.com/")).toBe(true);
    expect(isCreatorPlatformShop("other.myshopify.com")).toBe(false);
    if (prev === undefined) delete process.env.CREATOR_PLATFORM_SHOP_DOMAIN;
    else process.env.CREATOR_PLATFORM_SHOP_DOMAIN = prev;
  });
});
