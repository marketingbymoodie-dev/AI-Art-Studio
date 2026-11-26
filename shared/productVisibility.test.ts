import { describe, expect, it } from "vitest";
import { requireProductVisibility, shopifyStatusForVisibility } from "./productVisibility";

describe("product visibility kind", () => {
  it("requires a kind and names the call site when it is omitted", () => {
    expect(() => requireProductVisibility(undefined)).toThrow(/Omitted at/);
    expect(() => requireProductVisibility(undefined)).toThrow(/productVisibility\.test/);
    expect(() => shopifyStatusForVisibility(undefined)).toThrow(/Omitted at/);
  });

  it("does not default a missing kind to unlisted", () => {
    expect(() => shopifyStatusForVisibility(undefined)).toThrow(/required/);
  });

  it("maps the three kinds, and holds a published product as a draft without making it unlisted", () => {
    expect(shopifyStatusForVisibility("published")).toBe("active");
    expect(shopifyStatusForVisibility("published", "draft")).toBe("draft");
    expect(shopifyStatusForVisibility("unlisted")).toBe("unlisted");
    expect(shopifyStatusForVisibility("hidden")).toBe("unlisted");
  });
});
