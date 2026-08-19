import { describe, expect, it } from "vitest";
import { isDisposablePrintifyTitle } from "./printify-test-artifact-cleanup";

describe("isDisposablePrintifyTitle", () => {
  it("matches Preview Studio / cart test-order leftovers", () => {
    expect(
      isDisposablePrintifyTitle(
        "API Shopify flat-test-order:48:3edacba8-452b-429e-adb9-7ec438eec341:1787129304555 - AppAI Test",
      ),
    ).toBe(true);
    expect(isDisposablePrintifyTitle("API Shopify cart-test-order:abc:1")).toBe(true);
    expect(isDisposablePrintifyTitle("flat-test-order leftover")).toBe(true);
  });

  it("matches temp mockup and calibration products", () => {
    expect(isDisposablePrintifyTitle("Mockup Preview - 1710000000000")).toBe(true);
    expect(isDisposablePrintifyTitle("_cost_probe_1710000000000")).toBe(true);
    expect(isDisposablePrintifyTitle("__appai_calibration_1710000000000")).toBe(true);
    expect(isDisposablePrintifyTitle("__appai_mapper_blank_1710000000000")).toBe(true);
  });

  it("does not match merchant listings or saved designs", () => {
    expect(isDisposablePrintifyTitle("Custom Leopard Leggings")).toBe(false);
    expect(isDisposablePrintifyTitle("AppAI Studio Hoodie")).toBe(false);
    expect(isDisposablePrintifyTitle("My AppAI Test Drop")).toBe(false);
    expect(isDisposablePrintifyTitle("")).toBe(false);
  });
});
