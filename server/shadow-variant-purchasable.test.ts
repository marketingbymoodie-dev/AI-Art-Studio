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

function publicationOkResponse(query: string): Response | null {
  if (query.includes("publications(")) {
    return jsonResponse({
      data: {
        publications: {
          edges: [{ node: { id: "gid://shopify/Publication/1", name: "Online Store" } }],
        },
      },
    });
  }
  if (query.includes("publishablePublish")) {
    return jsonResponse({ data: { publishablePublish: { userErrors: [] } } });
  }
  if (query.includes("publishedOnPublication")) {
    return jsonResponse({
      data: { product: { status: "UNLISTED", publishedOnPublication: true } },
    });
  }
  return null;
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
      const pub = publicationOkResponse(body.query);
      if (pub) return pub;
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

  it("throws when Online Store publication does not land", async () => {
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/products/") && init?.method === "PUT") {
        return jsonResponse({ product: { id: 99, published: true } });
      }
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
      if (body.query.includes("publications(")) {
        return jsonResponse({
          data: {
            publications: {
              edges: [{ node: { id: "gid://shopify/Publication/1", name: "Online Store" } }],
            },
          },
        });
      }
      if (body.query.includes("publishablePublish")) {
        return jsonResponse({ data: { publishablePublish: { userErrors: [] } } });
      }
      if (body.query.includes("publishedOnPublication")) {
        return jsonResponse({
          data: { product: { status: "UNLISTED", publishedOnPublication: false } },
        });
      }
      return jsonResponse({ errors: [{ message: "unexpected query" }] }, 500);
    }) as unknown as typeof fetch;

    await expect(
      ensureShadowVariantPurchasable({
        shop: "demo.myshopify.com",
        token: "tok",
        variantId: "111",
      }),
    ).rejects.toMatchObject({
      name: "ShadowVariantNotPurchasableError",
      message: expect.stringContaining("not on the Online Store"),
    });
  });
});
