import { describe, expect, it } from "vitest";
import { createOAuthState, verifyOAuthState } from "./shopify";

const SECRET = "test-shopify-oauth-secret";
const SHOP = "studio-demo.myshopify.com";

describe("OAuth state", () => {
  it("accepts a freshly signed state for the same shop", () => {
    const state = createOAuthState(SHOP, SECRET);
    expect(verifyOAuthState(state, SHOP, SECRET)).toBe(true);
  });

  it("rejects a state minted for a different shop", () => {
    const state = createOAuthState(SHOP, SECRET);
    expect(verifyOAuthState(state, "other.myshopify.com", SECRET)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const state = createOAuthState(SHOP, SECRET);
    expect(verifyOAuthState(`${state}x`, SHOP, SECRET)).toBe(false);
  });

  it("rejects an expired state", () => {
    const state = createOAuthState(SHOP, SECRET);
    const elevenMinutesLater = Date.now() + 11 * 60 * 1000;
    expect(verifyOAuthState(state, SHOP, SECRET, elevenMinutesLater)).toBe(false);
  });
});
