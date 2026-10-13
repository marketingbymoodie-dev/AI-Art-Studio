import { describe, expect, it } from "vitest";
import {
  canRegisterCarrierService,
  carrierRegistrationSkipReason,
  parseCarrierRateRequest,
} from "./printify-checkout-shipping";

describe("parseCarrierRateRequest", () => {
  it("reads destination country, currency, and items from Shopify rate payload", () => {
    expect(
      parseCarrierRateRequest({
        rate: {
          destination: { country: "DE" },
          currency: "aud",
          items: [{ sku: "tee", quantity: 1, variant_id: 11 }],
        },
      }),
    ).toEqual({
      destinationCountry: "DE",
      currency: "AUD",
      items: [{ sku: "tee", quantity: 1, variant_id: 11 }],
    });
  });

  it("defaults empty items when Shopify sends no cart lines", () => {
    expect(parseCarrierRateRequest({ rate: { destination: { country_code: "US" } } })).toEqual({
      destinationCountry: "US",
      currency: "USD",
      items: [],
    });
  });
});

describe("canRegisterCarrierService", () => {
  it("allows https production hosts", () => {
    expect(canRegisterCarrierService("https://appai-pod-production.up.railway.app", "demo.myshopify.com")).toBe(
      true,
    );
  });

  it("blocks localhost and staging callbacks on the live creator shop only", () => {
    const prev = process.env.CREATOR_PLATFORM_SHOP_DOMAIN;
    process.env.CREATOR_PLATFORM_SHOP_DOMAIN = "staging-demo.myshopify.com";
    expect(canRegisterCarrierService("http://localhost:5000", "demo.myshopify.com")).toBe(false);
    expect(
      canRegisterCarrierService(
        "https://ai-art-studio-staging.up.railway.app",
        "whi6jd-nv.myshopify.com",
      ),
    ).toBe(false);
    expect(
      canRegisterCarrierService(
        "https://ai-art-studio-staging.up.railway.app",
        "aiartstudio-creators.myshopify.com",
      ),
    ).toBe(false);
    expect(
      canRegisterCarrierService(
        "https://ai-art-studio-staging.up.railway.app",
        "staging-demo.myshopify.com",
      ),
    ).toBe(true);
    expect(
      canRegisterCarrierService(
        "https://ai-art-studio-staging.up.railway.app",
        "demo.myshopify.com",
      ),
    ).toBe(true);
    const liveSkip = carrierRegistrationSkipReason(
      "https://ai-art-studio-staging.up.railway.app",
      "whi6jd-nv.myshopify.com",
    );
    expect(liveSkip).toContain("intentional skip");
    expect(liveSkip).toContain("ai-art-studio-staging.up.railway.app");
    expect(liveSkip).toContain("whi6jd-nv.myshopify.com");
    const localSkip = carrierRegistrationSkipReason("http://localhost:5000", "demo.myshopify.com");
    expect(localSkip).toContain("intentional skip");
    expect(localSkip).toContain("localhost");
    expect(localSkip).toContain("demo.myshopify.com");
    if (prev === undefined) delete process.env.CREATOR_PLATFORM_SHOP_DOMAIN;
    else process.env.CREATOR_PLATFORM_SHOP_DOMAIN = prev;
  });
});
