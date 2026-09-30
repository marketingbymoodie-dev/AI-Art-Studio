import { beforeEach, describe, expect, it, vi } from "vitest";
import { signStorefrontIdentityToken } from "./storefront-identity-token";

const SHOP = "ai-art-studio-staging.myshopify.com";
const OTHER_SHOP = "other-shop.myshopify.com";
const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const STUDIO = "33333333-3333-4333-8333-333333333333"; // merchant's own studio (Preview Studio)

type Row = { id: string; userId: string };
const customers: Record<string, Row> = {
  [ALICE]: { id: ALICE, userId: "email:alice@example.com" },
  [BOB]: { id: BOB, userId: "email:bob@example.com" },
  [STUDIO]: { id: STUDIO, userId: `merchant_studio:${SHOP}:m1` },
};
const aliasCustomers: Record<string, Row> = {};

vi.mock("./storage", () => ({
  storage: {
    getCustomer: async (id: string) => customers[id],
    ensureCustomerBalance: async () => ({}),
    getCustomerAliases: async (id: string) => {
      // Alice signed in after designing anonymously: her old session alias moved onto her account.
      if (id === ALICE) return [{ aliasType: "otp_email", aliasValue: "alice@example.com" }, { aliasType: "anon_session", aliasValue: "alice-old-session" }];
      if (id === BOB) return [{ aliasType: "otp_email", aliasValue: "bob@example.com" }];
      if (id === STUDIO) return [{ aliasType: "merchant_studio", aliasValue: "m1" }];
      if (id.startsWith("anon_session-")) return [{ aliasType: "anon_session", aliasValue: id.slice("anon_session-".length) }];
      return [];
    },
    resolveOrCreateCustomerAlias: async (a: { aliasType: string; aliasValue: string; shop: string }) => {
      const key = `${a.aliasType}:${a.shop}:${a.aliasValue}`;
      return (aliasCustomers[key] ??= {
        id: `${a.aliasType}-${a.aliasValue}`,
        userId: `${a.aliasType === "shopify" ? "shopify" : "anon"}:${a.shop}:${a.aliasValue}`,
      });
    },
  },
}));
vi.mock("./shopify-app-credentials", () => ({
  verifyAppProxySignature: (q: Record<string, string>) => q.signature === "valid",
}));

const { resolveClaimedStorefrontCustomer, resolveCreatorVisitorCustomer, resolveStorefrontJobAccess, resolveVerifiedStorefrontIdentity } =
  await import("./storefront-identity");
const { canClaimDesign, canCopyCreativeBrief } = await import("./storefront-identity-source");

const req = (opts: { token?: string; query?: Record<string, string> } = {}) =>
  ({ headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {}, query: opts.query ?? {} }) as any;
const tokenFor = (id: string, shop = SHOP) => signStorefrontIdentityToken(id, shop);

beforeEach(() => {
  for (const k of Object.keys(aliasCustomers)) delete aliasCustomers[k];
});

