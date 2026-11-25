import { describe, expect, it } from "vitest";
import {
  decideSweepHealth,
  isShadowSweepReadOnlyShop,
  shadowAgeBucket,
} from "./shadow-sweep-health";

const now = new Date("2026-11-25T00:00:00Z");

describe("shadowAgeBucket", () => {
  it("splits unpurchased shadows into the age bands", () => {
    expect(shadowAgeBucket(new Date("2026-11-24T20:00:00Z"), now)).toBe("under6h");
    expect(shadowAgeBucket(new Date("2026-11-24T12:00:00Z"), now)).toBe("h6to24");
    expect(shadowAgeBucket(new Date("2026-11-22T00:00:00Z"), now)).toBe("d1to7");
    expect(shadowAgeBucket(new Date("2026-11-10T00:00:00Z"), now)).toBe("over7d");
  });
});

describe("decideSweepHealth", () => {
  it("treats a missing or day-old sweep as stale", () => {
    expect(decideSweepHealth({
      now,
      lastSuccessAt: null,
      previousTotal: 2,
      previousGrew: false,
      total: 2,
    }).stale).toBe(true);
    expect(decideSweepHealth({
      now,
      lastSuccessAt: new Date("2026-11-23T23:00:00Z"),
      previousTotal: 2,
      previousGrew: false,
      total: 2,
    }).stale).toBe(true);
    expect(decideSweepHealth({
      now,
      lastSuccessAt: new Date("2026-11-24T01:00:00Z"),
      previousTotal: 2,
      previousGrew: false,
      total: 2,
    }).stale).toBe(false);
  });

  it("alerts only after the unpurchased count rises twice in a row", () => {
    const first = decideSweepHealth({
      now,
      lastSuccessAt: new Date("2026-11-24T22:00:00Z"),
      previousTotal: 4,
      previousGrew: false,
      total: 6,
    });
    expect(first.growing).toBe(false);
    expect(first.alert).toBe(false);
    const second = decideSweepHealth({
      now,
      lastSuccessAt: new Date("2026-11-24T22:00:00Z"),
      previousTotal: 6,
      previousGrew: true,
      total: 8,
    });
    expect(second.growing).toBe(true);
    expect(second.alert).toBe(true);
  });
});

describe("isShadowSweepReadOnlyShop", () => {
  it("keeps h7epay-gh read-only", () => {
    expect(isShadowSweepReadOnlyShop("h7epay-gh.myshopify.com")).toBe(true);
    expect(isShadowSweepReadOnlyShop("H7EPAY-GH.myshopify.com")).toBe(true);
    expect(isShadowSweepReadOnlyShop("h7epay-gh")).toBe(true);
    expect(isShadowSweepReadOnlyShop("petstage.myshopify.com")).toBe(false);
  });
});
