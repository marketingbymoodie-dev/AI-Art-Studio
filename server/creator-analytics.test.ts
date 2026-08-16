import { describe, expect, it } from "vitest";
import { isCreatorEventType, utcDayKey } from "./creator-analytics";

describe("creator-analytics helpers", () => {
  it("validates event types", () => {
    expect(isCreatorEventType("page_view")).toBe(true);
    expect(isCreatorEventType("generation")).toBe(true);
    expect(isCreatorEventType("nope")).toBe(false);
  });

  it("formats UTC day keys", () => {
    expect(utcDayKey(new Date("2026-08-12T01:00:00Z"))).toBe("2026-08-12");
  });
});
