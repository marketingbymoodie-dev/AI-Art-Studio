import { afterEach, describe, expect, it } from "vitest";
import crypto from "crypto";
import {
  credentialsForInstallHint,
  hmacBase64MatchesAnySecret,
  hmacHexMatchesAnySecret,
  listShopifyAppCredentials,
  matchAppByBase64Hmac,
  shopAcceptsApp,
  verifyOAuthQueryHmac,
} from "./shopify-app-credentials";

const PREV = {
  SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY,
  SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET,
  CREATOR_SHOPIFY_API_KEY: process.env.CREATOR_SHOPIFY_API_KEY,
  CREATOR_SHOPIFY_API_SECRET: process.env.CREATOR_SHOPIFY_API_SECRET,
  PETPOSTEROUS_SHOPIFY_API_KEY: process.env.PETPOSTEROUS_SHOPIFY_API_KEY,
  PETPOSTEROUS_SHOPIFY_API_SECRET: process.env.PETPOSTEROUS_SHOPIFY_API_SECRET,
};

afterEach(() => {
  for (const [k, v] of Object.entries(PREV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function clearPetposterous() {
  delete process.env.PETPOSTEROUS_SHOPIFY_API_KEY;
  delete process.env.PETPOSTEROUS_SHOPIFY_API_SECRET;
}

describe("listShopifyAppCredentials", () => {
  it("includes primary and clone when both env pairs are set and petposterous is unset", () => {
    process.env.SHOPIFY_API_KEY = "public-key";
    process.env.SHOPIFY_API_SECRET = "public-secret";
    process.env.CREATOR_SHOPIFY_API_KEY = "clone-key";
    process.env.CREATOR_SHOPIFY_API_SECRET = "clone-secret";
    clearPetposterous();
    const list = listShopifyAppCredentials();
    expect(list.map((c) => c.label)).toEqual(["primary", "creators"]);
    expect(list[1].apiKey).toBe("clone-key");
    expect(credentialsForInstallHint(null)?.label).toBe("primary");
    expect(credentialsForInstallHint("creators")?.label).toBe("creators");
    expect(credentialsForInstallHint("petposterous")).toBeNull();
  });

  it("adds petposterous only when its own env pair is set", () => {
    process.env.SHOPIFY_API_KEY = "public-key";
    process.env.SHOPIFY_API_SECRET = "public-secret";
    process.env.CREATOR_SHOPIFY_API_KEY = "clone-key";
    process.env.CREATOR_SHOPIFY_API_SECRET = "clone-secret";
    process.env.PETPOSTEROUS_SHOPIFY_API_KEY = "pet-key";
    process.env.PETPOSTEROUS_SHOPIFY_API_SECRET = "pet-secret";
    expect(listShopifyAppCredentials().map((c) => c.label)).toEqual(["primary", "creators", "petposterous"]);
    expect(credentialsForInstallHint("petposterous")?.apiKey).toBe("pet-key");
    expect(credentialsForInstallHint("creators")?.label).toBe("creators");
  });

  it("creators hint still falls back to primary when the clone env is unset", () => {
    process.env.SHOPIFY_API_KEY = "public-key";
    process.env.SHOPIFY_API_SECRET = "public-secret";
    delete process.env.CREATOR_SHOPIFY_API_KEY;
    delete process.env.CREATOR_SHOPIFY_API_SECRET;
    clearPetposterous();
    expect(credentialsForInstallHint("creators")?.label).toBe("primary");
    expect(credentialsForInstallHint(undefined)?.label).toBe("primary");
  });

  it("skips a clone pair that duplicates the public client id", () => {
    clearPetposterous();
    process.env.SHOPIFY_API_KEY = "same-key";
    process.env.SHOPIFY_API_SECRET = "public-secret";
    process.env.CREATOR_SHOPIFY_API_KEY = "same-key";
    process.env.CREATOR_SHOPIFY_API_SECRET = "other-secret";
    expect(listShopifyAppCredentials()).toHaveLength(1);
  });
});

describe("multi-app HMAC", () => {
  it("accepts a webhook signed with the clone secret", () => {
    process.env.SHOPIFY_API_KEY = "public-key";
    process.env.SHOPIFY_API_SECRET = "public-secret";
    process.env.CREATOR_SHOPIFY_API_KEY = "clone-key";
    process.env.CREATOR_SHOPIFY_API_SECRET = "clone-secret";
    const body = Buffer.from('{"id":1}', "utf8");
    const hmac = crypto.createHmac("sha256", "clone-secret").update(body).digest("base64");
    expect(hmacBase64MatchesAnySecret(body, hmac)).toBe(true);
  });

  it("a bound shop rejects a different app's secret", () => {
    process.env.SHOPIFY_API_KEY = "public-key";
    process.env.SHOPIFY_API_SECRET = "public-secret";
    process.env.CREATOR_SHOPIFY_API_KEY = "clone-key";
    process.env.CREATOR_SHOPIFY_API_SECRET = "clone-secret";
    process.env.PETPOSTEROUS_SHOPIFY_API_KEY = "pet-key";
    process.env.PETPOSTEROUS_SHOPIFY_API_SECRET = "pet-secret";
    const body = Buffer.from('{"id":1}', "utf8");
    const petHmac = crypto.createHmac("sha256", "pet-secret").update(body).digest("base64");
    const primaryHmac = crypto.createHmac("sha256", "public-secret").update(body).digest("base64");
    expect(matchAppByBase64Hmac(body, petHmac)?.label).toBe("petposterous");
    expect(shopAcceptsApp("primary", "petposterous")).toBe(false);
    expect(shopAcceptsApp("primary", matchAppByBase64Hmac(body, primaryHmac)!.label)).toBe(true);
    expect(shopAcceptsApp(null, "petposterous")).toBe(true);
    clearPetposterous();
    expect(hmacBase64MatchesAnySecret(body, petHmac)).toBe(false);
    expect(listShopifyAppCredentials().map((c) => c.label)).toEqual(["primary", "creators"]);
  });

  it("rejects an unknown secret", () => {
    process.env.SHOPIFY_API_KEY = "public-key";
    process.env.SHOPIFY_API_SECRET = "public-secret";
    delete process.env.CREATOR_SHOPIFY_API_KEY;
    delete process.env.CREATOR_SHOPIFY_API_SECRET;
    const hmac = crypto.createHmac("sha256", "nope").update("x").digest("hex");
    expect(hmacHexMatchesAnySecret("x", hmac)).toBe(false);
  });

  it("verifies OAuth query HMAC for either app", () => {
    process.env.SHOPIFY_API_KEY = "public-key";
    process.env.SHOPIFY_API_SECRET = "public-secret";
    process.env.CREATOR_SHOPIFY_API_KEY = "clone-key";
    process.env.CREATOR_SHOPIFY_API_SECRET = "clone-secret";
    const params = { shop: "aiartstudio-creators.myshopify.com", code: "abc", state: "s" };
    const message = Object.keys(params)
      .sort()
      .map((k) => `${k}=${(params as Record<string, string>)[k]}`)
      .join("&");
    const hmac = crypto.createHmac("sha256", "clone-secret").update(message).digest("hex");
    expect(verifyOAuthQueryHmac({ ...params, hmac })).toBe(true);
  });
});
