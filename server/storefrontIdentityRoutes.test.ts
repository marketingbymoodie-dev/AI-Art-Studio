import { describe, expect, it } from "vitest";
import { decideSessionMerge, resolveVerifiedIdentity, type IdentityDeps } from "./storefront-identity-source";
import { signStorefrontIdentityToken, verifyStorefrontIdentityHeader } from "./storefront-identity-token";

const SHOP = "ai-art-studio-staging.myshopify.com";
type C = { id: string; userId: string };

const accounts: Record<string, C> = {
  alice: { id: "alice", userId: "email:alice@example.com" },
  bob: { id: "bob", userId: "email:bob@example.com" },
  shopper: { id: "shopper", userId: `shopify:${SHOP}:555` },
};
function deps(anonMap: Record<string, C> = {}): IdentityDeps<C> {
  return {
    getCustomer: async (id) => accounts[id],
    resolveShopifyCustomer: async (sid) => (sid === "555" ? accounts.shopper : { id: `shopify-${sid}`, userId: `shopify:${SHOP}:${sid}` }),
    resolveAnonCustomer: async (sid) => anonMap[sid] ?? (anonMap[sid] = { id: `anon-${sid}`, userId: `anon:${SHOP}:${sid}` }),
    aliasTypes: async (id) => (id === "alice" || id === "bob" ? ["otp_email"] : []),
  };
}
const tok = (id: string, shop = SHOP) => verifyStorefrontIdentityHeader(`Bearer ${signStorefrontIdentityToken(id, shop)}`);
const noProxy = { verified: false };
/** merge-session target resolution: proven account only, body customerId as a check. */
const mergeTarget = (token: ReturnType<typeof tok>, claimedCustomerId: string, proxy: any = noProxy, claimedShopify?: string) =>
  resolveVerifiedIdentity(deps(), { shop: SHOP, token, proxy, claimedShopifyCustomerId: claimedShopify }, { allowAnonymous: false, claimedCustomerId });

describe("merge-session: target account", () => {
  it("anonymous → authenticated merge with a valid token", async () => {
    const t = await mergeTarget(tok("alice"), "alice");
    expect(t).toMatchObject({ ok: true, kind: "customer", via: "token", customer: { id: "alice" } });
    expect(decideSessionMerge({ anonCustomer: { id: "anon-s1", authenticated: false }, targetCustomerId: "alice", anonTokenCustomerId: "anon-s1" })).toEqual({
      ok: true,
      linkWallet: true,
      alreadyMerged: false,
    });
  });

  it("missing token → 401, nothing merged", async () => {
    expect(await mergeTarget(null, "alice")).toEqual({ ok: false, status: 401, error: "IDENTITY_REQUIRED" });
  });

  it("mismatched customer (token for alice, body claims bob) → 403", async () => {
    expect(await mergeTarget(tok("alice"), "bob")).toEqual({ ok: false, status: 403, error: "IDENTITY_MISMATCH" });
  });

  it("cross-shop token → 401", async () => {
    expect(await mergeTarget(tok("alice", "other-shop.myshopify.com"), "alice")).toMatchObject({ ok: false, status: 401 });
  });

  it("forged token → 401", async () => {
    const forged = verifyStorefrontIdentityHeader("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhbGljZSIsInR5cCI6InN0b3JlZnJvbnRfaWRlbnRpdHkifQ.AAAA");
    expect(forged).toBeNull();
    expect(await mergeTarget(forged, "alice")).toMatchObject({ ok: false, status: 401 });
  });

  it("Shopify App Proxy signed customer can be the target", async () => {
    const proxy = { verified: true, shop: SHOP, loggedInCustomerId: "555" };
    expect(await mergeTarget(null, "555", proxy, "555")).toMatchObject({ ok: true, via: "shopify", customer: { id: "shopper" } });
    // unsigned claim of the same id is not enough
    expect(await mergeTarget(null, "555", noProxy, "555")).toMatchObject({ ok: false, status: 401 });
  });
});

