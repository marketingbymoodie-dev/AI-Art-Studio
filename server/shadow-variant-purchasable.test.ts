import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ShadowVariantNotPurchasableError,
  deliveryProfileIdsEqual,
  ensureShadowDeliveryProfileParity,
  ensureShadowVariantPurchasable,
} from "./shadow-variant-purchasable";

vi.mock("./shipping-reconciler", () => ({
  attachVariantToShipping: vi.fn().mockResolvedValue(undefined),
}));

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
    const publishCall = fetchMock.mock.calls.find(([, init]) =>
      parseBody(init).query.includes("publishablePublish"),
    );
    expect(publishCall).toBeUndefined();
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
      message: expect.stringContaining("not live on the Online Store"),
    });
  });

  it("skips deliveryProfileUpdate when the shadow is already on the base profile", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = parseBody(init);
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
      if (body.query.includes("deliveryProfile {")) {
        return jsonResponse({
          data: {
            productVariant: {
              id: `gid://shopify/ProductVariant/${String(body.variables.id).replace(/\D/g, "")}`,
              deliveryProfile: {
                id: "gid://shopify/DeliveryProfile/100229775594",
                name: "AppAI · Faux Suede Square Pillow — provider 10 · 16-16",
                default: false,
              },
            },
          },
        });
      }
      if (body.query.includes("productVariant(id:")) {
        return jsonResponse({
          data: {
            productVariant: {
              id: "gid://shopify/ProductVariant/111",
              inventoryPolicy: "CONTINUE",
              product: { id: "gid://shopify/Product/99" },
              inventoryItem: { id: "gid://shopify/InventoryItem/5", tracked: false },
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
      variantId: "111",
      baseVariantId: "222",
    });

    const assoc = fetchMock.mock.calls.find(([, init]) =>
      parseBody(init).query.includes("deliveryProfileUpdate"),
    );
    expect(assoc).toBeUndefined();
  });

  it("moves the shadow onto the base profile and asserts the re-read", async () => {
    let shadowProfile = "gid://shopify/DeliveryProfile/99964780778";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = parseBody(init);
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
      if (body.query.includes("deliveryProfileUpdate")) {
        shadowProfile = "gid://shopify/DeliveryProfile/100229775594";
        return jsonResponse({
          data: { deliveryProfileUpdate: { profile: { id: shadowProfile }, userErrors: [] } },
        });
      }
      if (body.query.includes("deliveryProfile {")) {
        const id = String(body.variables.id).replace(/\D/g, "");
        const profileId =
          id === "222" ? "gid://shopify/DeliveryProfile/100229775594" : shadowProfile;
        const name =
          profileId.endsWith("100229775594")
            ? "AppAI · Faux Suede Square Pillow — provider 10 · 16-16"
            : "General profile";
        return jsonResponse({
          data: {
            productVariant: {
              id: `gid://shopify/ProductVariant/${id}`,
              deliveryProfile: { id: profileId, name, default: profileId.endsWith("99964780778") },
            },
          },
        });
      }
      if (body.query.includes("productVariant(id:")) {
        return jsonResponse({
          data: {
            productVariant: {
              id: "gid://shopify/ProductVariant/111",
              inventoryPolicy: "CONTINUE",
              product: { id: "gid://shopify/Product/99" },
              inventoryItem: { id: "gid://shopify/InventoryItem/5", tracked: false },
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
      variantId: "111",
      baseVariantId: "222",
    });

    const assoc = fetchMock.mock.calls.find(([, init]) =>
      parseBody(init).query.includes("deliveryProfileUpdate"),
    );
    expect(assoc).toBeTruthy();
    const vars = parseBody(assoc![1]).variables;
    expect(vars.id).toBe("gid://shopify/DeliveryProfile/100229775594");
    expect(vars.profile.variantsToAssociate).toEqual(["gid://shopify/ProductVariant/111"]);
  });

  it("throws when the associated profile does not land on the shadow", async () => {
    await expect(
      (async () => {
        globalThis.fetch = (async (_url: string, init?: RequestInit) => {
          const body = parseBody(init);
          if (body.query.includes("deliveryProfileUpdate")) {
            return jsonResponse({
              data: { deliveryProfileUpdate: { profile: { id: "gid://shopify/DeliveryProfile/100229775594" }, userErrors: [] } },
            });
          }
          if (body.query.includes("deliveryProfile {")) {
            const id = String(body.variables.id).replace(/\D/g, "");
            return jsonResponse({
              data: {
                productVariant: {
                  id: `gid://shopify/ProductVariant/${id}`,
                  deliveryProfile: {
                    id:
                      id === "222"
                        ? "gid://shopify/DeliveryProfile/100229775594"
                        : "gid://shopify/DeliveryProfile/99964780778",
                    name: id === "222" ? "AppAI" : "General profile",
                    default: id !== "222",
                  },
                },
              },
            });
          }
          return jsonResponse({ errors: [{ message: "unexpected query" }] }, 500);
        }) as unknown as typeof fetch;

        await ensureShadowDeliveryProfileParity({
          shop: "demo.myshopify.com",
          token: "tok",
          variantId: "111",
          baseVariantId: "222",
        });
      })(),
    ).rejects.toMatchObject({
      name: "ShadowVariantNotPurchasableError",
      message: expect.stringContaining("did not land"),
    });
  });
});

describe("deliveryProfileIdsEqual", () => {
  it("compares numeric ids across GID and raw forms", () => {
    expect(deliveryProfileIdsEqual("gid://shopify/DeliveryProfile/100229775594", "100229775594")).toBe(true);
    expect(deliveryProfileIdsEqual("99964780778", "100229775594")).toBe(false);
    expect(deliveryProfileIdsEqual(null, "100229775594")).toBe(false);
  });
});
