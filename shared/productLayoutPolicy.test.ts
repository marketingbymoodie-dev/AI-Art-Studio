import { describe, expect, it } from "vitest";
import {
  resolveStorefrontMockupMode,
  usesAopStorefrontCustomizer,
} from "./productLayoutPolicy";

describe("productLayoutPolicy — flat vs AOP exclusivity", () => {
  it("prefers flat on-the-fly over AOP title flag when calibrated", () => {
    const product = {
      isAllOverPrint: true,
      onTheFlyTier: "flat",
      printifyBlueprintId: 1007,
    };
    expect(resolveStorefrontMockupMode(product)).toBe("flat");
    expect(usesAopStorefrontCustomizer(product)).toBe(false);
  });

  it("keeps AOP customizer for uncalibrated AOP products", () => {
    const product = {
      isAllOverPrint: true,
      onTheFlyTier: null,
    };
    expect(resolveStorefrontMockupMode(product)).toBe("aop");
    expect(usesAopStorefrontCustomizer(product)).toBe(true);
  });

  it("folded tote stays flat even when a leftover AOP template is present", () => {
    const product = {
      isAllOverPrint: true,
      printifyBlueprintId: 1300,
      panelMappingTemplate: "unisex-zip-hoodie-aop-L",
    };
    expect(resolveStorefrontMockupMode(product)).toBe("flat");
    expect(usesAopStorefrontCustomizer(product)).toBe(false);
  });

  it("harvested flat tote stays flat even when a leftover AOP template is present", () => {
    const product = {
      isAllOverPrint: true,
      onTheFlyTier: "flat",
      printifyBlueprintId: 836,
      panelMappingTemplate: "unisex-zip-hoodie-aop-L",
    };
    expect(resolveStorefrontMockupMode(product)).toBe("flat");
    expect(usesAopStorefrontCustomizer(product)).toBe(false);
  });

  it("mesh-tier + panel template still uses the AOP customizer", () => {
    const product = {
      isAllOverPrint: true,
      onTheFlyTier: "mesh",
      panelMappingTemplate: "unisex-zip-hoodie-aop-L",
    };
    expect(resolveStorefrontMockupMode(product)).toBe("aop");
    expect(usesAopStorefrontCustomizer(product)).toBe(true);
  });

  it("explicit storefrontMockupMode=aop overrides flat tier", () => {
    const product = {
      isAllOverPrint: true,
      onTheFlyTier: "flat",
      storefrontMockupMode: "aop",
    };
    expect(resolveStorefrontMockupMode(product)).toBe("aop");
    expect(usesAopStorefrontCustomizer(product)).toBe(true);
  });
});
