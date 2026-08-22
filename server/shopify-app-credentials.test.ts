import { afterEach, describe, expect, it } from "vitest";
import crypto from "crypto";
import {
  hmacBase64MatchesAnySecret,
  hmacHexMatchesAnySecret,
  listShopifyAppCredentials,
  verifyOAuthQueryHmac,
} from "./shopify-app-credentials";

const PREV = {
  SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY,
  SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET,
  CREATOR_SHOPIFY_API_KEY: process.env.CREATOR_SHOPIFY_API_KEY,
  CREATOR_SHOPIFY_API_SECRET: process.env.CREATOR_SHOPIFY_API_SECRET,
};

afterEach(() => {
  for (const [k, v] of Object.entries(PREV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("listShopifyAppCredentials", () => {
  it("includes primary and clone when both env pairs are set", () => {
    process.env.SHOPIFY_API_KEY = "public-key";
    process.env.SHOPIFY_API_SECRET = "public-secret";
    process.env.CREATOR_SHOPIFY_API_KEY = "clone-key";
    process.env.CREATOR_SHOPIFY_API_SECRET = "clone-secret";
    const list = listShopifyAppCredentials();
    expect(list.map((c) => c.label)).toEqual(["primary", "creators"]);
    expect(list[1].apiKey).toBe("clone-key");
  });

  it("skips a clone pair that duplicates the public client id", () => {
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
