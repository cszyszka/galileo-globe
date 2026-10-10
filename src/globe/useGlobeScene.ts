import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { Satellite } from '../lib/satellites';
import type { SimClock } from '../hooks/useSimClock';
import { createView, lookAt as pointCamera } from './camera';
import { createGlobeScene } from './scene';
import type { GlobeScene, SceneOptions, SceneState } from './scene';

type Callbacks = Pick<SceneOptions, 'onSatClick' | 'onPlaceClick' | 'onEmptyClick'>;

// Mounts the d3 globe into `svgRef` and keeps it in step with React. The scene is rebuilt only
// when the satellite set changes; settings reach it through a ref, so toggling one doesn't tear
// down the SVG. `state` should be memoised, since every new object triggers a redraw.
export function useGlobeScene(
  svgRef: RefObject<SVGSVGElement | null>,
  stageRef: RefObject<HTMLElement | null>,
  sats: Satellite[],
  state: SceneState,
  clock: SimClock,
  callbacks: Callbacks,
) {
  // The camera outlives scene rebuilds, so new data doesn't reset the view.
  const viewRef = useRef(createView());
  const scene = useRef<GlobeScene | null>(null);
  const stateRef = useRef(state);
  const callbacksRef = useRef(callbacks);

  useEffect(() => {
    stateRef.current = state;
    scene.current?.requestRedraw();
  }, [state]);

  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  useEffect(() => {
    if (!sats.length || !svgRef.current || !stageRef.current) return;
    const s = createGlobeScene(svgRef.current, stageRef.current, sats, {
      view: viewRef.current,
      clock,
      getState: () => stateRef.current,
      onSatClick: id => callbacksRef.current.onSatClick(id),
      onPlaceClick: place => callbacksRef.current.onPlaceClick(place),
      onEmptyClick: () => callbacksRef.current.onEmptyClick(),
    });
    scene.current = s;
    return () => {
      s.destroy();
      scene.current = null;
    };
  }, [sats, clock, svgRef, stageRef]);

  const requestRedraw = useCallback(() => scene.current?.requestRedraw(), []);
  // Turn the globe to a satellite's current position.
  const lookAtSat = useCallback((id: string) => {
    const p = scene.current?.positionOf(id);
    if (p) pointCamera(viewRef.current, p[0], p[1]);
  }, []);
  const lookAt = useCallback((lon: number, lat: number) => pointCamera(viewRef.current, lon, lat), []);

  return { viewRef, requestRedraw, lookAt, lookAtSat };
}