describe("claimed customerId → proven owner (save-design / fork-design / redeem-coupon / creator recent-designs)", () => {
  it("own verified customer", async () => {
    expect(await resolveClaimedStorefrontCustomer(req({ token: tokenFor(ALICE) }), SHOP, ALICE)).toMatchObject({
      ok: true,
      customer: { id: ALICE },
    });
  });

  it("another customer's claimed id is refused (with or without a token)", async () => {
    expect(await resolveClaimedStorefrontCustomer(req({ token: tokenFor(ALICE) }), SHOP, BOB)).toEqual({
      ok: false,
      status: 403,
      error: "IDENTITY_MISMATCH",
    });
    expect(await resolveClaimedStorefrontCustomer(req(), SHOP, BOB)).toMatchObject({ ok: false, status: 401 });
  });

  it("no proof → 401, even for an anonymous-session claim", async () => {
    expect(await resolveClaimedStorefrontCustomer(req(), SHOP, ALICE)).toEqual({
      ok: false,
      status: 401,
      error: "IDENTITY_REQUIRED",
    });
  });

  it("cross-shop token is not proof on this shop", async () => {
    expect(await resolveClaimedStorefrontCustomer(req({ token: tokenFor(ALICE, OTHER_SHOP) }), SHOP, ALICE)).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it("anonymous customer proves itself with its own token", async () => {
    const anon = await resolveVerifiedStorefrontIdentity(req(), SHOP, { anonSessionId: "s1" });
    expect(anon).toMatchObject({ ok: true, kind: "anonymous" });
    const anonId = (anon as any).customer.id as string;
    customers[anonId] = (anon as any).customer;
    try {
      expect(await resolveClaimedStorefrontCustomer(req({ token: tokenFor(anonId) }), SHOP, anonId)).toMatchObject({
        ok: true,
        customer: { id: anonId },
      });
    } finally {
      delete customers[anonId];
    }
  });

  it("Shopify customer id only with the App Proxy signature for this shop", async () => {
    const signed = { signature: "valid", shop: SHOP, logged_in_customer_id: "555" };
    expect(await resolveClaimedStorefrontCustomer(req({ query: signed }), SHOP, "555")).toMatchObject({
      ok: true,
      customer: { id: "shopify-555" },
    });
    expect(await resolveClaimedStorefrontCustomer(req({ query: { ...signed, signature: "forged" } }), SHOP, "555")).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(await resolveClaimedStorefrontCustomer(req({ query: { ...signed, shop: OTHER_SHOP } }), SHOP, "555")).toMatchObject({
      ok: false,
    });
    expect(await resolveClaimedStorefrontCustomer(req({ query: signed }), SHOP, "556")).toMatchObject({ ok: false });
  });
});

describe("shopify/session customer binding", () => {
  const bind = (r: any, shopifyCustomerId: string) =>
    resolveVerifiedStorefrontIdentity(r, SHOP, { shopifyCustomerId }, { allowAnonymous: false });
  it("an unsigned Shopify customer id never binds a paying customer", async () => {
    expect(await bind(req(), "555")).toMatchObject({ ok: false });
  });
  it("proxy-signed id binds that customer; a token binds the token's own customer", async () => {
    expect(await bind(req({ query: { signature: "valid", shop: SHOP, logged_in_customer_id: "555" } }), "555")).toMatchObject({
      ok: true,
      customer: { id: "shopify-555" },
    });
    expect(await bind(req({ token: tokenFor(ALICE) }), "999")).toMatchObject({ ok: true, customer: { id: ALICE } });
  });
});

describe("creator recent-designs visitor (list + unlink)", () => {
  // No public listing exists: designs come only from the visitor's own creator
  // session id and, when proven, their customer id.
  const visitor = (r: any, claimed: string, shop: string | null = SHOP) => resolveCreatorVisitorCustomer(r, shop, claimed);
  it("own verified customer → their designs", async () => {
    expect(await visitor(req({ token: tokenFor(ALICE) }), ALICE)).toEqual({ ok: true, customerId: ALICE });
  });
  it("another customer's claimed id → 403 with proof for someone else, session-only without proof", async () => {
    expect(await visitor(req({ token: tokenFor(ALICE) }), BOB)).toEqual({ ok: false, status: 403, error: "IDENTITY_MISMATCH" });
    expect(await visitor(req(), BOB)).toEqual({ ok: true, customerId: null });
  });
  it("anonymous own-session access (no customer claim) stays session-only", async () => {
    expect(await visitor(req(), "")).toEqual({ ok: true, customerId: null });
  });
  it("cross-shop identity is not proof on the creator platform shop", async () => {
    expect(await visitor(req({ token: tokenFor(ALICE, OTHER_SHOP) }), ALICE)).toEqual({ ok: true, customerId: null });
  });
  it("no platform shop configured → session only", async () => {
    expect(await visitor(req({ token: tokenFor(ALICE) }), ALICE, null)).toEqual({ ok: true, customerId: null });
  });
});

describe("save-design ownership", () => {
  it("unowned or own job can be saved; another customer's job cannot", () => {
    expect(canClaimDesign(null, ALICE)).toBe(true);
    expect(canClaimDesign(ALICE, ALICE)).toBe(true);
    expect(canClaimDesign(BOB, ALICE)).toBe(false);
  });
});

describe("fork-design creative brief", () => {
  it("copied only from the verified owner's own design on the same shop", () => {
    expect(canCopyCreativeBrief({ shop: SHOP, customerId: ALICE }, SHOP, ALICE)).toBe(true);
    expect(canCopyCreativeBrief({ shop: SHOP, customerId: BOB }, SHOP, ALICE)).toBe(false);
    expect(canCopyCreativeBrief({ shop: OTHER_SHOP, customerId: ALICE }, SHOP, ALICE)).toBe(false);
    expect(canCopyCreativeBrief({ shop: SHOP, customerId: null }, SHOP, ALICE)).toBe(false);
    // anonymous fork (no proven owner): never carries a brief
    expect(canCopyCreativeBrief({ shop: SHOP, customerId: null }, SHOP, null)).toBe(false);
    expect(canCopyCreativeBrief(undefined, SHOP, ALICE)).toBe(false);
  });
});

describe("save-state / fork-placement: only the verified owner of the job", () => {
  const JOB = (o: { customerId?: string | null; sessionId?: string | null; shop?: string }) => ({ shop: SHOP, customerId: null, sessionId: null, ...o });
  const access = (r: any, job: any, sessionId?: string) => resolveStorefrontJobAccess(r, SHOP, job, sessionId);
  const OK = { ok: true };
  const DENIED = { ok: false, status: 403, error: "NOT_DESIGN_OWNER" };

  it("owner with their token → allowed; another customer → 403", async () => {
    expect(await access(req({ token: tokenFor(ALICE) }), JOB({ customerId: ALICE }))).toEqual(OK);
    expect(await access(req({ token: tokenFor(BOB) }), JOB({ customerId: ALICE }))).toEqual(DENIED);
  });

  it("a job id alone (no proof, claimed ids ignored) → 403", async () => {
    const claimed = { ...req({ query: { customerId: ALICE } }), body: { customerId: ALICE } };
    expect(await access(claimed, JOB({ customerId: ALICE }))).toEqual(DENIED);
  });

  it("same shop required: other-shop job → 404; other-shop token → not proof", async () => {
    expect(await access(req({ token: tokenFor(ALICE) }), JOB({ customerId: ALICE, shop: OTHER_SHOP }))).toMatchObject({ ok: false, status: 404 });
    expect(await access(req({ token: tokenFor(ALICE, OTHER_SHOP) }), JOB({ customerId: ALICE }))).toEqual(DENIED);
  });

  it("anonymous owner updates only their own anonymous job", async () => {
    expect(await access(req(), JOB({ customerId: "anon_session-s1" }), "s1")).toEqual(OK);
    expect(await access(req(), JOB({ customerId: "anon_session-s1" }), "s2")).toEqual(DENIED);
    // the same anonymous customer via its identity token
    customers["anon_session-s1"] = { id: "anon_session-s1", userId: `anon:${SHOP}:s1` };
    try {
      expect(await access(req({ token: tokenFor("anon_session-s1") }), JOB({ customerId: "anon_session-s1" }))).toEqual(OK);
    } finally {
      delete customers["anon_session-s1"];
    }
  });

  it("legacy session-only job: its anonymous session, or the account it was merged into", async () => {
    expect(await access(req(), JOB({ sessionId: "s1" }), "s1")).toEqual(OK);
    expect(await access(req(), JOB({ sessionId: "s1" }), "s2")).toEqual(DENIED);
    expect(await access(req({ token: tokenFor(ALICE) }), JOB({ sessionId: "alice-old-session" }))).toEqual(OK);
    expect(await access(req({ token: tokenFor(BOB) }), JOB({ sessionId: "alice-old-session" }))).toEqual(DENIED);
  });

  it("a session merged into an account can't act as that account", async () => {
    aliasCustomers[`anon_session:${SHOP}:alice-old-session`] = customers[ALICE];
    expect(await access(req(), JOB({ customerId: ALICE }), "alice-old-session")).toEqual(DENIED);
  });

  it("unowned job (Preview Studio / admin tester) → that shop's merchant studio only", async () => {
    expect(await access(req({ token: tokenFor(STUDIO) }), JOB({}))).toEqual(OK);
    expect(await access(req({ token: tokenFor(STUDIO, OTHER_SHOP) }), JOB({}))).toEqual(DENIED);
    expect(await access(req({ token: tokenFor(ALICE) }), JOB({}))).toEqual(DENIED);
    expect(await access(req(), JOB({}), "s1")).toEqual(DENIED);
  });
});

describe("shared design view: share credit viewer", () => {
  // Same call the route makes: verified identity or anonymous session; query customerId/visitorKey unused.
  const viewer = (r: any, sessionId?: string) => resolveVerifiedStorefrontIdentity(r, SHOP, { anonSessionId: sessionId ?? null });
  it("claimed customerId / visitorKey with no proof → no viewer (no grant)", async () => {
    expect(await viewer(req({ query: { customerId: BOB, visitorKey: "someone-else" } }))).toMatchObject({ ok: false });
  });
  it("owner's own visit resolves to the owner, whatever ids are claimed", async () => {
    expect(await viewer(req({ token: tokenFor(ALICE), query: { customerId: BOB } }), "fresh")).toMatchObject({ ok: true, customer: { id: ALICE } });
    aliasCustomers[`anon_session:${SHOP}:alice-old-session`] = customers[ALICE];
    expect(await viewer(req(), "alice-old-session")).toMatchObject({ ok: false, error: "SESSION_BELONGS_TO_ACCOUNT" });
  });
  it("a different anonymous visitor is a distinct viewer", async () => {
    expect(await viewer(req(), "visitor-1")).toMatchObject({ ok: true, kind: "anonymous", customer: { id: "anon_session-visitor-1" } });
  });
});
