import { describe, expect, it } from "vitest";
import { keepUsableTokenAfterRefreshFailure, offlineTokenFieldsFromPayload } from "./shopify-offline-token";

describe("keepUsableTokenAfterRefreshFailure", () => {
  const now = Date.parse("2026-11-24T21:00:00Z");

  it("keeps an access token that has not reached its stored expiry", () => {
    expect(keepUsableTokenAfterRefreshFailure({
      forceRefresh: false,
      expiresAt: "2026-11-24T21:10:00Z",
      hasAccessToken: true,
      now,
    })).toBe(true);
  });

  it("does not keep an expired token or a forced refresh", () => {
    expect(keepUsableTokenAfterRefreshFailure({
      forceRefresh: false,
      expiresAt: "2026-11-24T20:00:00Z",
      hasAccessToken: true,
      now,
    })).toBe(false);
    expect(keepUsableTokenAfterRefreshFailure({
      forceRefresh: true,
      expiresAt: "2026-11-24T21:10:00Z",
      hasAccessToken: true,
      now,
    })).toBe(false);
  });
});

describe("offlineTokenFieldsFromPayload", () => {
  it("maps expiring offline token response fields", () => {
    const before = Date.now();
    const fields = offlineTokenFieldsFromPayload({
      access_token: "shpat_abc",
      scope: "write_products",
      expires_in: 3600,
      refresh_token: "shprt_xyz",
      refresh_token_expires_in: 7776000,
    });
    const after = Date.now();

    expect(fields.accessToken).toBe("shpat_abc");
    expect(fields.refreshToken).toBe("shprt_xyz");
    expect(fields.scope).toBe("write_products");
    expect(fields.accessTokenExpiresAt!.getTime()).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(fields.accessTokenExpiresAt!.getTime()).toBeLessThanOrEqual(after + 3600 * 1000);
    expect(fields.refreshTokenExpiresAt!.getTime()).toBeGreaterThanOrEqual(before + 7776000 * 1000);
  });

  it("leaves expiry null for non-expiring responses", () => {
    const fields = offlineTokenFieldsFromPayload({
      access_token: "shpat_legacy",
      scope: "read_products",
    });
    expect(fields.refreshToken).toBeNull();
    expect(fields.accessTokenExpiresAt).toBeNull();
    expect(fields.refreshTokenExpiresAt).toBeNull();
  });
});
