import { describe, expect, it } from "vitest";
import { identityMatches } from "./storefront-identity-check";

const SHOP = "ai-art-studio-staging.myshopify.com";

describe("saved designs require the owner's identity token", () => {
  it("valid token for this customer and shop", () => {
    expect(identityMatches({ customerId: "c1", shop: SHOP }, "c1", SHOP)).toEqual({ ok: true });
    // bare handle vs full domain are the same shop
    expect(identityMatches({ customerId: "c1", shop: "ai-art-studio-staging" }, "c1", SHOP)).toEqual({ ok: true });
  });

  it("mismatched customer → 403", () => {
    expect(identityMatches({ customerId: "attacker", shop: SHOP }, "victim", SHOP)).toEqual({ ok: false, status: 403, error: "IDENTITY_MISMATCH" });
  });

  it("token for another shop → 403", () => {
    expect(identityMatches({ customerId: "c1", shop: "other.myshopify.com" }, "c1", SHOP)).toMatchObject({ ok: false, status: 403 });
  });

  it("missing (or invalid/expired, which verifies to null) token → 401", () => {
    expect(identityMatches(null, "c1", SHOP)).toEqual({ ok: false, status: 401, error: "IDENTITY_REQUIRED" });
  });

  it("anonymous visitors: the bootstrap token for their anon customer works the same way", () => {
    expect(identityMatches({ customerId: "anon-customer-9", shop: SHOP }, "anon-customer-9", SHOP)).toEqual({ ok: true });
    expect(identityMatches({ customerId: "anon-customer-9", shop: SHOP }, "anon-customer-10", SHOP)).toMatchObject({ ok: false, status: 403 });
  });
});
