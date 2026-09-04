import { useEffect, useMemo, useRef } from "react";
import { RotateCw } from "lucide-react";

/** Screen-pixel snap radius for centering artwork on the print-area axes. */
const SNAP_SCREEN_PX = 10;
const ROTATION_SNAP_DEG = 4;
import {
  normalizeRotationDeg,
  type ArtworkPlacement,
} from "@/components/hoodie-template-mapper/lib/aopPreview";
import {
  flatArtBox,
  flatArtContentFractionsCached,
  flatVisibleRectPx,
  tapestryMaskOutlinePoints,
  FLAT_SCALE_MAX,
  FLAT_SCALE_MIN,
  type ArtContentFractions,
  type Rect,
} from "./lib/flatRender";
import type { FlatArtFit } from "@shared/hoodieTemplate";
import type { FlatViewCalibration } from "@/pages/embed-design";

/**
 * Self-contained drag/resize/rotate overlay for the flat-product placer.
 *
 * Mirrors the UX of the hoodie `DesignRectHandlesOverlay` (corner handles +
 * drag-to-move + bottom-right rotate, aspect locked) but works directly off
 * the flat manifest's visible-print-rect instead of a hoodie template. It also
 * paints a faint dashed guide for the printable area so customers can see when
 * their artwork doesn't fully cover it.
 *
 * Placement is stored normalized to the print rect (offset = fraction of rect
 * width/height; scale relative to the "cover" baseline) so it stays reusable
 * for print-file generation. Pointer math converts CSS-pixel deltas → mockup
 * px → normalized units, so it's accurate at any display size.
 */
export type FlatDesignRectOverlayProps = {
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  view: FlatViewCalibration;
  artwork: HTMLImageElement;
  placement: ArtworkPlacement;
  /** Phone cases / rigid edge-wrap products (not apparel). */
  edgeWrapMode?: boolean;
  /** Safe visible back-face guide in mockup px (edge-wrap inner dashed line). */
  innerGuideRect?: Rect | null;
  /** Full print canvas guide in mockup px (edge-wrap outer dashed line). */
  outerGuideRect?: Rect | null;
  /** Placement coordinate rect in mockup px (defaults to visible print rect). */
  placementRect?: Rect | null;
  /** 576 contain; default cover (241 / apparel / decor). */
  artFit?: FlatArtFit;
  /**
   * 241 droop mask: stroke this silhouette as the dashed print guide instead
   * of the AABB/letterbox rectangle. Placement math still uses placementRect.
   */
  guideMask?: HTMLImageElement | null;
  /**
   * Canvas bitmap size (blank px). Prefer this over reading canvasRef.width
   * during render — internal canvas resize does not re-render the overlay, so
   * falling back to mockupDims can desync guide % vs warning math.
   */
  mockupWidth?: number;
  mockupHeight?: number;
  /** Max placement scale (decor / edge-wrap allow zoom past 100%). */
  scaleMax?: number;
  /** Amber safe-zone guide (edge-wrap inner line). Default true. */
  showInnerGuide?: boolean;
  /** Blue print-canvas guide (edge-wrap outer line). Default auto when distinct from inner. */
  showOuterGuide?: boolean;
  onChange: (next: ArtworkPlacement) => void;
  /** Fired on drag/resize so the canvas backdrop can ignore the trailing click. */
  onDragActivity?: () => void;
};

