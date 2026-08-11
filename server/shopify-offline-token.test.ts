import { describe, expect, it } from "vitest";
import { offlineTokenFieldsFromPayload } from "./shopify-offline-token";

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
