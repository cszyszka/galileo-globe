import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react';

// On portrait phones the panel is a bottom sheet with three resting heights. The collapsed sheet
// shows just its header; the others are a share of the window height. Dragging the grip resizes it
// freely and lets go at the nearest resting height; a plain tap toggles it open or closed.
// (On larger screens the panel is a sidebar and the CSS ignores all of this.)

export type SheetSize = 'collapsed' | 'half' | 'full';

const SHEET_HALF = 0.52; // sheet heights as a share of the window height
const SHEET_FULL = 0.8;
const SIZES: readonly SheetSize[] = ['collapsed', 'half', 'full'];
// Movement (px) before a press on the grip counts as a drag rather than a tap.
const DRAG_THRESHOLD_PX = 6;

export function useBottomSheet(panelRef: RefObject<HTMLElement | null>, headRef: RefObject<HTMLElement | null>) {
  const [sheet, setSheet] = useState<SheetSize>('collapsed');
  // The sheet's height (px) mid-drag, otherwise null.
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const [headH, setHeadH] = useState(160);
  const grip = useRef<{ y: number; h: number; moved: boolean } | null>(null);

  // The collapsed sheet is exactly as tall as its header, which changes with the time-controls setting.
  useEffect(() => {
    const el = headRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const h = el.getBoundingClientRect().height;
      if (h > 0) setHeadH(Math.ceil(h) + 1); // 0 while the panel is hidden
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [headRef]);

  // Open the sheet if it is collapsed, but don't shrink a full one.
  const expand = useCallback(() => setSheet(prev => (prev === 'collapsed' ? 'half' : prev)), []);

  const sizePx = (which: SheetSize) =>
    which === 'collapsed' ? headH : which === 'half' ? Math.max(headH, window.innerHeight * SHEET_HALF) : window.innerHeight * SHEET_FULL;
  // Height the sheet would have with the pointer at clientY, kept between collapsed and full.
  const heightAt = (g: { y: number; h: number }, clientY: number) => Math.min(sizePx('full'), Math.max(headH, g.h + g.y - clientY));

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    grip.current = { y: e.clientY, h: panelRef.current?.getBoundingClientRect().height ?? headH, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const g = grip.current;
    if (!g) return;
    if (!g.moved && Math.abs(e.clientY - g.y) < DRAG_THRESHOLD_PX) return;
    g.moved = true;
    setDragHeight(heightAt(g, e.clientY));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const g = grip.current;
    grip.current = null;
    if (!g) return;
    if (!g.moved) {
      setSheet(prev => (prev === 'collapsed' ? 'half' : 'collapsed'));
    } else {
      const h = heightAt(g, e.clientY);
      const nearest = SIZES.reduce((best, k) => (Math.abs(sizePx(k) - h) < Math.abs(sizePx(best) - h) ? k : best));
      setSheet(nearest);
    }
    setDragHeight(null);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowUp') setSheet(sheet === 'collapsed' ? 'half' : 'full');
    if (e.key === 'ArrowDown') setSheet(sheet === 'full' ? 'half' : 'collapsed');
  };

  // CSS height for the sheet. The resting sizes use dvh so they follow the mobile browser's toolbars.
  const height = dragHeight != null
    ? `${dragHeight}px`
    : sheet === 'collapsed' ? `${headH}px` : sheet === 'half' ? `max(${headH}px, ${SHEET_HALF * 100}dvh)` : `${SHEET_FULL * 100}dvh`;

  return {
    sheet,
    setSheet,
    expand,
    height,
    dragging: dragHeight != null,
    gripProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onKeyDown },
  };
}
