import { describe, expect, it } from "vitest";
import {
  MIN_TRUSTED_VIEWPORT_PX,
  readTrustedViewport,
  resolveIsMobileViewport,
} from "./use-mobile";

describe("readTrustedViewport", () => {
  it("floors out sub-threshold innerWidth:2 so it cannot latch mobile", () => {
    expect(
      readTrustedViewport({
        innerWidth: 2,
        innerHeight: 800,
        visualViewport: undefined,
        document: { documentElement: { clientWidth: 2, clientHeight: 800 } },
      }),
    ).toBeNull();
    expect(
      readTrustedViewport({
        innerWidth: MIN_TRUSTED_VIEWPORT_PX - 1,
        innerHeight: MIN_TRUSTED_VIEWPORT_PX - 1,
        visualViewport: undefined,
      }),
    ).toBeNull();
  });

  it("trusts a real phone or desktop box", () => {
    expect(
      readTrustedViewport({
        innerWidth: 390,
        innerHeight: 844,
        visualViewport: undefined,
      }),
    ).toEqual({ width: 390, height: 844 });
    expect(
      readTrustedViewport({
        innerWidth: 1440,
        innerHeight: 900,
        visualViewport: undefined,
      }),
    ).toEqual({ width: 1440, height: 900 });
  });
});

describe("resolveIsMobileViewport", () => {
  it("flips both directions — shrink to mobile, grow back to desktop", () => {
    expect(
      resolveIsMobileViewport({ width: 390, height: 844 }, false),
    ).toBe(true);
    expect(
      resolveIsMobileViewport({ width: 1440, height: 900 }, true),
    ).toBe(false);
  });

  it("keeps the previous value on an untrusted 2px read", () => {
    expect(resolveIsMobileViewport(null, false)).toBe(false);
    expect(resolveIsMobileViewport(null, true)).toBe(true);
  });

  it("keeps a landscape phone on the mobile shell (width >= 768, short height)", () => {
    expect(
      resolveIsMobileViewport({ width: 844, height: 390 }, false),
    ).toBe(true);
  });

  it("releases tablet landscape / re-maximised desktop to the desktop layout", () => {
    expect(
      resolveIsMobileViewport({ width: 1180, height: 820 }, true),
    ).toBe(false);
    expect(
      resolveIsMobileViewport({ width: 1600, height: 960 }, true),
    ).toBe(false);
  });
});
