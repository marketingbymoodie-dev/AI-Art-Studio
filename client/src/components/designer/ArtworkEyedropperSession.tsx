import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  ARTWORK_EYEDROPPER_FOLLOW,
  ARTWORK_EYEDROPPER_LOUPE_CELLS,
  clampToRect,
  clientPointToSnapshotPixel,
  followArtworkPoint,
  sampleSnapshotHex,
  snapshotCanvasDisplay,
  type CanvasSnapshot,
} from "@/components/designer/openEyeDropper";

const LOUPE_PX = 132;

type ArtworkEyedropperSessionProps = {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  active: boolean;
  onPick: (hex: string) => void;
  onCancel: () => void;
};

/**
 * Instant artwork colour picker. Overlay paints on the first click; the
 * canvas snapshot runs after that so Chromium never blocks on a full-page
 * EyeDropper screenshot. Over the mockup the loupe follows with damping.
 */
export function ArtworkEyedropperSession({
  canvasRef,
  active,
  onPick,
  onCancel,
}: ArtworkEyedropperSessionProps) {
  const snapRef = useRef<CanvasSnapshot | null>(null);
  const sampleRef = useRef<{ x: number; y: number } | null>(null);
  const pointerRef = useRef({ x: 0, y: 0, inside: false });
  const insideRef = useRef(false);
  const hexRef = useRef<string | null>(null);
  const loupeRef = useRef<HTMLCanvasElement | null>(null);
  const hintRef = useRef<HTMLDivElement | null>(null);
  const swatchRef = useRef<HTMLSpanElement | null>(null);
  const hexLabelRef = useRef<HTMLSpanElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const onPickRef = useRef(onPick);
  const onCancelRef = useRef(onCancel);
  onPickRef.current = onPick;
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!active) {
      snapRef.current = null;
      sampleRef.current = null;
      insideRef.current = false;
      hexRef.current = null;
      return;
    }

    let cancelled = false;
    const paintLoupe = (hex: string | null, inside: boolean) => {
      const loupe = loupeRef.current;
      const snap = snapRef.current;
      const sample = sampleRef.current;
      const canvas = canvasRef.current;
      if (!loupe) return;
      const ctx = loupe.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, LOUPE_PX, LOUPE_PX);
      ctx.fillStyle = "#111827";
      ctx.fillRect(0, 0, LOUPE_PX, LOUPE_PX);

      if (inside && snap && sample && canvas) {
        const rect = canvas.getBoundingClientRect();
        const pix = clientPointToSnapshotPixel(sample.x, sample.y, rect, snap);
        if (pix) {
          const half = Math.floor(ARTWORK_EYEDROPPER_LOUPE_CELLS / 2);
          const cell = LOUPE_PX / ARTWORK_EYEDROPPER_LOUPE_CELLS;
          for (let dy = -half; dy <= half; dy += 1) {
            for (let dx = -half; dx <= half; dx += 1) {
              const sx = pix.x + dx;
              const sy = pix.y + dy;
              const color = sampleSnapshotHex(snap, sx, sy) ?? "#1f2937";
              ctx.fillStyle = color;
              ctx.fillRect((dx + half) * cell, (dy + half) * cell, cell + 0.5, cell + 0.5);
            }
          }
          ctx.strokeStyle = "rgba(255,255,255,0.18)";
          ctx.lineWidth = 1;
          for (let i = 1; i < ARTWORK_EYEDROPPER_LOUPE_CELLS; i += 1) {
            ctx.beginPath();
            ctx.moveTo(i * cell, 0);
            ctx.lineTo(i * cell, LOUPE_PX);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(0, i * cell);
            ctx.lineTo(LOUPE_PX, i * cell);
            ctx.stroke();
          }
          ctx.strokeStyle = "rgba(255,255,255,0.9)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(LOUPE_PX / 2, 10);
          ctx.lineTo(LOUPE_PX / 2, LOUPE_PX - 10);
          ctx.moveTo(10, LOUPE_PX / 2);
          ctx.lineTo(LOUPE_PX - 10, LOUPE_PX / 2);
          ctx.stroke();
        }
      }

      if (swatchRef.current) {
        swatchRef.current.style.backgroundColor = hex ?? "transparent";
        swatchRef.current.style.visibility = hex ? "visible" : "hidden";
      }
      if (hexLabelRef.current) {
        hexLabelRef.current.textContent = hex
          ? `${hex} · click to pick`
          : inside
            ? "…"
            : "Move the circle over the artwork";
      }
    };

    const placeChrome = (clientX: number, clientY: number) => {
      const loupe = loupeRef.current;
      const hint = hintRef.current;
      if (loupe) {
        const left = Math.min(
          window.innerWidth - LOUPE_PX - 8,
          Math.max(8, clientX - LOUPE_PX / 2),
        );
        const top = Math.min(
          window.innerHeight - LOUPE_PX - 8,
          Math.max(8, clientY - LOUPE_PX / 2),
        );
        loupe.style.left = `${left}px`;
        loupe.style.top = `${top}px`;
      }
      if (hint) {
        hint.style.left = `${Math.min(window.innerWidth - 240, Math.max(8, clientX - 100))}px`;
        hint.style.top = `${Math.min(window.innerHeight - 36, clientY + LOUPE_PX / 2 + 10)}px`;
      }
    };

    const tick = () => {
      const canvas = canvasRef.current;
      const pointer = pointerRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const inside = pointer.inside;
      insideRef.current = inside;

      if (inside) {
        const target = sampleRef.current
          ? followArtworkPoint(
              sampleRef.current.x,
              sampleRef.current.y,
              pointer.x,
              pointer.y,
              ARTWORK_EYEDROPPER_FOLLOW,
            )
          : { x: pointer.x, y: pointer.y };
        sampleRef.current = clampToRect(target.x, target.y, rect);
      } else {
        sampleRef.current = { x: pointer.x, y: pointer.y };
      }

      let hex: string | null = null;
      const snap = snapRef.current;
      if (inside && snap && sampleRef.current) {
        const pix = clientPointToSnapshotPixel(
          sampleRef.current.x,
          sampleRef.current.y,
          rect,
          snap,
        );
        hex = pix ? sampleSnapshotHex(snap, pix.x, pix.y) : null;
      }
      hexRef.current = hex;
      if (sampleRef.current) {
        placeChrome(sampleRef.current.x, sampleRef.current.y);
      }
      paintLoupe(hex, inside);
    };

    const onMove = (e: PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      pointerRef.current = {
        x: e.clientX,
        y: e.clientY,
        inside:
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom,
      };
    };

    const onUp = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest(
          '[aria-label="Eyedropper"], [aria-label="Pick colour from artwork"]',
        )
      ) {
        return;
      }
      if (insideRef.current && hexRef.current) {
        e.preventDefault();
        e.stopPropagation();
        onPickRef.current(hexRef.current);
        return;
      }
      onCancelRef.current();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancelRef.current();
      }
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("keydown", onKey);

    const snapSoon = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      snapRef.current = snapshotCanvasDisplay(canvas);
    };
    const snapId = window.requestAnimationFrame(snapSoon);

    let raf = 0;
    const loop = () => {
      if (cancelled) return;
      tick();
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(snapId);
      window.cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [active, canvasRef]);

  if (!active || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={overlayRef}
      data-testid="artwork-eyedropper-session"
      className="fixed inset-0 z-[80] cursor-none"
      style={{ touchAction: "none" }}
    >
      <canvas
        ref={loupeRef}
        width={LOUPE_PX}
        height={LOUPE_PX}
        className="pointer-events-none fixed rounded-full border-2 border-white shadow-lg"
        style={{ width: LOUPE_PX, height: LOUPE_PX, left: 8, top: 8 }}
        aria-hidden
      />
      <div
        ref={hintRef}
        className="pointer-events-none fixed flex items-center gap-1.5 rounded bg-black/75 px-2 py-1 text-[10px] font-medium text-white"
        style={{ left: 8, top: 148 }}
      >
        <span
          ref={swatchRef}
          className="h-3 w-3 rounded-sm border border-white/70"
          style={{ visibility: "hidden" }}
        />
        <span ref={hexLabelRef}>Move over artwork</span>
      </div>
    </div>,
    document.body,
  );
}
