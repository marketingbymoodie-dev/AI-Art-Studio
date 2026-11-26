import { describe, expect, it, vi } from "vitest";
import { scheduleWalletSettleRefresh } from "./walletSettleRefresh";

function run(results: Array<number | null>, statusFreeUsed: number | null) {
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const refresh = vi.fn(async () => results.shift() ?? null);
  scheduleWalletSettleRefresh({ refresh, statusFreeUsed, setTimer: (fn, ms) => timers.push({ fn, ms }) });
  return { timers, refresh };
}

async function flush(timers: Array<{ fn: () => void; ms: number }>) {
  for (let i = 0; i < timers.length; i++) {
    timers[i].fn();
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe("wallet refresh after generation completes", () => {
  it("refreshes once when the charge has already landed", async () => {
    const { timers, refresh } = run([1], 0);
    await flush(timers);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(timers.map((t) => t.ms)).toEqual([1500]);
  });

  it("retries once when the first read still shows the pre-charge value, then stops", async () => {
    const { timers, refresh } = run([0, 0], 0);
    await flush(timers);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(timers.map((t) => t.ms)).toEqual([1500, 5000]);
  });

  it("never polls beyond the second attempt, even on errors", async () => {
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const refresh = vi.fn(async () => {
      throw new Error("offline");
    });
    scheduleWalletSettleRefresh({ refresh, statusFreeUsed: 0, setTimer: (fn, ms) => timers.push({ fn, ms }) });
    await flush(timers);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
