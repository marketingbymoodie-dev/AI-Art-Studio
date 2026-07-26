import { useEffect, useMemo, useRef } from "react";
import type { HoodieTemplate, HoodieView } from "@shared/hoodieTemplate";
import {
  computeGroupRects,
  type ArtworkPlacement,
  type DesignRectInfo,
} from "./lib/aopPreview";

/**
 * Reusable design-rect drag/resize overlay for AOP placement UIs.
 *
 * The overlay sits `inset-0` over the AOP preview canvas and exposes
 * drag-to-translate + corner-drag-to-resize gestures bound to
 * `ArtworkPlacement`. Aspect ratio is locked — the rect always
 * reflects the artwork's natural shape (computed by
 * `computeDesignRect`), so corner drags only ever scale uniformly,
 * never squish.
 *
 * Coordinate model:
 *   - The overlay matches the canvas's display rect via inset-0, so a
 *     mockup-px point (mx, my) maps to CSS by `mx / mockupW * 100%`.
 *   - Drag gestures convert pointer-px deltas → mockup-px deltas via
 *     `mockupW / canvas.clientWidth` (and equivalent for Y), so the
 *     interaction stays accurate at any display size.
 *   - Scale gestures grow/shrink around the rect's centre at gesture
 *     start, matching the Scale slider — corner drags keep the
 *     centroid fixed while picking the bigger of the two pointer
 *     deltas to drive width (height is derived from the locked
 *     aspect).
 *
 * Used in two places today:
 *   - The admin AOP Preview Modal (this is where the component lived
 *     before extraction).
 *   - The customer-facing `HoodieAopPlacer` on the storefront, which
 *     opts into stronger snap behaviour via the `snapX` / `snapY`
 *     props for back-panel placement.
 */
export type DesignRectHandlesOverlayProps = {
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  template: HoodieTemplate;
  view: HoodieView;
  mockup: HTMLImageElement;
  artwork: HTMLImageElement;
  /** Which design group's rect we're showing handles for. */
  groupId: string;
  /** Effective placement (overrides → defaults) for the active group. */
  placement: ArtworkPlacement;
  /** Modal-local overrides — passed through so computeGroupRects sees them. */
  placementOverrides?: Record<string, Record<HoodieView, ArtworkPlacement>>;
  seamOverrides?: Record<string, number>;
  enabledOverrides?: Record<string, boolean>;
  /**
   * Forward-compat flag for "lock-ratio" behaviour. The renderer used
   * to scale around the anchor when this was true; today it always
   * scales around the rect centre because that matches the Scale
   * slider behaviour. Kept on the API so call-sites don't break.
   */
  lockedScaleAroundAnchor?: boolean;
  /**
   * Snap policy for the translate gesture. Determines which axes
   * snap the placement offset back to 0 when within {@link snapPx}.
   *
   * - `"seam"` (default): X snaps if the group's anchor is a fabric
   *   seam (zip / hood-opening). Matches what the admin modal has
   *   always done.
   * - `"x"`: always snap X regardless of anchor type.
   * - `"y"`: always snap Y.
   * - `"both"`: snap both axes — the customer placer uses this for
   *   the back-body group, which has no seam anchor but still wants
   *   centring snap.
   * - `"none"`: free drag, no snap.
   */
  snapMode?: "seam" | "x" | "y" | "both" | "none";
  /** Pixel threshold for the snap. Defaults to 3 mockup px. */
  snapPx?: number;
  /**
   * Invert horizontal drag (and report −ΔoffsetX). Needed when the mockup
   * panel is Printify-flipped so mouse left matches art moving left on-body.
   */
  invertOffsetX?: boolean;
  /**
   * When set, draw/drag this rect instead of computing from `groupId`
   * (e.g. union of both legs when Link sides is on).
   */
  rectOverride?: DesignRectInfo | null;
  /** Cap for corner-drag scale (matches Place slider). Omit = no max. */
  maxScale?: number;
  /** Patch the active group's placement (caller handles propagation). */
  onChange: (next: ArtworkPlacement) => void;
};

