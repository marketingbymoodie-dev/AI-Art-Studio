import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ShadowVariantNotPurchasableError,
  ensureShadowVariantPurchasable,
} from "./shadow-variant-purchasable";

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseBody(init?: RequestInit): { query: string; variables: any } {
  return JSON.parse(String(init?.body || "{}"));
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ensureShadowVariantPurchasable", () => {
  it("writes inventoryPolicy CONTINUE even when the variant is already untracked", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = parseBody(init);
      if (body.query.includes("productVariant(id:")) {
        return jsonResponse({
          data: {
            productVariant: {
              id: "gid://shopify/ProductVariant/111",
              inventoryPolicy: "DENY",
              product: { id: "gid://shopify/Product/99" },
              inventoryItem: { id: "gid://shopify/InventoryItem/5", tracked: false },
            },
          },
        });
      }
      if (body.query.includes("productVariantsBulkUpdate")) {
        return jsonResponse({
          data: {
            productVariantsBulkUpdate: {
              productVariants: [{ id: "gid://shopify/ProductVariant/111", inventoryPolicy: "CONTINUE" }],
              userErrors: [],
            },
          },
        });
      }
      if (body.query.includes("inventoryItemUpdate")) {
        return jsonResponse({
          data: {
            inventoryItemUpdate: {
              inventoryItem: { id: "gid://shopify/InventoryItem/5", tracked: false },
              userErrors: [],
            },
          },
        });
      }
      return jsonResponse({ errors: [{ message: "unexpected query" }] }, 500);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await ensureShadowVariantPurchasable({
      shop: "demo.myshopify.com",
      token: "tok",
      variantId: 111,
    });

    const bulkCall = fetchMock.mock.calls.find(([, init]) =>
      parseBody(init).query.includes("productVariantsBulkUpdate"),
    );
    expect(bulkCall).toBeTruthy();
    const bulkVars = parseBody(bulkCall![1]).variables;
    expect(bulkVars.productId).toBe("gid://shopify/Product/99");
    expect(bulkVars.variants).toEqual([
      { id: "gid://shopify/ProductVariant/111", inventoryPolicy: "CONTINUE" },
    ]);
  });

  it("throws when GraphQL returns 200 with userErrors (write did not land)", async () => {
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = parseBody(init);
      if (body.query.includes("productVariant(id:")) {
        return jsonResponse({
          data: {
            productVariant: {
              id: "gid://shopify/ProductVariant/111",
              inventoryPolicy: "DENY",
              product: { id: "gid://shopify/Product/99" },
              inventoryItem: { id: "gid://shopify/InventoryItem/5", tracked: true },
            },
          },
        });
      }
      return jsonResponse({
        data: {
          productVariantsBulkUpdate: {
            productVariants: [],
            userErrors: [{ field: ["inventoryPolicy"], message: "Policy not allowed" }],
          },
        },
      });
    }) as unknown as typeof fetch;

    await expect(
      ensureShadowVariantPurchasable({
        shop: "demo.myshopify.com",
        token: "tok",
        variantId: "111",
      }),
    ).rejects.toBeInstanceOf(ShadowVariantNotPurchasableError);
  });

  it("throws when the mutation returns a policy other than CONTINUE", async () => {
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = parseBody(init);
      if (body.query.includes("productVariant(id:")) {
        return jsonResponse({
          data: {
            productVariant: {
              id: "gid://shopify/ProductVariant/111",
              inventoryPolicy: "DENY",
              product: { id: "gid://shopify/Product/99" },
              inventoryItem: { id: "gid://shopify/InventoryItem/5", tracked: false },
            },
          },
        });
      }
      return jsonResponse({
        data: {
          productVariantsBulkUpdate: {
            productVariants: [{ id: "gid://shopify/ProductVariant/111", inventoryPolicy: "DENY" }],
            userErrors: [],
          },
        },
      });
    }) as unknown as typeof fetch;

    await expect(
      ensureShadowVariantPurchasable({
        shop: "demo.myshopify.com",
        token: "tok",
        variantId: "111",
      }),
    ).rejects.toMatchObject({
      name: "ShadowVariantNotPurchasableError",
      message: expect.stringContaining("did not land"),
    });
  });
});
