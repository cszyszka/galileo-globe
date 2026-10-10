import { useEffect, useState } from 'react';
import { computeReadouts } from '../lib/skyView';
import type { SatReadout } from '../lib/skyView';
import type { Observer } from '../lib/geometry';
import type { Satellite } from '../lib/satellites';
import type { SimClock } from './useSimClock';

// Text changes are hard to read faster than this, and React re-renders the whole panel each tick.
const READOUT_INTERVAL_MS = 400;

export interface Readout {
  // Simulated time of the last tick.
  time: Date;
  // Wall-clock time of the last tick, so render can compare against it without calling Date.now().
  now: number;
  bySat: Record<string, SatReadout>;
}

// Positions and look angles for the panel, refreshed a few times a second. The globe animates on
// its own loop; this is only for the text.
export function useReadout(sats: Satellite[], clock: SimClock, observer: Observer | null): Readout {
  const [readout, setReadout] = useState<Readout>(() => {
    const now = Date.now();
    return { time: new Date(now), now, bySat: {} };
  });

  useEffect(() => {
    if (!sats.length) return;
    const tick = () => {
      const date = new Date(clock.now());
      setReadout({ time: date, now: Date.now(), bySat: computeReadouts(sats, date, observer) });
    };
    tick();
    const id = setInterval(tick, READOUT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [sats, clock, observer]);

  return readout;
}
