import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';

// Matches the row's expand transition (.gg-expand in SatelliteGroups.css), so the scroll lands on
// the opened details rather than on where the row was before it grew.
const EXPAND_MS = 320;

// Brings the selected satellite's row into view once it has expanded — also when it was picked on
// the globe. Returns skipNext(), for a selection made somewhere the person is already looking
// (the visible list or the sky plot), where scrolling away would be disorienting.
export function useScrollToSelected(containerRef: RefObject<HTMLElement | null>, selectedId: string | null) {
  const skip = useRef(false);

  useEffect(() => {
    if (selectedId == null) return;
    if (skip.current) {
      skip.current = false;
      return;
    }
    const id = setTimeout(() => {
      containerRef.current?.querySelector(`[data-sat-id="${selectedId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, EXPAND_MS);
    return () => clearTimeout(id);
  }, [containerRef, selectedId]);

  return useCallback(() => { skip.current = true; }, []);
}
