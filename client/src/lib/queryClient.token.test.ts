import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, clearCachedShopifySessionToken } from "./queryClient";

afterEach(() => {
  clearCachedShopifySessionToken();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  delete (window as { shopify?: unknown }).shopify;
});

it("mints a new session token after a 401 instead of reusing the cached one", async () => {
  sessionStorage.setItem("shopify_shop", "h7epay-gh.myshopify.com");
  window.history.pushState({}, "", "/admin/catalogue-import");
  const tokens = ["token-a", "token-b"];
  (window as { shopify?: { idToken: () => Promise<string> } }).shopify = {
    idToken: () => Promise.resolve(tokens.shift() || "token-c"),
  };
  const seen: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    seen.push(new Headers(init?.headers).get("Authorization") || "");
    return new Response("{}", { status: seen.length === 1 ? 401 : 200, headers: { "Content-Type": "application/json" } });
  }));

  const res = await apiFetch("/api/platform/catalogue-studio/candidates/import/file", {
    method: "POST",
    body: "{}",
  });

  expect(res.status).toBe(200);
  expect(seen).toHaveLength(2);
  expect(seen[0]).toBe("Bearer token-a");
  expect(seen[1]).not.toBe("Bearer token-a");
});
