import { describe, expect, it } from "vitest";
import {
  catalogStyleBackgroundDefaults,
  persistDefaultBackgroundColor,
  persistBackgroundSelectorEnabled,
  resolveStyleBackgroundConfig,
} from "./styleBackgroundConfig";

const decorFramed = {
  designerType: "framed-print",
  isApparelProduct: false,
};

describe("catalogStyleBackgroundDefaults", () => {
  it("turns Watercolor selector on with white default", () => {
    expect(catalogStyleBackgroundDefaults("watercolor")).toEqual({
      backgroundSelectorEnabled: true,
      defaultBackgroundColor: "#FFFFFF",
      backgroundRequired: null,
    });
  });

  it("turns Free 4 All selector on with transparent default", () => {
    expect(catalogStyleBackgroundDefaults("free-4-all")).toEqual({
      backgroundSelectorEnabled: true,
      defaultBackgroundColor: "none",
      backgroundRequired: null,
    });
  });

  it("leaves other styles on inherit (null)", () => {
    expect(catalogStyleBackgroundDefaults("oil-painting").backgroundSelectorEnabled).toBeNull();
    expect(catalogStyleBackgroundDefaults("centered-graphic").backgroundSelectorEnabled).toBeNull();
  });
});

describe("resolveStyleBackgroundConfig", () => {
  it("shows Watercolor on framed-print with white default (no floating required)", () => {
    const r = resolveStyleBackgroundConfig(
      { catalogSlug: "watercolor" },
      { ...decorFramed, catalogSlug: "watercolor" },
      null,
    );
    expect(r.visible).toBe(true);
    expect(r.defaultFill).toBe("#FFFFFF");
    expect(r.unusualCombo).toBe(true);
  });

  it("shows Free 4 All with transparent default", () => {
    const r = resolveStyleBackgroundConfig(
      { catalogSlug: "free-4-all" },
      { designerType: "generic", catalogSlug: "free-4-all" },
      null,
    );
    expect(r.visible).toBe(true);
    expect(r.defaultFill).toBeNull();
    expect(r.defaultRaw).toBe("none");
  });

  it("keeps floating decor picker on when config is inherit", () => {
    const r = resolveStyleBackgroundConfig(
      { catalogSlug: "centered-graphic", outputMode: "floating" },
      {
        designerType: "framed-print",
        catalogSlug: "centered-graphic",
        outputMode: "floating",
      },
      null,
    );
    expect(r.visible).toBe(true);
    expect(r.defaultFill).toBe("#FFFFFF");
  });

  it("keeps apparel / AOP inherit off for floating styles", () => {
    const apparel = resolveStyleBackgroundConfig(
      { catalogSlug: "centered-graphic", outputMode: "floating" },
      {
        designerType: "apparel",
        catalogSlug: "centered-graphic",
        outputMode: "floating",
      },
      null,
    );
    expect(apparel.visible).toBe(false);
    const aop = resolveStyleBackgroundConfig(
      { catalogSlug: "watercolor", backgroundSelectorEnabled: true },
      {
        designerType: "all-over-print",
        useAopCustomizer: true,
        catalogSlug: "watercolor",
      },
      null,
    );
    expect(aop.visible).toBe(false);
  });

  it("honors explicit off even for Watercolor", () => {
    const r = resolveStyleBackgroundConfig(
      { catalogSlug: "watercolor", backgroundSelectorEnabled: false },
      { ...decorFramed, catalogSlug: "watercolor" },
      null,
    );
    expect(r.visible).toBe(false);
  });

  it("lets a future merchant override win without changing the style row", () => {
    const r = resolveStyleBackgroundConfig(
      { catalogSlug: "watercolor", backgroundSelectorEnabled: true, defaultBackgroundColor: "#FFFFFF" },
      { ...decorFramed, catalogSlug: "watercolor" },
      { backgroundSelectorEnabled: false, defaultBackgroundColor: "none" },
    );
    expect(r.visible).toBe(false);
    expect(r.defaultRaw).toBe("none");
  });
});

describe("persist helpers", () => {
  it("normalizes hex and none", () => {
    expect(persistDefaultBackgroundColor("#ff00aa")).toBe("#FF00AA");
    expect(persistDefaultBackgroundColor("none")).toBe("none");
    expect(persistDefaultBackgroundColor(null)).toBeNull();
    expect(persistBackgroundSelectorEnabled("auto")).toBeNull();
    expect(persistBackgroundSelectorEnabled(true)).toBe(true);
  });
});
