import { describe, expect, it } from "vitest";
import { flatFulfillmentDecision } from "./flat-fulfillment-gate";

describe("flatFulfillmentDecision", () => {
  it("submits only when the kill switch and the shop are both on", () => {
    expect(flatFulfillmentDecision("true", true)).toBe("submit");
  });

  it("the env flag stops every shop, including one that is on", () => {
    expect(flatFulfillmentDecision(undefined, true)).toBe("kill-switch");
    expect(flatFulfillmentDecision("false", true)).toBe("kill-switch");
    expect(flatFulfillmentDecision("", true)).toBe("kill-switch");
  });

  it("a shop defaults off while the kill switch is on", () => {
    expect(flatFulfillmentDecision("true", false)).toBe("shop-disabled");
  });
});