export default function FlatDesignRectOverlay({
  canvasRef,
  view,
  artwork,
  placement,
  edgeWrapMode = false,
  innerGuideRect = null,
  outerGuideRect = null,
  placementRect = null,
  artFit = "cover",
  guideMask = null,
  mockupWidth,
  mockupHeight,
  scaleMax = FLAT_SCALE_MAX,
  showInnerGuide = true,
  showOuterGuide,
  onChange,
  onDragActivity,
}: FlatDesignRectOverlayProps) {
  const latestPlacementRef = useRef(placement);
  useEffect(() => {
    latestPlacementRef.current = placement;
  }, [placement]);

  const dragRef = useRef<
    | null
    | {
        mode: "translate" | "scale" | "rotate";
        startClientX: number;
        startClientY: number;
        startPlacement: ArtworkPlacement;
        canvasRect: DOMRect;
        rect: Rect;
        /** Full image box centre — the true rotation/scale origin. */
        center: { x: number; y: number };
        /** Opaque-content centre — what the handles visually track. */
        scaleCenter: { x: number; y: number };
        content: ArtContentFractions;
        startAngleRad?: number;
      }
  >(null);

  // Prefer parent-provided blank/canvas bitmap size (stable across renders).
  const mockupW =
    (mockupWidth && mockupWidth > 0 ? mockupWidth : 0) ||
    canvasRef.current?.width ||
    view.mockupDims?.width ||
    1;
  const mockupH =
    (mockupHeight && mockupHeight > 0 ? mockupHeight : 0) ||
    canvasRef.current?.height ||
    view.mockupDims?.height ||
    1;

  const artW = artwork.naturalWidth || artwork.width;
  const artH = artwork.naturalHeight || artwork.height;

  const rect = useMemo(() => {
    if (placementRect) return placementRect;
    if (edgeWrapMode && outerGuideRect) return outerGuideRect;
    return flatVisibleRectPx(view, mockupW, mockupH);
  }, [placementRect, edgeWrapMode, outerGuideRect, view, mockupW, mockupH]);

  const safeGuideRect = useMemo(() => {
    if (edgeWrapMode && innerGuideRect) return innerGuideRect;
    return rect;
  }, [edgeWrapMode, innerGuideRect, rect]);
  const maskOutline = useMemo(
    () =>
      !edgeWrapMode && guideMask
        ? tapestryMaskOutlinePoints(guideMask, mockupW, mockupH)
        : null,
    [edgeWrapMode, guideMask, mockupW, mockupH],
  );
  const box = useMemo(
    () => flatArtBox(rect, placement, artW, artH, artFit),
    [rect, placement, artW, artH, artFit],
  );

  // Opaque-content bounds: the visible ring/handles hug the artwork pixels,
  // not the (often transparent-padded) PNG rect. Falls back to the full image
  // when pixels are unreadable (cross-origin artwork without CORS).
  const contentFractions = useMemo(
    () => flatArtContentFractionsCached(artwork),
    [artwork],
  );
  const cf: ArtContentFractions =
    contentFractions ?? { left: 0, top: 0, width: 1, height: 1 };
  const contentBox = useMemo<Rect>(
    () => ({
      x: box.x + cf.left * box.width,
      y: box.y + cf.top * box.height,
      width: cf.width * box.width,
      height: cf.height * box.height,
    }),
    [box, cf.left, cf.top, cf.width, cf.height],
  );

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      onDragActivity?.();
      const sx = mockupW / drag.canvasRect.width;
      const sy = mockupH / drag.canvasRect.height;

      if (drag.mode === "translate") {
        const dxMock = (e.clientX - drag.startClientX) * sx;
        const dyMock = (e.clientY - drag.startClientY) * sy;
        const dOffX = drag.rect.width > 0 ? dxMock / drag.rect.width : 0;
        const dOffY = drag.rect.height > 0 ? dyMock / drag.rect.height : 0;
        const clamp = (v: number) => Math.max(-0.75, Math.min(0.75, v));
        const next = {
          ...drag.startPlacement,
          offsetX: clamp(drag.startPlacement.offsetX + dOffX),
          offsetY: clamp(drag.startPlacement.offsetY + dOffY),
        };
        latestPlacementRef.current = next;
        onChange(next);
        return;
      }

      const mx = (e.clientX - drag.canvasRect.left) * sx;
      const my = (e.clientY - drag.canvasRect.top) * sy;

      if (drag.mode === "rotate") {
        const angle = Math.atan2(my - drag.center.y, mx - drag.center.x);
        const startAngle = drag.startAngleRad ?? angle;
        const deltaDeg = ((angle - startAngle) * 180) / Math.PI;
        let rotationDeg = normalizeRotationDeg(
          (drag.startPlacement.rotationDeg ?? 0) + deltaDeg,
        );
        if (Math.abs(rotationDeg) <= ROTATION_SNAP_DEG) rotationDeg = 0;
        const next = { ...drag.startPlacement, rotationDeg };
        latestPlacementRef.current = next;
        onChange(next);
        return;
      }

      // Scale around the content centre (what the handles visually frame).
      // Aspect is locked, so derive the uniform scale from the pointer's
      // distance to the centre, against the content's cover-baseline half-dims.
      const halfW = Math.abs(mx - drag.scaleCenter.x);
      const halfH = Math.abs(my - drag.scaleCenter.y);
      const cover = Math.max(
        drag.rect.width / Math.max(1, artW),
        drag.rect.height / Math.max(1, artH),
      );
      const baseW = (artW * drag.content.width * cover) / 2;
      const baseH = (artH * drag.content.height * cover) / 2;
      // Pick whichever axis the pointer pushed proportionally further.
      const scaleFromW = baseW > 0 ? halfW / baseW : drag.startPlacement.scale;
      const scaleFromH = baseH > 0 ? halfH / baseH : drag.startPlacement.scale;
      let next = Math.max(scaleFromW, scaleFromH);
      next = Math.max(FLAT_SCALE_MIN, Math.min(scaleMax, next));
      onChange({ ...drag.startPlacement, scale: next });
    }
    function onUp() {
      const drag = dragRef.current;
      if (drag?.mode === "translate") {
        const cur = latestPlacementRef.current;
        const currentBox = flatArtBox(drag.rect, cur, artW, artH, artFit);
        const snapX = SNAP_SCREEN_PX * (mockupW / drag.canvasRect.width);
        const snapY = SNAP_SCREEN_PX * (mockupH / drag.canvasRect.height);
        const rectCx = drag.rect.x + drag.rect.width / 2;
        const rectCy = drag.rect.y + drag.rect.height / 2;
        // Snap the opaque content's centre — that's what customers perceive
        // as "the artwork" when the PNG carries transparent padding.
        const c = drag.content;
        const boxCx = currentBox.x + (c.left + c.width / 2) * currentBox.width;
        const boxCy = currentBox.y + (c.top + c.height / 2) * currentBox.height;
        // Offset that puts the content centre exactly on the rect centre
        // (0 when the PNG has no padding — matches the legacy behaviour).
        const centeredOffsetX =
          (-(c.left + c.width / 2 - 0.5) * currentBox.width) / drag.rect.width;
        const centeredOffsetY =
          (-(c.top + c.height / 2 - 0.5) * currentBox.height) / drag.rect.height;
        let offsetX = cur.offsetX;
        let offsetY = cur.offsetY;
        if (Math.abs(boxCx - rectCx) <= snapX) offsetX = centeredOffsetX;
        if (Math.abs(boxCy - rectCy) <= snapY) offsetY = centeredOffsetY;
        if (offsetX !== cur.offsetX || offsetY !== cur.offsetY) {
          const snapped = { ...cur, offsetX, offsetY };
          latestPlacementRef.current = snapped;
          onChange(snapped);
        }
      }
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
    // onChange is read fresh from closure each move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mockupW, mockupH, artW, artH, onChange, scaleMax]);

  const startDrag = (
    e: React.PointerEvent<HTMLDivElement>,
    mode: "translate" | "scale" | "rotate",
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const scaleCenter = {
      x: contentBox.x + contentBox.width / 2,
      y: contentBox.y + contentBox.height / 2,
    };
    let startAngleRad: number | undefined;
    if (mode === "rotate") {
      const sx = mockupW / canvasRect.width;
      const sy = mockupH / canvasRect.height;
      const mx = (e.clientX - canvasRect.left) * sx;
      const my = (e.clientY - canvasRect.top) * sy;
      startAngleRad = Math.atan2(my - center.y, mx - center.x);
    }
    dragRef.current = {
      mode,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPlacement: placement,
      canvasRect,
      rect,
      center,
      scaleCenter,
      content: cf,
      startAngleRad,
    };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };

  const pct = (r: Rect) => ({
    left: (r.x / mockupW) * 100,
    top: (r.y / mockupH) * 100,
    width: (r.width / mockupW) * 100,
    height: (r.height / mockupH) * 100,
  });
  const rectPct = pct(rect);
  const boxPct = pct(box);
  const outerPct = outerGuideRect ? pct(outerGuideRect) : null;
  const innerPct = pct(safeGuideRect);
  const guidesOverlap =
    outerPct &&
    Math.abs(innerPct.left - outerPct.left) < 0.5 &&
    Math.abs(innerPct.top - outerPct.top) < 0.5 &&
    Math.abs(innerPct.width - outerPct.width) < 0.5 &&
    Math.abs(innerPct.height - outerPct.height) < 0.5;
  const showOuterGuideLine =
    showOuterGuide ??
    (edgeWrapMode && !!outerPct && !guidesOverlap);

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

  // Root fills host sized to the canvas CSS box (see FlatProductPlacer).
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      data-testid="flat-rect-overlay"
    >
      {/* Full print canvas (edge-wrap outer guide). */}
      {showOuterGuideLine && outerPct && (
        <div
          className="pointer-events-none absolute border-2 border-dashed border-sky-400/95"
          style={{
            left: `${outerPct!.left}%`,
            top: `${outerPct!.top}%`,
            width: `${outerPct!.width}%`,
            height: `${outerPct!.height}%`,
            boxShadow: "0 0 0 1px rgba(0,0,0,0.35)",
          }}
          title="Full print area — artwork must cover this outline (includes edge bleed and side wrap)"
        />
      )}

      {showInnerGuide && maskOutline && maskOutline.length > 2 && (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${mockupW} ${mockupH}`}
          preserveAspectRatio="none"
          data-testid="flat-tapestry-mask-outline"
        >
          <polygon
            points={maskOutline.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="rgb(125 211 252 / 0.95)"
            strokeWidth={2}
            strokeDasharray="7 5"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            style={{ filter: "drop-shadow(0 0 1px rgba(0,0,0,0.55))" }}
          />
        </svg>
      )}

      {showInnerGuide &&
        !(maskOutline && maskOutline.length > 2) &&
        (edgeWrapMode ? safeGuideRect : rect) && (
      <div
        className={`pointer-events-none absolute border-2 border-dashed ${
          edgeWrapMode
            ? "border-amber-300/95"
            : "border-sky-300/95"
        }`}
        style={{
          left: `${innerPct.left}%`,
          top: `${innerPct.top}%`,
          width: `${innerPct.width}%`,
          height: `${innerPct.height}%`,
          // Solid contrast outline — mix-blend-difference was eating the top
          // edge on saturated garment colours so clipping looked "allowed".
          boxShadow: "0 0 0 1px rgba(0,0,0,0.45)",
        }}
        title={
          edgeWrapMode
            ? "Safe visible back face — extend artwork past this line for edge printing"
            : "Printable area"
        }
      />
      )}

      {/* Artwork bounding box with drag + corner-resize + rotate handles.
          Outer div = full image rect (invisible) so rotation happens around
          the true image centre; inner div hugs the opaque content, which is
          what the ring/handles frame. */}
      <div
        className="pointer-events-none absolute"
        style={{
          left: `${boxPct.left}%`,
          top: `${boxPct.top}%`,
          width: `${boxPct.width}%`,
          height: `${boxPct.height}%`,
          transform: placement.rotationDeg
            ? `rotate(${placement.rotationDeg}deg)`
            : undefined,
          transformOrigin: "50% 50%",
        }}
      >
        <div
          className="pointer-events-auto absolute select-none"
          style={{
            left: `${cf.left * 100}%`,
            top: `${cf.top * 100}%`,
            width: `${cf.width * 100}%`,
            height: `${cf.height * 100}%`,
          }}
          // Stop clicks from toggling the canvas backdrop; drag/resize uses
          // window pointerup (must not stopPropagation on pointerup or capture
          // retargeting prevents the global listener from ending the gesture).
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
              onPointerDown={(e) => startDrag(e, "scale")}
              style={{ ...cornerStyle(c), touchAction: "none" }}
              className="rounded-sm border-2 border-primary/40 bg-primary shadow-md hover:scale-110"
              title={`Drag corner to resize (aspect locked, max ${Math.round(scaleMax * 100)}%)`}
            />
          ))}
          <button
            type="button"
            onPointerDown={(e) => startDrag(e, "rotate")}
            className="absolute flex h-7 w-7 items-center justify-center rounded-full border-2 border-primary/50 bg-background text-primary shadow-md hover:scale-110"
            style={{
              right: -handleSize / 2 - 22,
              bottom: -handleSize / 2 - 22,
              touchAction: "none",
              cursor: "grab",
            }}
            title="Drag to rotate artwork"
            aria-label="Rotate artwork"
            data-testid="flat-rect-rotate-handle"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
