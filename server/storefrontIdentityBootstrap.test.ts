import { describe, expect, it } from "vitest";
import { resolveProvenCustomer, identitySources, type IdentityDeps } from "./storefront-identity-source";
import { signStorefrontIdentityToken, verifyStorefrontIdentityHeader } from "./storefront-identity-token";

const SHOP = "ai-art-studio-staging.myshopify.com";
type C = { id: string; userId: string };

/** In-memory customers: signed-in (email), anon session, Shopify alias. */
function deps(): IdentityDeps<C> & { created: string[] } {
  const customers: Record<string, C> = {
    signedIn: { id: "signedIn", userId: "email:alice@example.com" },
    victim: { id: "victim", userId: "email:bob@example.com" },
  };
  const anon: Record<string, C> = { "anon-1": { id: "anonCustomer1", userId: `anon:${SHOP}:anon-1` } };
  const created: string[] = [];
  return {
    created,
    getCustomer: async (id) => customers[id],
    resolveShopifyCustomer: async (sid) => ({ id: `shopify-${sid}`, userId: `shopify:${SHOP}:${sid}` }),
    resolveAnonCustomer: async (sid) => {
      if (!anon[sid]) {
        anon[sid] = { id: `anonCustomer-${sid}`, userId: `anon:${SHOP}:${sid}` };
        created.push(sid);
      }
      return anon[sid];
    },
    aliasTypes: async (id) => (id === "signedIn" || id === "victim" ? ["otp_email"] : []),
  };
}

const noProxy = { verified: false };
const bearer = (t: string) => verifyStorefrontIdentityHeader(`Bearer ${t}`);

describe("identity bootstrap: proof only", () => {
  it("valid token for this shop → refreshes that customer", async () => {
    const token = bearer(signStorefrontIdentityToken("signedIn", SHOP));
    const r = await resolveProvenCustomer(deps(), { shop: SHOP, token, proxy: noProxy, anonSessionId: "anon-1" });
    expect(r).toMatchObject({ source: "token", customer: { id: "signedIn" } });
  });

  it("expired or missing token → anonymous session only, never the signed-in account", async () => {
    expect(bearer(signStorefrontIdentityToken("signedIn", SHOP, -10))).toBeNull(); // expired
    const r = await resolveProvenCustomer(deps(), { shop: SHOP, token: null, proxy: noProxy, anonSessionId: "anon-1" });
    expect(r).toMatchObject({ source: "anon", customer: { id: "anonCustomer1" } });
  });

  it("a bare customer id is never enough (no token, no session → nothing)", async () => {
    // The body customerId is not even an input to proof; an unverified Shopify claim is ignored too.
    const r = await resolveProvenCustomer(deps(), {
      shop: SHOP,
      token: null,
      proxy: noProxy,
      claimedShopifyCustomerId: "victim",
    });
    expect(r).toBeNull();
    expect(identitySources({ shop: SHOP, token: null, proxy: noProxy })).toEqual([{ kind: "none" }]);
  });

  it("successful sign-in issues a token that then proves the account", async () => {
    const issued = signStorefrontIdentityToken("signedIn", SHOP); // verify-otp / Google path
    const verified = bearer(issued);
    expect(verified).toEqual({ customerId: "signedIn", shop: SHOP });
    const r = await resolveProvenCustomer(deps(), { shop: SHOP, token: verified, proxy: noProxy });
    expect(r?.customer.id).toBe("signedIn");
  });

  it("anonymous identity still works (new and returning sessions)", async () => {
    const d = deps();
    const fresh = await resolveProvenCustomer(d, { shop: SHOP, token: null, proxy: noProxy, anonSessionId: "anon-new" });
    expect(fresh).toMatchObject({ source: "anon", customer: { id: "anonCustomer-anon-new" } });
    const again = await resolveProvenCustomer(d, { shop: SHOP, token: null, proxy: noProxy, anonSessionId: "anon-new" });
    expect(again?.customer.id).toBe("anonCustomer-anon-new");
    expect(d.created).toEqual(["anon-new"]);
  });

  it("one customer cannot bootstrap another customer's identity", async () => {
    const mine = bearer(signStorefrontIdentityToken("signedIn", SHOP));
    // Proof is the token's customer — the victim id cannot be requested through it.
    const r = await resolveProvenCustomer(deps(), { shop: SHOP, token: mine, proxy: noProxy, claimedShopifyCustomerId: "victim" });
    expect(r?.customer.id).toBe("signedIn");
    // An anonymous session that somehow maps to a signed-in account is refused.
    const hijack: IdentityDeps<C> = { ...deps(), resolveAnonCustomer: async () => ({ id: "victim", userId: "email:bob@example.com" }) };
    expect(await resolveProvenCustomer(hijack, { shop: SHOP, token: null, proxy: noProxy, anonSessionId: "stolen" })).toBeNull();
    // A forged token does not verify.
    expect(verifyStorefrontIdentityHeader("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ2aWN0aW0ifQ.forged")).toBeNull();
  });

  it("cross-shop attempts are rejected", async () => {
    const otherShopToken = bearer(signStorefrontIdentityToken("signedIn", "other-shop.myshopify.com"));
    const r = await resolveProvenCustomer(deps(), { shop: SHOP, token: otherShopToken, proxy: noProxy, anonSessionId: "anon-1" });
    expect(r).toMatchObject({ source: "anon", customer: { id: "anonCustomer1" } });
    // Proxy-signed Shopify customer only counts for the proxy's own shop.
    const proxyOther = { verified: true, shop: "other-shop.myshopify.com", loggedInCustomerId: "123" };
    expect(identitySources({ shop: SHOP, token: null, proxy: proxyOther, claimedShopifyCustomerId: "123" })).toEqual([{ kind: "none" }]);
  });

  it("Shopify customer only when it matches the proxy-signed logged_in_customer_id", async () => {
    const proxy = { verified: true, shop: SHOP, loggedInCustomerId: "555" };
    expect(identitySources({ shop: SHOP, token: null, proxy, claimedShopifyCustomerId: "555" })).toEqual([
      { kind: "shopify", shopifyCustomerId: "555" },
    ]);
    expect(identitySources({ shop: SHOP, token: null, proxy, claimedShopifyCustomerId: "556" })).toEqual([{ kind: "none" }]);
    expect(identitySources({ shop: SHOP, token: null, proxy: { ...proxy, verified: false }, claimedShopifyCustomerId: "555" })).toEqual([
      { kind: "none" },
    ]);
  });
});
