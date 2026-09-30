/**
 * After a generation completes, the server charges the free generation just
 * after marking the job complete, so the status response can carry the
 * pre-charge wallet. Refresh the wallet shortly afterwards; retry once if the
 * charge has not landed yet. Display only — never polls indefinitely.
 */
export const WALLET_SETTLE_DELAYS_MS = [1500, 5000] as const;

export function scheduleWalletSettleRefresh(opts: {
  /** Re-reads the wallet; resolves to the server's freeGenerationsUsed (null if unknown). */
  refresh: () => Promise<number | null | undefined>;
  /** freeGenerationsUsed reported by the completion status. */
  statusFreeUsed: number | null | undefined;
  delays?: readonly number[];
  setTimer?: (fn: () => void, ms: number) => unknown;
}): void {
  const delays = opts.delays ?? WALLET_SETTLE_DELAYS_MS;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const attempt = (i: number) => {
    setTimer(() => {
      void opts
        .refresh()
        .then((freeUsed) => {
          const settled =
            typeof freeUsed === "number" &&
            (typeof opts.statusFreeUsed !== "number" || freeUsed > opts.statusFreeUsed);
          if (!settled && i + 1 < delays.length) attempt(i + 1);
        })
        .catch(() => {
          if (i + 1 < delays.length) attempt(i + 1);
        });
    }, delays[i]);
  };
  if (delays.length) attempt(0);
}
