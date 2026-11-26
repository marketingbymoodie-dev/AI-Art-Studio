import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ pool: { query: vi.fn() } }));
vi.mock("./checkout-guard", () => ({ adminGraphql: vi.fn(), shopToken: vi.fn() }));

import { desiredInventoryPolicy } from "./catalogue-inventory-policy";

describe("desiredInventoryPolicy", () => {
  it("maps stock statuses onto Shopify inventory policy", () => {
    expect(desiredInventoryPolicy("in_stock")).toBe("CONTINUE");
    expect(desiredInventoryPolicy("out_of_stock")).toBe("DENY");
    expect(desiredInventoryPolicy("removed")).toBe("DENY");
    expect(desiredInventoryPolicy(undefined)).toBeNull();
    expect(desiredInventoryPolicy("unknown")).toBeNull();
  });
});