describe("merge-session: source session", () => {
  it("wrong session: one already owned by another account → 403, no partial merge", () => {
    expect(decideSessionMerge({ anonCustomer: { id: "bob", authenticated: true }, targetCustomerId: "alice", anonTokenCustomerId: null })).toEqual({
      ok: false,
      status: 403,
      error: "SESSION_OWNED_BY_ANOTHER_ACCOUNT",
    });
  });

  it("wrong session: pre-login anonymous token belongs to a different session → 403", () => {
    expect(decideSessionMerge({ anonCustomer: { id: "anon-s1", authenticated: false }, targetCustomerId: "alice", anonTokenCustomerId: "anon-s2" })).toMatchObject({
      ok: false,
      error: "SESSION_TOKEN_MISMATCH",
    });
    expect(decideSessionMerge({ anonCustomer: { id: "anon-s1", authenticated: false }, targetCustomerId: "alice", anonTokenCustomerId: "invalid" })).toMatchObject({ ok: false });
  });

  it("repeat merge is idempotent (session already folded into this account)", () => {
    expect(decideSessionMerge({ anonCustomer: { id: "alice", authenticated: true }, targetCustomerId: "alice", anonTokenCustomerId: null })).toEqual({
      ok: true,
      linkWallet: false,
      alreadyMerged: true,
    });
  });

  it("session with no anonymous wallet yet: jobs only", () => {
    expect(decideSessionMerge({ anonCustomer: null, targetCustomerId: "alice", anonTokenCustomerId: null })).toEqual({ ok: true, linkWallet: false, alreadyMerged: false });
  });
});

describe("status / credits status: proven caller only", () => {
  const read = (token: ReturnType<typeof tok>, claimed: string, anonSessionId?: string) =>
    resolveVerifiedIdentity(deps(), { shop: SHOP, token, proxy: noProxy, anonSessionId }, { allowAnonymous: false, claimedCustomerId: claimed });
  it("own balance with own token", async () => {
    expect(await read(tok("alice"), "alice")).toMatchObject({ ok: true, customer: { id: "alice" } });
  });
  it("another customer's balance from a claimed id → refused", async () => {
    expect(await read(null, "bob")).toMatchObject({ ok: false, status: 401 });
    expect(await read(tok("alice"), "bob")).toMatchObject({ ok: false, status: 403 });
    expect(await read(null, "bob", "some-session")).toMatchObject({ ok: false, status: 401 }); // anonymous never reads a claimed id
  });
  it("anonymous callers read their own anonymous customer via its token", async () => {
    expect(await read(tok("anon-x"), "anon-x")).toMatchObject({ ok: false, status: 401 }); // anon-x not a stored customer here
    const d = deps({ s1: { id: "anon-s1", userId: `anon:${SHOP}:s1` } });
    const anonTok = tok("anon-s1");
    const withStore: IdentityDeps<C> = { ...d, getCustomer: async (id) => (id === "anon-s1" ? { id, userId: `anon:${SHOP}:s1` } : accounts[id]) };
    expect(await resolveVerifiedIdentity(withStore, { shop: SHOP, token: anonTok, proxy: noProxy }, { allowAnonymous: false, claimedCustomerId: "anon-s1" })).toMatchObject({
      ok: true,
      customer: { id: "anon-s1" },
    });
  });
});

describe("share attribution", () => {
  it("attributed to the verified identity, never the claimed id; anonymous sharing still attributed to its session", async () => {
    const shared = (token: ReturnType<typeof tok>, anonSessionId?: string) =>
      resolveVerifiedIdentity(deps(), { shop: SHOP, token, proxy: noProxy, anonSessionId });
    expect(await shared(tok("alice"))).toMatchObject({ ok: true, customer: { id: "alice" } });
    expect(await shared(null, "s9")).toMatchObject({ ok: true, kind: "anonymous", customer: { id: "anon-s9" } });
    expect(await shared(null)).toMatchObject({ ok: false }); // no proof → share still allowed, just unattributed
  });

  it("a session merged into an account can't act as that account", async () => {
    const merged = deps({ s1: accounts.alice });
    expect(await resolveVerifiedIdentity(merged, { shop: SHOP, token: null, proxy: noProxy, anonSessionId: "s1" })).toEqual({
      ok: false,
      status: 401,
      error: "SESSION_BELONGS_TO_ACCOUNT",
    });
  });
});
