import { useCallback, useEffect, useRef } from "react";

/**
 * Raw two-pointer delta since gesture start — pure geometry, no clamping or
 * snapping. Callers apply their own existing scale clamp / rotation snap,
 * exactly as the single-finger corner-drag and rotate-handle paths already
 * do, so pinch/twist feels identical to those and never introduces new
 * bounds.
 */
export type TwoFingerDelta = {
  /** Multiplier vs. the distance between the two fingers at gesture start (1 = unchanged). */
  scaleRatio: number;
  /** Clockwise degrees turned vs. the two fingers' start angle. */
  rotateDeltaDeg: number;
};

type TrackedPointer = { x: number; y: number };

export type UseTwoFingerTransformOptions = {
  /**
   * Fired exactly once, the instant a 2nd concurrent pointer lands on the
   * tracked surface — use it to cancel any in-progress single-finger drag
   * (e.g. `dragRef.current = null`) so the two systems never run at once and
   * fight over the same onChange call.
   */
  onGestureStart: () => void;
  /** Fired on every move tick once 2 pointers are tracked. */
  onChange: (delta: TwoFingerDelta) => void;
  /** Fired once the gesture ends (a finger lifts, dropping below 2 tracked). */
  onGestureEnd?: () => void;
  disabled?: boolean;
};

/**
 * Two-finger pinch (scale) + twist (rotate) recognizer, additive to an
 * existing single-pointer drag/scale/rotate implementation. Shared by
 * `FlatDesignRectOverlay` (single-panel) and `DesignRectHandlesOverlay`
 * (multi-panel AOP Place mode) so both product types get identical pinch/
 * twist behaviour instead of two hand-rolled copies.
 *
 * Attach the returned `onPointerDown` to the SAME element that already
 * starts a single-finger translate drag, ahead of that logic:
 *
 *   const two = useTwoFingerTransform({ onGestureStart, onChange });
 *   <div onPointerDown={(e) => {
 *     if (two.onPointerDown(e)) return; // 2nd finger just armed/continued a pinch
 *     startDrag(e, "translate");
 *   }} />
 *
 * Tracking uses window-level pointermove/pointerup/pointercancel (the same
 * pattern the existing single-pointer drag code already uses) so a captured
 * first pointer's events still reach this hook — pointer capture retargets
 * the event, it doesn't stop it bubbling to `window`. A 3rd+ concurrent
 * pointer is ignored; the original two keep driving the gesture. Mouse
 * pointers never arm this (a mouse can't send two simultaneous pointers), so
 * desktop behaviour is completely unaffected.
 */
export function useTwoFingerTransform({
  onGestureStart,
  onChange,
  onGestureEnd,
  disabled = false,
}: UseTwoFingerTransformOptions) {
  const pointersRef = useRef<Map<number, TrackedPointer>>(new Map());
  const gestureRef = useRef<{ startDist: number; startAngleRad: number } | null>(null);

  // Latest callbacks in refs so the window-level listener (attached once)
  // never runs stale — mirrors the "read fresh from closure" intent the
  // existing overlays document, without needing an eslint-disable.
  const onGestureStartRef = useRef(onGestureStart);
  onGestureStartRef.current = onGestureStart;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onGestureEndRef = useRef(onGestureEnd);
  onGestureEndRef.current = onGestureEnd;

  const endGesture = useCallback(() => {
    const wasActive = !!gestureRef.current;
    pointersRef.current.clear();
    gestureRef.current = null;
    if (wasActive) onGestureEndRef.current?.();
  }, []);

  useEffect(() => {
    function firstTwo(): [TrackedPointer, TrackedPointer] | null {
      if (pointersRef.current.size < 2) return null;
      const it = pointersRef.current.values();
      const a = it.next().value as TrackedPointer;
      const b = it.next().value as TrackedPointer;
      return [a, b];
    }

    function onMove(e: PointerEvent) {
      if (!pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const gesture = gestureRef.current;
      const pts = firstTwo();
      if (!gesture || !pts) return;
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      const dist = Math.hypot(dx, dy);
      const angleRad = Math.atan2(dy, dx);
      const scaleRatio = gesture.startDist > 0 ? dist / gesture.startDist : 1;
      const rotateDeltaDeg = ((angleRad - gesture.startAngleRad) * 180) / Math.PI;
      onChangeRef.current({ scaleRatio, rotateDeltaDeg });
    }

    function onUp(e: PointerEvent) {
      if (!pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.delete(e.pointerId);
      // Ends the moment we drop below 2 fingers — never resumes a
      // single-finger translate from the remaining touch (avoids a jump); a
      // fresh pointerdown starts a normal translate drag as usual.
      if (pointersRef.current.size < 2) endGesture();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [endGesture]);

  /**
   * Attach to the translate surface's onPointerDown, ahead of any existing
   * single-finger drag start. Returns true when this pointerdown completed
   * (or continues) an armed 2-finger gesture — the caller should skip its
   * own single-finger drag-start logic for that pointer when true.
   */
  const onPointerDown = useCallback(
    (e: React.PointerEvent): boolean => {
      if (disabled || e.pointerType === "mouse") return false;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointersRef.current.size > 2) {
        // 3rd+ finger — do not disturb the already-armed gesture.
        pointersRef.current.delete(e.pointerId);
        return true;
      }
      if (pointersRef.current.size === 2 && !gestureRef.current) {
        const it = pointersRef.current.values();
        const a = it.next().value as TrackedPointer;
        const b = it.next().value as TrackedPointer;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        gestureRef.current = {
          startDist: Math.hypot(dx, dy),
          startAngleRad: Math.atan2(dy, dx),
        };
        e.preventDefault();
        onGestureStartRef.current();
        return true;
      }
      return pointersRef.current.size >= 2;
    },
    [disabled],
  );

  return { onPointerDown, endGesture };
}
