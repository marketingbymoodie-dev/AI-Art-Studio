import { describe, expect, it } from "vitest";
import { decideUninstallCleanup } from "./uninstall-shipping-guard";

describe("decideUninstallCleanup", () => {
  it("skips when a refreshed token still reads the shop", () => {
    expect(decideUninstallCleanup({ tokenReady: true, needsReinstall: false, shopStatus: 200 })).toBe("skip");
  });

  it("does not confirm uninstall on an expired token that could not be refreshed", () => {
    expect(
      decideUninstallCleanup({
        tokenReady: false,
        needsReinstall: false,
        shopStatus: null,
      }),
    ).toBe("reauth");
  });

  it("confirms uninstall when the refresh token is rejected", () => {
    expect(decideUninstallCleanup({ tokenReady: false, needsReinstall: true, shopStatus: null })).toBe("confirm");
  });

  it("confirms uninstall when the shop rejects the token after refresh", () => {
    expect(decideUninstallCleanup({ tokenReady: true, needsReinstall: false, shopStatus: 401 })).toBe("confirm");
  });

  it("does not confirm uninstall on a network or credential failure", () => {
    expect(decideUninstallCleanup({ tokenReady: true, needsReinstall: false, shopStatus: 500 })).toBe("reauth");
    expect(decideUninstallCleanup({ tokenReady: true, needsReinstall: false, shopStatus: null })).toBe("reauth");
  });
});
