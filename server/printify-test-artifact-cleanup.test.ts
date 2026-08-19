import { describe, expect, it } from "vitest";
import {
  isDisposablePrintifyDescription,
  isDisposablePrintifyProduct,
  isDisposablePrintifyTitle,
  isImmediateTempTitle,
  isPrintifyProductPublished,
  isTestOrderTitle,
  leftoverReadyToDelete,
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

  it("deletes unpublished test-order products after 1 hour, not 7 days", () => {
    const now = new Date("2026-08-19T22:00:00.000Z");
    const twoHoursAgo = "2026-08-19T20:00:00.000Z";
    const thirtyMinAgo = "2026-08-19T21:30:00.000Z";
    expect(
      leftoverReadyToDelete(
        {
          title: "API Shopify cart-test-order:gid://shopify/Cart/abc",
          visible: false,
          created_at: twoHoursAgo,
        },
        now,
      ),
    ).toBe(true);
    expect(
      leftoverReadyToDelete(
        {
          title: "API Shopify flat-test-order:48:abc - AppAI Test",
          visible: false,
          created_at: thirtyMinAgo,
        },
        now,
      ),
    ).toBe(false);
    expect(
      leftoverReadyToDelete(
        {
          title: "API Shopify cart-test-order:gid://shopify/Cart/abc",
          visible: true,
          created_at: twoHoursAgo,
        },
        now,
      ),
    ).toBe(false);
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
