import { describe, expect, it } from "vitest";
import { mergeSavedCustomerEnabled } from "./mergeSavedCustomerEnabled";

describe("mergeSavedCustomerEnabled", () => {
  const base = {
    "front-body": true,
    "back-body": true,
    hood: true,
    "left-sleeve": true,
    "right-sleeve": true,
    trim: true,
  };

  it("does not inherit admin sleeve/trim defaults when saved omitted them", () => {
    const merged = mergeSavedCustomerEnabled(base, {
      "front-body": true,
      "back-body": true,
    });
    expect(merged["left-sleeve"]).toBe(false);
    expect(merged["right-sleeve"]).toBe(false);
    expect(merged.trim).toBe(false);
    expect(merged["front-body"]).toBe(true);
  });

  it("restores sleeves when the saved design had them on", () => {
    const merged = mergeSavedCustomerEnabled(base, {
      "front-body": true,
      "left-sleeve": true,
      "right-sleeve": true,
    });
    expect(merged["left-sleeve"]).toBe(true);
    expect(merged["right-sleeve"]).toBe(true);
  });

  it("turns both sleeves on if only one side was saved on", () => {
    const merged = mergeSavedCustomerEnabled(base, { "left-sleeve": true });
    expect(merged["left-sleeve"]).toBe(true);
    expect(merged["right-sleeve"]).toBe(true);
  });

  it("restores sleeves from the combined sleeves part key", () => {
    const merged = mergeSavedCustomerEnabled(base, { sleeves: true });
    expect(merged["left-sleeve"]).toBe(true);
    expect(merged["right-sleeve"]).toBe(true);
  });
});
