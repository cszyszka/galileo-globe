import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { clampZoom, dragBy } from './camera';
import type { ViewState } from './camera';

// Movement (px) before a press counts as a drag rather than a tap.
const DRAG_THRESHOLD_PX = 4;
// Zoom change per wheel delta unit (exponential, so zooming in and out feel symmetric).
const WHEEL_ZOOM_RATE = 0.0015;

// Pointer input for the globe: one pointer drags to rotate, two pointers pinch to zoom, and the
// wheel zooms. Pointer capture starts only once the pointer actually moves, so clicks on
// satellites still reach them. Returns the handlers to spread onto the <svg>.
export function useGlobePointer(
  svgRef: RefObject<SVGSVGElement | null>,
  viewRef: RefObject<ViewState>,
  onDragStart: () => void,
) {
  const pointers = useRef(new Map<number, [number, number]>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  // React's onWheel is passive, so preventDefault (to stop the page zooming) needs a native listener.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      viewRef.current.zoom = clampZoom(viewRef.current.zoom * Math.exp(-e.deltaY * WHEEL_ZOOM_RATE));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [svgRef, viewRef]);

  const pinchDist = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const v = viewRef.current;
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.current.size === 2) {
      // Second finger: switch from dragging to pinching.
      for (const id of pointers.current.keys()) {
        try { e.currentTarget.setPointerCapture(id); } catch { /* pointer already gone */ }
      }
      pinch.current = { dist: Math.max(1, pinchDist()), zoom: v.zoom };
      v.dragging = true; // pauses auto-rotate and keeps the lift-off from registering as a tap
    } else if (pointers.current.size === 1) {
      v.down = [e.clientX, e.clientY];
      v.lastXY = [e.clientX, e.clientY];
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const v = viewRef.current;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch.current && pointers.current.size >= 2) {
      v.zoom = clampZoom(pinch.current.zoom * (pinchDist() / pinch.current.dist));
      return;
    }
    if (!v.down || !v.lastXY) return; // hovering, not pressed
    if (!v.dragging) {
      if (Math.hypot(e.clientX - v.down[0], e.clientY - v.down[1]) < DRAG_THRESHOLD_PX) return;
      v.dragging = true;
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      onDragStart();
    }
    dragBy(v, e.clientX - v.lastXY[0], e.clientY - v.lastXY[1]);
    v.lastXY = [e.clientX, e.clientY];
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const v = viewRef.current;
    pointers.current.delete(e.pointerId);
    if (pinch.current && pointers.current.size < 2) {
      pinch.current = null;
      const rest = [...pointers.current.values()][0];
      // The remaining finger carries on as a drag, without a jump.
      if (rest) v.lastXY = [rest[0], rest[1]];
    }
    if (pointers.current.size > 0) return;
    v.wasDrag = v.dragging;
    v.dragging = false;
    v.down = null;
    v.lastXY = null;
  };

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };
}
