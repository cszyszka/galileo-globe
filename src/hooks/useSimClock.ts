import { useCallback, useMemo, useRef, useState } from 'react';

// The simulated clock. It runs at `speed` × real time from an anchor, so changing speed never
// makes the simulated time jump: the anchor moves to "now" at every change.
export interface SimClock {
  // Simulated time (ms since epoch).
  now: () => number;
  // Current speed, read without re-rendering (the animation loop polls it every frame).
  speed: () => number;
}

export function useSimClock() {
  const [speed, setSpeed] = useState(1);
  // useState rather than calling Date.now() during render, which must stay pure.
  const [startedAt] = useState(Date.now);
  const anchor = useRef({ real: startedAt, sim: startedAt, speed: 1 });

  const clock = useMemo<SimClock>(() => ({
    now: () => anchor.current.sim + (Date.now() - anchor.current.real) * anchor.current.speed,
    speed: () => anchor.current.speed,
  }), []);

  // `resetToNow` jumps back to the real time (the "Now" button).
  const changeSpeed = useCallback((s: number, resetToNow = false) => {
    const real = Date.now();
    anchor.current = { real, sim: resetToNow ? real : clock.now(), speed: s };
    setSpeed(s);
  }, [clock]);

  return { clock, speed, changeSpeed };
}
