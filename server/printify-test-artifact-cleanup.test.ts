import { describe, expect, it } from "vitest";
import {
  isDisposablePrintifyDescription,
  isDisposablePrintifyProduct,
  isDisposablePrintifyTitle,
  isImmediateTempTitle,
  isPrintifyProductPublished,
  isTestOrderTitle,
} from "./printify-test-artifact-cleanup";

describe("Printify temp product matchers", () => {
  it("matches Preview Studio / cart test-order leftovers", () => {
    expect(
      isTestOrderTitle(
        "API Shopify flat-test-order:48:3edacba8-452b-429e-adb9-7ec438eec341:1787129304555 - AppAI Test",
      ),
    ).toBe(true);
    expect(isDisposablePrintifyTitle("API Shopify cart-test-order:abc:1")).toBe(true);
    expect(isDisposablePrintifyTitle("flat-test-order leftover")).toBe(true);
  });

  it("matches temp mockup and calibration products", () => {
    expect(isImmediateTempTitle("Mockup Preview - 1780871644557")).toBe(true);
    expect(isImmediateTempTitle("_cost_probe_1710000000000")).toBe(true);
    expect(isImmediateTempTitle("__appai_calibration_1710000000000")).toBe(true);
    expect(isImmediateTempTitle("__appai_mapper_blank_1710000000000")).toBe(true);
  });

  it("matches our temp descriptions even if Printify shows a catalog title", () => {
    expect(
      isDisposablePrintifyProduct({
        title: "Unisex Heavy Blend™ Hooded Sweatshirt",
        description: "Temporary product for mockup generation",
        visible: false,
      }),
    ).toBe(true);
    expect(isDisposablePrintifyDescription("temp calibration product (auto-deleted)")).toBe(true);
  });

  it("does not match classic merchant listings", () => {
    expect(isDisposablePrintifyTitle("Unisex Heavy Blend™ Hooded Sweatshirt")).toBe(false);
    expect(
      isDisposablePrintifyProduct({
        title: "Unisex Heavy Blend™ Hooded Sweatshirt",
        description: "Soft fleece hoodie for our spring drop",
        visible: false,
      }),
    ).toBe(false);
    expect(isDisposablePrintifyTitle("Custom Leopard Leggings")).toBe(false);
    expect(isDisposablePrintifyTitle("My AppAI Test Drop")).toBe(false);
    expect(
      isPrintifyProductPublished({
        title: "Mockup Preview - 1",
        visible: true,
      }),
    ).toBe(true);
  });
});
