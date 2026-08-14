import { describe, expect, it } from "vitest";
import {
  computeStyleVisibility,
  isAssignableCreatorScope,
} from "@shared/creatorMarketplace";

describe("creator style visibility", () => {
  it("storefront shows only assigned + available + enabled + catalog-active", () => {
    expect(
      computeStyleVisibility({ enabled: true, available: true, isActive: true }),
    ).toMatchObject({
      storefrontVisible: true,
      portalUnavailable: false,
    });
  });

  it("creator off hides from storefront but is not 'Currently Unavailable'", () => {
    const v = computeStyleVisibility({
      enabled: false,
      available: true,
      isActive: true,
    });
    expect(v.storefrontVisible).toBe(false);
    expect(v.portalUnavailable).toBe(false);
    expect(v.enabled).toBe(false);
  });

  it("operator retire greys portal regardless of enabled", () => {
    const on = computeStyleVisibility({
      enabled: true,
      available: false,
      isActive: true,
    });
    const off = computeStyleVisibility({
      enabled: false,
      available: false,
      isActive: true,
    });
    expect(on.portalUnavailable).toBe(true);
    expect(off.portalUnavailable).toBe(true);
    expect(on.storefrontVisible).toBe(false);
    expect(off.storefrontVisible).toBe(false);
    expect(on.enabled).toBe(true);
    expect(off.enabled).toBe(false);
  });

  it("catalog is_active=false is unavailable even if assignment is offered", () => {
    const v = computeStyleVisibility({
      enabled: true,
      available: true,
      isActive: false,
    });
    expect(v.currentlyAvailable).toBe(false);
    expect(v.portalUnavailable).toBe(true);
    expect(v.storefrontVisible).toBe(false);
  });

  it("no assignment row is not represented — visibility helper is only for existing rows", () => {
    // Intentionally no "default visible" path: unassigned styles never call this.
    expect(isAssignableCreatorScope("global")).toBe(true);
    expect(isAssignableCreatorScope("custom")).toBe(true);
    expect(isAssignableCreatorScope("merchant")).toBe(false);
    expect(isAssignableCreatorScope(null)).toBe(false);
  });
});
