import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CREATOR_CHECKOUT_WEBHOOKS,
  canRegisterCreatorCheckoutWebhookOrigin,
  creatorCheckoutWebhookAddress,
  creatorCheckoutWebhookOrigin,
  ensureCreatorCheckoutWebhooks,
  webhookAlreadyRegistered,
} from "./creator-checkout-webhooks";

const PREV = {
  CREATOR_MARKETPLACE_ENABLED: process.env.CREATOR_MARKETPLACE_ENABLED,
  CREATOR_PLATFORM_SHOP_DOMAIN: process.env.CREATOR_PLATFORM_SHOP_DOMAIN,
  APP_URL: process.env.APP_URL,
  PUBLIC_APP_URL: process.env.PUBLIC_APP_URL,
};

afterEach(() => {
  for (const [k, v] of Object.entries(PREV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.unstubAllGlobals();
});

describe("creator checkout webhook helpers", () => {
  it("covers pack grant / clawback / uninstall paths", () => {
    expect(CREATOR_CHECKOUT_WEBHOOKS.map((w) => w.topic)).toEqual([
      "orders/paid",
      "refunds/create",
      "orders/cancelled",
      "app/uninstalled",
    ]);
  });

  it("builds HTTPS addresses from the app origin", () => {
    expect(
      creatorCheckoutWebhookAddress(
        "https://appai-pod-production.up.railway.app/",
        "/shopify/webhooks/orders-paid",
      ),
    ).toBe("https://appai-pod-production.up.railway.app/shopify/webhooks/orders-paid");
  });

  it("rejects staging and localhost origins so the live shop is not rewritten", () => {
    expect(canRegisterCreatorCheckoutWebhookOrigin("https://appai-pod-production.up.railway.app")).toBe(true);
    expect(canRegisterCreatorCheckoutWebhookOrigin("https://ai-art-studio-staging.up.railway.app")).toBe(false);
    expect(canRegisterCreatorCheckoutWebhookOrigin("http://localhost:5000")).toBe(false);
    expect(creatorCheckoutWebhookOrigin({ APP_URL: "https://x.example/" } as NodeJS.ProcessEnv)).toBe(
      "https://x.example",
    );
  });

  it("treats the same path as already subscribed even with a trailing slash", () => {
    expect(
      webhookAlreadyRegistered(
        [{ topic: "orders/paid", address: "https://app.example/shopify/webhooks/orders-paid/" }],
        "orders/paid",
        "https://app.example/shopify/webhooks/orders-paid",
      ),
    ).toBe(true);
    expect(
      webhookAlreadyRegistered(
        [{ topic: "orders/paid", address: "https://other.example/shopify/webhooks/orders-paid" }],
        "orders/paid",
        "https://app.example/shopify/webhooks/orders-paid",
      ),
    ).toBe(false);
  });
});

describe("ensureCreatorCheckoutWebhooks", () => {
  it("does not call Shopify for a merchant shop", async () => {
    process.env.CREATOR_MARKETPLACE_ENABLED = "true";
    process.env.CREATOR_PLATFORM_SHOP_DOMAIN = "whi6jd-nv.myshopify.com";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await ensureCreatorCheckoutWebhooks({
      shop: "some-merchant.myshopify.com",
      accessToken: "tok",
      origin: "https://appai-pod-production.up.railway.app",
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("not_platform_shop");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates missing topics and skips ones already pointed at this origin", async () => {
    process.env.CREATOR_MARKETPLACE_ENABLED = "true";
    process.env.CREATOR_PLATFORM_SHOP_DOMAIN = "whi6jd-nv.myshopify.com";
    const origin = "https://appai-pod-production.up.railway.app";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!init?.method || init.method === "GET") {
        return new Response(
          JSON.stringify({
            webhooks: [
              {
                topic: "orders/paid",
                address: `${origin}/shopify/webhooks/orders-paid`,
              },
            ],
          }),
          { status: 200 },
        );
      }
      expect(url).toContain("/webhooks.json");
      return new Response(JSON.stringify({ webhook: {} }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await ensureCreatorCheckoutWebhooks({
      shop: "whi6jd-nv.myshopify.com",
      accessToken: "tok",
      origin,
    });
    expect(result.ok).toBe(true);
    expect(result.existing).toEqual(["orders/paid"]);
    expect(result.created).toEqual(["refunds/create", "orders/cancelled", "app/uninstalled"]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