export default function DesignRectHandlesOverlay({
  canvasRef,
  template,
  view,
  mockup,
  artwork,
  groupId,
  placement,
  placementOverrides,
  seamOverrides,
  enabledOverrides,
  lockedScaleAroundAnchor = false,
  snapMode = "seam",
  snapPx = 3,
  invertOffsetX = false,
  rectOverride = null,
  maxScale,
  onChange,
}: DesignRectHandlesOverlayProps) {
  const info: DesignRectInfo | null = useMemo(() => {
    if (rectOverride) return rectOverride;
    const map = computeGroupRects(template, view, artwork, {
      placementOverrides,
      seamOverrides,
      enabledOverrides,
    });
    return map.get(groupId) ?? null;
  }, [
    template,
    view,
    artwork,
    groupId,
    placementOverrides,
    seamOverrides,
    enabledOverrides,
    rectOverride,
  ]);

  const mockupW = mockup.naturalWidth || mockup.width;
  const mockupH = mockup.naturalHeight || mockup.height;

  // Active drag state. We hold a snapshot of the placement + base
  // rect at gesture start so each pointermove computes deltas
  // against the start, never compounding rounding errors.
  const dragRef = useRef<
    | null
    | {
        mode: "translate" | "scale";
        corner?: "nw" | "ne" | "sw" | "se";
        startClientX: number;
        startClientY: number;
        startPlacement: ArtworkPlacement;
        startInfo: DesignRectInfo;
        canvasRect: DOMRect;
      }
  >(null);

  const invertXRef = useRef(invertOffsetX);
  invertXRef.current = invertOffsetX;

  // Cache snap policy in a ref so the global pointermove listener
  // sees the latest value without rebinding (which would drop a
  // gesture in flight).
  const snapRef = useRef({ snapMode, snapPx });
  snapRef.current = { snapMode, snapPx };

  const clientToMockup = (
    cx: number,
    cy: number,
    canvasRect: DOMRect,
  ): { x: number; y: number } => {
    const sx = mockupW / canvasRect.width;
    const sy = mockupH / canvasRect.height;
    return {
      x: (cx - canvasRect.left) * sx,
      y: (cy - canvasRect.top) * sy,
    };
  };

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const dxClient = e.clientX - drag.startClientX;
      const dyClient = e.clientY - drag.startClientY;
      const sx = mockupW / drag.canvasRect.width;
      const sy = mockupH / drag.canvasRect.height;
      const dxMock = dxClient * sx;
      const dyMock = dyClient * sy;

      if (drag.mode === "translate") {
        const xSign = invertXRef.current ? -1 : 1;
        let nextOffsetX = drag.startPlacement.offsetX + dxMock * xSign;
        let nextOffsetY = drag.startPlacement.offsetY + dyMock;
        const { snapMode: mode, snapPx: px } = snapRef.current;
        // Resolve snap policy → which axes snap right now.
        const wantSnapX =
          mode === "x" ||
          mode === "both" ||
          (mode === "seam" && drag.startInfo.anchorIsSeam);
        const wantSnapY = mode === "y" || mode === "both";
        if (wantSnapX && Math.abs(nextOffsetX) <= px) nextOffsetX = 0;
        if (wantSnapY && Math.abs(nextOffsetY) <= px) nextOffsetY = 0;
        onChange({
          ...drag.startPlacement,
          offsetX: nextOffsetX,
          offsetY: nextOffsetY,
        });
        return;
      }

      // Scale: corner handles grow/shrink around the rect centre.
      // Scale is derived from the gesture-start size × start placement
      // scale — NOT effective/base. Linked leg unions set base=effective
      // (already scaled), so newW/baseW snapped to ~1 on the first move.
      if (drag.mode === "scale") {
        const start = drag.startInfo.effective;
        const startW = Math.max(1, start.width);
        const startH = Math.max(1, start.height);
        const aspect = startW / startH;
        const centre = {
          x: start.x + startW / 2,
          y: start.y + startH / 2,
        };
        const m = clientToMockup(e.clientX, e.clientY, drag.canvasRect);
        const halfW = Math.abs(m.x - centre.x);
        const halfH = Math.abs(m.y - centre.y);
        let newW = halfW * 2;
        let newH = halfH * 2;
        if (newW / aspect > newH) {
          newH = newW / aspect;
        } else {
          newW = newH * aspect;
        }
        const startScale = Math.max(0.0001, drag.startPlacement.scale || 1);
        let newScale = startScale * (newW / startW);
        const minScale = 0.05;
        if (newScale < minScale) newScale = minScale;
        if (typeof maxScale === "number" && maxScale > 0 && newScale > maxScale) {
          newScale = maxScale;
        }
        onChange({
          scale: newScale,
          offsetX: drag.startPlacement.offsetX,
          offsetY: drag.startPlacement.offsetY,
        });
        // `lockedScaleAroundAnchor` is now redundant (we always
        // scale around centre), but kept on the API for forward
        // compatibility — referenced here so the linter knows it's
        // intentional.
        void lockedScaleAroundAnchor;
      }
    }
    function onUp() {
      dragRef.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // onChange is intentionally read fresh from closure each move —
    // we wire it via a stable ref above by re-binding the listener
    // on each change. Using state setter from props is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mockupW, mockupH, onChange, maxScale]);

  if (!info) return null;

  const startDrag = (
    e: React.PointerEvent<HTMLDivElement>,
    mode: "translate" | "scale",
    corner?: "nw" | "ne" | "sw" | "se",
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    dragRef.current = {
      mode,
      corner,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPlacement: placement,
      startInfo: info,
      canvasRect: canvas.getBoundingClientRect(),
    };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };

  const pctRect = {
    left: (info.effective.x / mockupW) * 100,
    top: (info.effective.y / mockupH) * 100,
    width: (info.effective.width / mockupW) * 100,
    height: (info.effective.height / mockupH) * 100,
  };

  const handleSize = 14;
  const cornerStyle = (
    corner: "nw" | "ne" | "sw" | "se",
  ): React.CSSProperties => {
    const isE = corner.includes("e");
    const isS = corner.includes("s");
    return {
      position: "absolute",
      width: handleSize,
      height: handleSize,
      [isE ? "right" : "left"]: -handleSize / 2,
      [isS ? "bottom" : "top"]: -handleSize / 2,
      cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize",
    } as React.CSSProperties;
  };

  return (
    // Clip hit-testing to the canvas display: enlarged artwork rects can
    // extend past the mockup and would otherwise cover nudge controls /
    // chrome below the preview.
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      data-testid="design-rect-overlay"
    >
      <div
        className="pointer-events-auto absolute select-none"
        style={{
          left: `${pctRect.left}%`,
          top: `${pctRect.top}%`,
          width: `${pctRect.width}%`,
          height: `${pctRect.height}%`,
        }}
        // Stop clicks on the rect from bubbling to the canvas backdrop
        // (which uses onClick to toggle overlay visibility in the
        // customer placer). Drag/resize gestures use onPointerDown
        // separately and are unaffected.
        onClick={(e) => e.stopPropagation()}
      >
        <div
          onPointerDown={(e) => startDrag(e, "translate")}
          className="absolute inset-0 cursor-move ring-2 ring-primary/70 transition hover:bg-primary/5"
          style={{ touchAction: "none" }}
          title="Drag to move artwork"
        />
        {(["nw", "ne", "sw", "se"] as const).map((c) => (
          <div
            key={c}
            onPointerDown={(e) => startDrag(e, "scale", c)}
            style={{ ...cornerStyle(c), touchAction: "none" }}
            className="rounded-sm border-2 border-primary/40 bg-primary shadow-md hover:scale-110"
            title="Drag corner to resize (aspect locked)"
          />
        ))}
      </div>
    </div>
  );
}
