import { describe, expect, it } from "vitest";
import {
  formatStorefrontCreditsSplit,
  pickStorefrontGenerationSpend,
  storefrontArtworksRemaining,
  storefrontCreditBreakdown,
  storefrontShopFreeRemaining,
} from "./storefront-credits";

describe("storefront credit split + spend order", () => {
  it("uses this shop's free gens before paid credits", () => {
    expect(pickStorefrontGenerationSpend({ shopFreeRemaining: 2, paidCredits: 10 })).toBe(
      "customer_free",
    );
    expect(pickStorefrontGenerationSpend({ shopFreeRemaining: 0, paidCredits: 10 })).toBe(
      "customer_paid",
    );
    expect(pickStorefrontGenerationSpend({ shopFreeRemaining: 0, paidCredits: 0 })).toBe(
      "exhausted",
    );
  });

  it("splits shop free, shop rewards, and packs", () => {
    const b = storefrontCreditBreakdown({
      shopFreeRemaining: 2,
      earnedCredits: 3,
      packCredits: 10,
      paidCredits: 13,
    });
    expect(b).toEqual({
      shopFreeRemaining: 2,
      shopEarned: 3,
      pack: 10,
      paidTotal: 13,
      total: 15,
    });
    expect(formatStorefrontCreditsSplit(b)).toBe(
      "2 free on this shop · 3 shop rewards · 10 pack remaining",
    );
  });

  it("treats unbucketed paid credits as shop rewards", () => {
    const b = storefrontCreditBreakdown({
      freeGenerationsUsed: 0,
      freeGenerationLimit: 2,
      paidCredits: 4,
    });
    expect(b.shopFreeRemaining).toBe(2);
    expect(b.shopEarned).toBe(4);
    expect(b.pack).toBe(0);
    expect(b.total).toBe(6);
  });

  it("allows a creator shop with zero free gens", () => {
    expect(
      storefrontShopFreeRemaining({
        freeGenerationsUsed: 0,
        freeGenerationLimit: 0,
      }),
    ).toBe(0);
    expect(
      storefrontArtworksRemaining({
        shopFreeRemaining: 0,
        paidCredits: 5,
      }),
    ).toBe(5);
  });
});
