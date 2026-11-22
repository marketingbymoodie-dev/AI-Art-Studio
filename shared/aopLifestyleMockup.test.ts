import { describe, expect, it } from "vitest";
import {
  aopLifestyleMockupNotice,
  hasLocalAopFrontComposite,
  shouldKeepAopCartReadyOnPrintifyFailure,
} from "./aopLifestyleMockup";

describe("shouldKeepAopCartReadyOnPrintifyFailure", () => {
  it("keeps cart ready for AOP when a local front composite exists", () => {
    expect(
      shouldKeepAopCartReadyOnPrintifyFailure({
        useAopCustomizer: true,
        hasLocalFrontComposite: true,
      }),
    ).toBe(true);
  });

  it("still stales non-AOP Printify failures", () => {
    expect(
      shouldKeepAopCartReadyOnPrintifyFailure({
        useAopCustomizer: false,
        hasLocalFrontComposite: true,
      }),
    ).toBe(false);
  });

  it("still stales AOP when no local cart composite exists yet", () => {
    expect(
      shouldKeepAopCartReadyOnPrintifyFailure({
        useAopCustomizer: true,
        hasLocalFrontComposite: false,
      }),
    ).toBe(false);
  });
});

describe("hasLocalAopFrontComposite", () => {
  it("treats a hosted aopPatternUrl as the cart front", () => {
    expect(hasLocalAopFrontComposite({ aopPatternUrl: "https://cdn.example/front.jpg" })).toBe(
      true,
    );
  });

  it("treats placer base mockups as the cart front", () => {
    expect(
      hasLocalAopFrontComposite({
        aopPatternUrl: null,
        baseMockups: [{ url: "https://cdn.example/front.jpg" }],
      }),
    ).toBe(true);
  });

  it("is false when neither source is set", () => {
    expect(hasLocalAopFrontComposite({ aopPatternUrl: null, baseMockups: [] })).toBe(false);
    expect(hasLocalAopFrontComposite({})).toBe(false);
  });
});

describe("aopLifestyleMockupNotice", () => {
  it("prefers a failed lifestyle message over pending", () => {
    expect(aopLifestyleMockupNotice({ pending: true, error: "Aborted" })).toBe(
      "Lifestyle preview unavailable — cart uses your design.",
    );
  });

  it("shows a non-blocking pending line", () => {
    expect(aopLifestyleMockupNotice({ pending: true, error: null })).toBe(
      "Lifestyle preview still generating — you can add to cart.",
    );
  });

  it("is silent when idle", () => {
    expect(aopLifestyleMockupNotice({ pending: false, error: null })).toBeNull();
  });
});
