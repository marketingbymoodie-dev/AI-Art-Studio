import { describe, expect, it } from "vitest";
import { decideShadowOrderHold, lookupShadowOrderHold, protectShadowsOnPaidOrder } from "./shadow-reaper-guard";

const now = Date.parse("2026-11-12T00:00:00Z");

describe("decideShadowOrderHold", () => {
  it("holds an unfulfilled order", () => {
    expect(decideShadowOrderHold([{ displayFulfillmentStatus: "UNFULFILLED", createdAt: "2026-11-01T00:00:00Z" }], now)).toBe("hold");
  });

  it("holds a fulfilled order from the last 60 days", () => {
    expect(decideShadowOrderHold([{ displayFulfillmentStatus: "FULFILLED", createdAt: "2026-10-01T00:00:00Z" }], now)).toBe("hold");
  });

  it("clears a fulfilled order older than 60 days and ignores cancelled orders", () => {
    expect(decideShadowOrderHold([
      { cancelledAt: "2026-11-01T00:00:00Z", displayFulfillmentStatus: "UNFULFILLED", createdAt: "2026-11-01T00:00:00Z" },
      { displayFulfillmentStatus: "FULFILLED", createdAt: "2026-08-01T00:00:00Z" },
    ], now)).toBe("clear");
  });

  it("holds when fulfilment status is missing", () => {
    expect(decideShadowOrderHold([{ createdAt: "2026-01-01T00:00:00Z" }], now)).toBe("hold");
  });
});

describe("lookupShadowOrderHold", () => {
  it("asks Shopify by variant id and holds when an open order comes back", async () => {
    let body = "";
    const fetchImpl = async (url: string, init?: RequestInit) => {
      body = String(init?.body || "");
      expect(url).toContain("/admin/api/2025-10/graphql.json");
      return new Response(JSON.stringify({
        data: { orders: { edges: [{ node: { displayFulfillmentStatus: "UNFULFILLED", createdAt: "2026-11-11T00:00:00Z" } }] } },
      }), { status: 200 });
    };
    const hold = await lookupShadowOrderHold({
      shop: "demo.myshopify.com",
      token: "token",
      variantId: "gid://shopify/ProductVariant/99",
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(hold).toBe("hold");
    expect(body).toContain("variant_id:99");
  });

  it("does not treat a Shopify error as permission to delete", async () => {
    const fetchImpl = async () => new Response("no", { status: 500 });
    const hold = await lookupShadowOrderHold({
      shop: "demo.myshopify.com",
      token: "token",
      variantId: "99",
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(hold).toBe("unknown");
  });
});

describe("protectShadowsOnPaidOrder", () => {
  it("locks each shadow variant on the order and skips catalogue lines", async () => {
    const protectedIds: string[] = [];
    const count = await protectShadowsOnPaidOrder("demo.myshopify.com", {
      name: "#1001",
      line_items: [{ variant_id: 11 }, { variant_id: 22 }, { variant_id: 11 }],
    }, {
      findActiveShadowProduct: async (_shop, ids) => (ids.variantId === "11" ? { id: "row-11" } : undefined),
      protectShadowProductOrder: async (id) => { protectedIds.push(id); },
    });
    expect(count).toBe(1);
    expect(protectedIds).toEqual(["row-11"]);
  });
});
