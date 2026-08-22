import { describe, expect, it } from "vitest";
import { creatorIdFromRewardGrantShop, rewardGrantShopScope } from "./creator-earned";

describe("creator shop reward scope", () => {
  it("scopes earned grants to the creator shop, not the shared checkout shop", () => {
    expect(rewardGrantShopScope("whi6jd-nv.myshopify.com", "creator-a")).toBe("creator:creator-a");
    expect(rewardGrantShopScope("whi6jd-nv.myshopify.com", null)).toBe("whi6jd-nv.myshopify.com");
    expect(creatorIdFromRewardGrantShop("creator:abc")).toBe("abc");
    expect(creatorIdFromRewardGrantShop("whi6jd-nv.myshopify.com")).toBeNull();
  });
});
