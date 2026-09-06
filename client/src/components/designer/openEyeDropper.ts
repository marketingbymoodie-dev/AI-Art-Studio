/**
 * Browser EyeDropper (Chromium). Preview-only — does not touch print/placement.
 *
 * Calling `open()` in the same turn as the click leaves the session armed
 * with no magnifier: Chromium screenshots the page (including the full-res
 * preview canvas) before it can paint the overlay. That sync readback is
 * the lag; leftover click/React work then blocks the overlay, so the next
 * click exits an invisible picker.
 *
 * Transient user activation lasts a few seconds, so we yield one frame + a
 * 0 ms timer, then open on a quiet main thread.
 */

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex?: string }> };

let inFlight: Promise<string | null> | null = null;

export function isEyeDropperSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { EyeDropper?: unknown }).EyeDropper === "function"
  );
}

function yieldForEyeDropperUi(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      window.setTimeout(resolve, 0);
    });
  });
}

export function openScreenEyeDropper(): Promise<string | null> {
  if (inFlight) return inFlight;
  if (!isEyeDropperSupported()) return Promise.resolve(null);

  const W = window as unknown as { EyeDropper?: EyeDropperCtor };
  if (!W.EyeDropper) return Promise.resolve(null);

  inFlight = (async () => {
    await yieldForEyeDropperUi();
    try {
      const ed = new W.EyeDropper();
      const r = await ed.open();
      return r?.sRGBHex ?? null;
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
