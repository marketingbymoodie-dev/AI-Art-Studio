import { afterEach, describe, expect, it, vi } from "vitest";
import { isEyeDropperSupported, openScreenEyeDropper } from "./openEyeDropper";

describe("openScreenEyeDropper", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function stubRafAsTimeout() {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
      window.setTimeout(() => cb(0), 0),
    );
  }

  it("returns null when EyeDropper is missing", async () => {
    vi.stubGlobal("EyeDropper", undefined);
    await expect(openScreenEyeDropper()).resolves.toBeNull();
    expect(isEyeDropperSupported()).toBe(false);
  });

  it("does not construct EyeDropper until after the click-yield", async () => {
    vi.useFakeTimers();
    stubRafAsTimeout();
    const open = vi.fn().mockResolvedValue({ sRGBHex: "#112233" });
    const ctor = vi.fn().mockImplementation(() => ({ open }));
    vi.stubGlobal("EyeDropper", ctor);

    const pending = openScreenEyeDropper();
    expect(ctor).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();
    await expect(pending).resolves.toBe("#112233");
    expect(ctor).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("reuses the in-flight open instead of stacking sessions", async () => {
    vi.useFakeTimers();
    stubRafAsTimeout();
    let release!: (value: { sRGBHex: string }) => void;
    const open = vi.fn(
      () =>
        new Promise<{ sRGBHex: string }>((resolve) => {
          release = resolve;
        }),
    );
    vi.stubGlobal(
      "EyeDropper",
      vi.fn().mockImplementation(() => ({ open })),
    );

    const first = openScreenEyeDropper();
    const second = openScreenEyeDropper();
    expect(second).toBe(first);

    await vi.runAllTimersAsync();
    release({ sRGBHex: "#abcdef" });
    await expect(first).resolves.toBe("#abcdef");
    await expect(second).resolves.toBe("#abcdef");
    expect(open).toHaveBeenCalledTimes(1);
  });
});
