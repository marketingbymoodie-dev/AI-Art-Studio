import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  publishedRow: null as null | { design_id: string; shop: string; base_variant_id: string },
  designProductRow: null as null | { job_id: string; variant_map: any; printify_product_id: string | null },
  inserts: [] as any[][],
}));
const jobs = vi.hoisted(() => new Map<string, any>());
const flagCalls = vi.hoisted(() => [] as any[]);

vi.mock("./db", () => ({
  pool: {
    query: vi.fn(async (sql: string, params: any[]) => {
      if (sql.includes("FROM published_products")) return { rows: db.publishedRow ? [db.publishedRow] : [] };
      if (sql.includes("FROM design_products")) return { rows: db.designProductRow ? [db.designProductRow] : [] };
      if (sql.includes("INSERT INTO flat_order_submissions")) db.inserts.push(params);
      return { rows: [] };
    }),
  },
}));

vi.mock("./storage", () => ({
  storage: {
    getGenerationJob: vi.fn(async (id: string) => jobs.get(id)),
    getProductType: vi.fn(async () => undefined),
    getMerchant: vi.fn(async () => undefined),
  },
}));

vi.mock("./fulfillment-attention", () => ({
  flagOrderNeedsAttention: vi.fn(async (args: any) => {
    flagCalls.push(args);
    return { state: "tagged" };
  }),
}));

import { storage } from "./storage";
import {
  checkFulfillmentTenancy,
  resolveDesignForOrderLine,
  shopsMatchForFulfillment,
  submitFlatOrderToPrintify,
  type NormalizedOrderLine,
} from "./flat-order-fulfillment";

const SHOP_A = "shop-a.myshopify.com";
const SHOP_B = "shop-b.myshopify.com";

function line(properties: Record<string, string>, variantId: string | null = null): NormalizedOrderLine {
  return { lineId: "11", variantId, quantity: 1, properties };
}

beforeEach(() => {
  db.publishedRow = null;
  db.designProductRow = null;
  db.inserts.length = 0;
  jobs.clear();
  flagCalls.length = 0;
  vi.mocked(storage.getProductType).mockClear();
  jobs.set("job-a", { id: "job-a", shop: SHOP_A, designImageUrl: "https://x/a.png", productTypeId: 7, designState: "{}" });
  jobs.set("job-b", { id: "job-b", shop: SHOP_B, designImageUrl: "https://x/b.png", productTypeId: 7, designState: "{}" });
});

describe("fulfilment tenant isolation", () => {
  it("refuses a real job id that belongs to another shop (cross-shop regression)", async () => {
    const r = await resolveDesignForOrderLine(line({ _appai_job_id: "job-b" }), SHOP_A);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.attention).toBe(true);
    expect(r.reason).toMatch(/tenant check failed/);
    expect(storage.getProductType).not.toHaveBeenCalled();
  });

  it("cross-shop line is never sent to Printify and the order is flagged", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await submitFlatOrderToPrintify({
      shopifyOrder: { id: 9001, shop_domain: SHOP_A },
      lines: [line({ _appai_job_id: "job-b" }, "555")],
      sendToProduction: true,
      addressTo: {} as any,
      idempotencyKey: "shopify-order-fulfill:9001",
      isTest: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect(result.status).toBe("skipped");
    expect(result.needsAttention).toHaveLength(1);
    expect(result.needsAttention![0].reason).toMatch(/shop-b/);
    expect(flagCalls).toHaveLength(1);
    expect(flagCalls[0].shop).toBe(SHOP_A);
    const metadata = JSON.parse(db.inserts[0].at(-1));
    expect(metadata.needsAttention).toHaveLength(1);
  });

  it("refuses a shadow variant row owned by another shop", async () => {
    db.publishedRow = { design_id: "job-a::abc", shop: SHOP_B, base_variant_id: "1" };
    const r = await resolveDesignForOrderLine(line({ _appai_job_id: "job-a" }, "555"), SHOP_A);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/shadow variant belongs to/);
  });

  it("holds a line whose job differs from the shadow's real job", async () => {
    jobs.set("job-a2", { ...jobs.get("job-a"), id: "job-a2" });
    db.publishedRow = { design_id: "job-a2::abc", shop: SHOP_A, base_variant_id: "1" };
    const r = await resolveDesignForOrderLine(line({ _appai_job_id: "job-a" }, "555"), SHOP_A);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.attention).toBe(true);
      expect(r.reason).toMatch(/does not match the shadow's job job-a2/);
    }
  });

  it("allows a creator shadow keyed by cart line id (not a job) to carry the line job", async () => {
    db.publishedRow = { design_id: "gid://shopify/CartLine/xyz?cart=c1::abc", shop: SHOP_A, base_variant_id: "1" };
    const r = await resolveDesignForOrderLine(line({ _appai_job_id: "job-a" }, "555"), SHOP_A);
    // Passes tenancy; stops later on the (mocked-missing) product type.
    expect(storage.getProductType).toHaveBeenCalled();
    if (!r.ok) expect(r.reason).toMatch(/product type 7 not found/);
  });

  it("holds a design-product variant bought with a different line job", async () => {
    db.designProductRow = { job_id: "job-a", variant_map: { "555": { sizeId: "m" } }, printify_product_id: null };
    jobs.set("job-a2", { ...jobs.get("job-a"), id: "job-a2" });
    const r = await resolveDesignForOrderLine(line({ _appai_job_id: "job-a2" }, "555"), SHOP_A);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/design product's job job-a/);
  });

  it("flags a fake design id instead of skipping silently", async () => {
    const r = await resolveDesignForOrderLine(line({ _design_id: "not-a-real-job" }), SHOP_A);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.attention).toBe(true);
      expect(r.reason).toMatch(/no generation job/);
    }
  });

  it("keeps normal products in a mixed cart quiet", async () => {
    const r = await resolveDesignForOrderLine(line({}), SHOP_A);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.attention).toBe(false);
  });

  it("refuses a live order with no shop", async () => {
    const r = await resolveDesignForOrderLine(line({ _appai_job_id: "job-a" }), "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/order has no shop/);
  });
});

describe("shopsMatchForFulfillment", () => {
  it("normalizes handle vs myshopify domain", () => {
    expect(shopsMatchForFulfillment("Shop-A", SHOP_A)).toBe(true);
    expect(shopsMatchForFulfillment(SHOP_A, SHOP_B)).toBe(false);
    expect(shopsMatchForFulfillment("", SHOP_A)).toBe(false);
  });

  it("treats creator platform rename aliases as one tenant", () => {
    const prev = process.env.CREATOR_PLATFORM_SHOP_DOMAIN;
    process.env.CREATOR_PLATFORM_SHOP_DOMAIN = "whi6jd-nv.myshopify.com";
    try {
      expect(shopsMatchForFulfillment("aiartstudio-creators.myshopify.com", "whi6jd-nv.myshopify.com")).toBe(true);
      expect(shopsMatchForFulfillment("aiartstudio-creators.myshopify.com", SHOP_A)).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.CREATOR_PLATFORM_SHOP_DOMAIN;
      else process.env.CREATOR_PLATFORM_SHOP_DOMAIN = prev;
    }
  });

  it("only admin draft tests may run without an order shop", () => {
    expect(checkFulfillmentTenancy({ orderShop: "", jobShop: SHOP_A, allowShoplessOrder: true }).ok).toBe(true);
    expect(checkFulfillmentTenancy({ orderShop: "", jobShop: SHOP_A }).ok).toBe(false);
  });
});
