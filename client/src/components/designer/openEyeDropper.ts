/**
 * Artwork eyedropper math (preview-only).
 *
 * Native EyeDropper.open() screenshots the full-res preview canvas on the
 * first click — that's the stall. We snapshot the *displayed* canvas once
 * after the loupe is already up, then sample from that buffer.
 */

export const ARTWORK_EYEDROPPER_FOLLOW = 0.18;
export const ARTWORK_EYEDROPPER_LOUPE_CELLS = 13;
export const ARTWORK_EYEDROPPER_SNAP_MAX_EDGE = 720;

export type CanvasSnapshot = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

export function hexFromRgb(r: number, g: number, b: number): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

export function snapshotCanvasDisplay(
  canvas: HTMLCanvasElement,
  maxLongEdge: number = ARTWORK_EYEDROPPER_SNAP_MAX_EDGE,
): CanvasSnapshot | null {
  const srcW = canvas.width;
  const srcH = canvas.height;
  if (srcW < 2 || srcH < 2) return null;

  const scale = Math.min(1, maxLongEdge / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));
  const off = document.createElement("canvas");
  off.width = width;
  off.height = height;
  const ctx = off.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(canvas, 0, 0, width, height);
  try {
    const img = ctx.getImageData(0, 0, width, height);
    return { data: img.data, width, height };
  } catch {
    return null;
  }
}

export function clientPointToSnapshotPixel(
  clientX: number,
  clientY: number,
  canvasRect: DOMRect,
  snap: CanvasSnapshot,
): { x: number; y: number } | null {
  if (canvasRect.width < 1 || canvasRect.height < 1) return null;
  const u = (clientX - canvasRect.left) / canvasRect.width;
  const v = (clientY - canvasRect.top) / canvasRect.height;
  if (u < 0 || v < 0 || u > 1 || v > 1) return null;
  const x = Math.min(snap.width - 1, Math.max(0, Math.floor(u * snap.width)));
  const y = Math.min(snap.height - 1, Math.max(0, Math.floor(v * snap.height)));
  return { x, y };
}

export function sampleSnapshotHex(
  snap: CanvasSnapshot,
  x: number,
  y: number,
): string | null {
  if (x < 0 || y < 0 || x >= snap.width || y >= snap.height) return null;
  const i = (y * snap.width + x) * 4;
  const a = snap.data[i + 3];
  if (a < 8) return null;
  return hexFromRgb(snap.data[i], snap.data[i + 1], snap.data[i + 2]);
}

/** Damped follow so the loupe settles on a pixel instead of skipping past it. */
export function followArtworkPoint(
  sampleX: number,
  sampleY: number,
  targetX: number,
  targetY: number,
  follow: number = ARTWORK_EYEDROPPER_FOLLOW,
): { x: number; y: number } {
  const t = Math.max(0, Math.min(1, follow));
  return {
    x: sampleX + (targetX - sampleX) * t,
    y: sampleY + (targetY - sampleY) * t,
  };
}

export function clampToRect(
  x: number,
  y: number,
  rect: { left: number; top: number; right: number; bottom: number },
): { x: number; y: number } {
  return {
    x: Math.min(rect.right - 0.5, Math.max(rect.left + 0.5, x)),
    y: Math.min(rect.bottom - 0.5, Math.max(rect.top + 0.5, y)),
  };
}
