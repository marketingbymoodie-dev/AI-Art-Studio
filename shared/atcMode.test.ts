import { describe, expect, it } from "vitest";
import { DEFAULT_ATC_MODE, normalizeAtcMode } from "./atcMode";

describe("normalizeAtcMode", () => {
  it("keeps known modes", () => {
    expect(normalizeAtcMode("base-first")).toBe("base-first");
    expect(normalizeAtcMode(" No-Shadow ")).toBe("no-shadow");
    expect(normalizeAtcMode("shadow-direct")).toBe("shadow-direct");
  });

  it("falls back to shadow-direct for anything else", () => {
    expect(DEFAULT_ATC_MODE).toBe("shadow-direct");
    for (const v of [undefined, null, "", "pooled", 1, {}]) {
      expect(normalizeAtcMode(v)).toBe("shadow-direct");
    }
  });
});
