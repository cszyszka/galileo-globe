import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
// Country outlines are bundled as a static asset (loaded after the globe first renders).
import countriesUrl from 'world-atlas/countries-110m.json?url';
import {
  EARTH_RADIUS_KM,
  eciToLonLatR,
  footprintRadiusDeg,
  groundTrackRepeat,
  gstime,
  healthOf,
  isShown,
  lonLatRAt,
  sampleEarthFixed,
  sampleOrbit,
  subsolarPoint,
} from '../lib/satellites';
import type { LonLatR, Satellite, Vec3, Visibility } from '../lib/satellites';
import { elevationDeg, occluded, segment, toView, visiblePath } from '../lib/geometry';
import type { Observer, Rotate, Screen } from '../lib/geometry';
import type { SimClock } from '../hooks/useSimClock';
import { isEasing, stepCamera } from './camera';
import type { ViewState } from './camera';
import { createLayers, SAT_HIT_R } from './layers';
import type { Layers } from './layers';

// The d3 globe. It runs its own requestAnimationFrame loop outside React: React only hands it the
// current settings (getState) and hears back about clicks.

// Earth radius as a fraction of half the viewport — leaves room for the eccentric
// GSAT0201/0202 apogee (~5.1 Earth radii).
const FIT = 5.3;
const ATMOSPHERE_KM = 100;
// Orbit rings are sampled in inertial space, where they barely change, so a resample every
// 30 simulated minutes is plenty; between resamples they are just rotated by GMST.
const ORBIT_STEPS = 240;
const ORBIT_RESAMPLE_MS = 30 * 60000;
// The selected satellite's ground track (one orbit ahead). It starts at the satellite, so it is
// resampled often (real time) to keep its start under the marker.
const GROUND_TRACK_STEPS = 200;
const GROUND_TRACK_REFRESH_MS = 500;
// The 3D trace covers the ground-track repeat cycle, or this many orbits when there is none.
const TRACE_FALLBACK_ORBITS = 3;
const TRACE_STEPS_PER_ORBIT = 120;
const TRACE_RESAMPLE_MS = 30 * 60000;
// How often the globe redraws when nothing on it is visibly moving.
const IDLE_FRAME_MS = 500;
// Over the Earth's disc only the dot itself is a tap target (see drawSatellites).
const SAT_HIT_R_OVER_EARTH = 6;

// What the page tells the scene to show.
export interface SceneState {
  selectedId: string | null;
  showLabels: boolean;
  autoRotate: boolean;
  follow: boolean;
  visibility: Visibility;
  observer: Observer | null;
  mask: number;
  trace3d: boolean;
}

export interface SceneOptions {
  view: ViewState;
  clock: SimClock;
  getState: () => SceneState;
  onSatClick: (id: string) => void;
  onPlaceClick: (place: Observer) => void;
  onEmptyClick: () => void;
}

export interface GlobeScene {
  // Draw on the next frame even if nothing seems to be moving (call after changing the state).
  requestRedraw: () => void;
  // Last drawn Earth-fixed position of a satellite.
  positionOf: (id: string) => LonLatR | undefined;
  destroy: () => void;
}

type Country = GeoJSON.Feature<GeoJSON.Geometry, GeoJSON.GeoJsonProperties>;
type CountryPaths = d3.Selection<SVGPathElement, Country, SVGGElement, unknown>;

// Everything the draw steps need to know about the frame being drawn.
interface Frame {
  w: number;
  h: number;
  cx: number;
  cy: number;
  // Earth radius on screen (px).
  R: number;
  now: number;
  date: Date;
  gmst: number;
  sats: Satellite[];
  state: SceneState;
  rotate: Rotate;
  screen: Screen;
  pathGen: d3.GeoPath;
  // Earth-fixed positions of every satellite at `date`.
  pos: Record<string, LonLatR>;
  shown: (s: Satellite) => boolean;
  unusable: (s: Satellite) => boolean;
  // The selected satellite, if it is shown, and where it is.
  selected: { sat: Satellite; at: LonLatR } | null;
  // Drawing the selected satellite's 3D trace, which fades everything else further.
  tracing: boolean;
}

// Where each shown satellite lands on screen. `hidden` = behind the Earth's disc; `behind` = on the
// far side of the Earth's centre plane (its label is then clipped to outside the disc).
type ScreenPositions = Record<string, { xy: [number, number]; hidden: boolean; behind: boolean }>;

// Remembers one computed value, recomputing when its key changes or it gets older than `maxAgeMs`
// (measured on whichever clock the caller passes as `t`).
function createCache<T>(maxAgeMs: number) {
  let key: string | null = null;
  let at = 0;
  let value: T | undefined;
  return (k: string, t: number, compute: () => T): T => {
    if (value === undefined || k !== key || Math.abs(t - at) > maxAgeMs) {
      value = compute();
      key = k;
      at = t;
    }
    return value;
  };
}

// View-space point for an Earth-fixed position.
const viewOf = (rotate: Rotate, [lon, lat, r]: LonLatR): Vec3 => toView(rotate, lon, lat, r / EARTH_RADIUS_KM);

export function createGlobeScene(svgEl: SVGSVGElement, stageEl: HTMLElement, sats: Satellite[], opts: SceneOptions): GlobeScene {
  const { view: v, clock, getState } = opts;
  const layers = createLayers(svgEl, sats);
  const size = { w: 800, h: 800 };
  const proj = d3.geoOrthographic();
  const pathGen = d3.geoPath(proj);
  let mounted = true;
  let raf: number | null = null;
  // Set when something the scene shows has changed, so the next frame redraws even while idle.
  let redraw = true;
  let hoverId: string | null = null;
  let positions: Record<string, LonLatR> = {};
  // Screen geometry of the last frame, for hit-testing clicks.
  let geom: { cx: number; cy: number; R: number } | null = null;
  let land: CountryPaths | null = null;

  const orbitCache = createCache<Map<string, Vec3[]>>(ORBIT_RESAMPLE_MS);
  const trackCache = createCache<GeoJSON.LineString>(GROUND_TRACK_REFRESH_MS);
  const traceCache = createCache<LonLatR[]>(TRACE_RESAMPLE_MS);

  layers.satNodes
    .on('mouseenter', (_, d) => { hoverId = d.id; redraw = true; })
    .on('mouseleave', () => { hoverId = null; redraw = true; })
    .on('click', (e: MouseEvent, d) => {
      e.stopPropagation(); // not also a click on the Earth behind it
      opts.onSatClick(d.id);
    });

  fetch(countriesUrl)
    .then(r => r.json())
    .then((world: Topology) => {
      if (!mounted) return;
      const countries = topojson.feature(world, world.objects.countries as GeometryCollection);
      land = layers.landGroup.selectAll<SVGPathElement, Country>('path')
        .data(countries.features as Country[])
        .enter().append('path')
        .style('fill', 'var(--gg-land)').style('stroke', 'var(--gg-coast)').attr('stroke-width', 0.5);
      redraw = true;
    })
    .catch(() => { /* coastlines are decorative */ });

  const resize = () => {
    size.w = stageEl.clientWidth;
    size.h = stageEl.clientHeight;
    layers.svg.attr('viewBox', `0 0 ${size.w} ${size.h}`);
    redraw = true;
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(stageEl);

  // Redraw every frame while something is visibly moving: a drag or pinch, the camera easing,
  // auto-rotation, or sped-up time. Otherwise the satellites creep along so slowly that a few
  // redraws a second look the same and save a lot of work (and battery on phones).
  let drawnAt = -Infinity;
  let drawnZoom = v.zoom;
  const loop = (t: number) => {
    if (!mounted) return;
    raf = requestAnimationFrame(loop);
    const s = getState();
    const spinning = s.autoRotate && !(s.follow && s.selectedId != null);
    const moving = v.dragging || spinning || clock.speed() !== 1 || v.zoom !== drawnZoom || isEasing(v);
    if (!moving && !redraw && t - drawnAt < IDLE_FRAME_MS) return;
    redraw = false;
    drawnAt = t;
    drawnZoom = v.zoom;
    drawFrame();
  };

  const drawFrame = () => {
    const { w, h } = size;
    const cx = w / 2, cy = h / 2;
    const R = (Math.min(w, h) / 2 / FIT) * v.zoom;
    const now = clock.now();
    const date = new Date(now);
    const gmst = gstime(date);
    const state = getState();
    const unusable = (s: Satellite) => healthOf(s, state.visibility.statusData).category === 'bad';
    const shown = (s: Satellite) => isShown(s, state.visibility);

    // Current satellite positions (Earth-fixed lon/lat/radius)
    const pos: Record<string, LonLatR> = {};
    for (const s of sats) {
      const p = lonLatRAt(s, date, gmst);
      if (p) pos[s.id] = p;
    }
    positions = pos;

    const selSat = sats.find(s => s.id === state.selectedId && shown(s));
    const selected = selSat && pos[selSat.id] ? { sat: selSat, at: pos[selSat.id] } : null;

    // Camera first, so everything below is drawn from this frame's viewpoint.
    stepCamera(v, state.follow && selected ? [selected.at[0], selected.at[1]] : null, state.autoRotate);
    proj.scale(R).translate([cx, cy]).rotate(v.rot);
    geom = { cx, cy, R };

    const f: Frame = {
      w, h, cx, cy, R, now, date, gmst, sats, state, pathGen, pos, shown, unusable, selected,
      rotate: d3.geoRotation(v.rot),
      screen: p => [cx + R * p[0], cy - R * p[1]],
      tracing: state.trace3d && !!selSat,
    };
    drawEarth(layers, f, land);
    drawSelection(layers, f);
    drawOrbits(layers, f, orbitCache('', now, () => new Map(sats.map(s => [s.id, sampleOrbit(s, date, ORBIT_STEPS)]))));
    const screenPos = drawSatellites(layers, f, hoverId);
    drawNadirLine(layers, f, screenPos);
    drawObserver(layers, f);
  };

  // The selected satellite's coverage footprint, ground track and (optionally) 3D trace. Unlike the
  // other draw steps this one lives in the closure, because it keeps the sample caches.
  const drawSelection = (l: Layers, f: Frame) => {
    if (!f.selected) {
      l.footprint.attr('d', null);
      l.track.attr('d', null);
      l.traceRing.attr('d', null);
      return;
    }
    const { sat, at } = f.selected;
    l.footprint.attr('d', f.pathGen(d3.geoCircle().center([at[0], at[1]]).radius(footprintRadiusDeg(at[2], f.state.mask))()))
      .style('fill', sat.color).style('stroke', sat.color);

    const track = trackCache(sat.id, performance.now(), () => ({
      type: 'LineString',
      coordinates: sampleEarthFixed(sat, f.now, sat.periodMin * 60000, GROUND_TRACK_STEPS).map(([lon, lat]) => [lon, lat]),
    }));
    l.track.attr('d', f.pathGen(track)).style('stroke', sat.color);

    if (f.tracing) {
      // A whole repeat cycle shows the pattern the track settles into before it starts over.
      const orbitCount = groundTrackRepeat(sat.periodMin)?.orbits ?? TRACE_FALLBACK_ORBITS;
      const samples = traceCache(`${sat.id}:${orbitCount}`, f.now, () =>
        sampleEarthFixed(sat, f.now, orbitCount * sat.periodMin * 60000, orbitCount * TRACE_STEPS_PER_ORBIT));
      const pts = samples.map(p => viewOf(f.rotate, p));
      l.traceRing.attr('d', visiblePath(pts, f.screen) || null).style('stroke', sat.color);
    } else {
      l.traceRing.attr('d', null);
    }
  };

  raf = requestAnimationFrame(loop);

  // Click on the Earth picks an observer location; click on empty space deselects.
  layers.svg.on('click', (e: MouseEvent) => {
    if (v.wasDrag || !geom) return;
    const [x, y] = d3.pointer(e, svgEl);
    if (Math.hypot(x - geom.cx, y - geom.cy) <= geom.R) {
      const inv = proj.invert?.([x, y]);
      if (inv) opts.onPlaceClick({ lon: inv[0], lat: inv[1] });
    } else {
      opts.onEmptyClick();
    }
  });

  return {
    requestRedraw: () => { redraw = true; },
    positionOf: id => positions[id],
    destroy: () => {
      mounted = false;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      layers.svg.on('click', null);
    },
  };
}

// Atmosphere, ocean, graticule, land and the night side.
function drawEarth(l: Layers, f: Frame, land: CountryPaths | null) {
  const { cx, cy, R, w, h, pathGen } = f;
  const atmoR = R * (1 + ATMOSPHERE_KM / EARTH_RADIUS_KM);
  l.atmoGradient.attr('cx', cx).attr('cy', cy).attr('r', atmoR);
  l.atmoInner.attr('offset', R / atmoR);
  l.atmosphere.attr('cx', cx).attr('cy', cy).attr('r', atmoR);
  l.ocean.attr('cx', cx).attr('cy', cy).attr('r', R);
  // The whole viewport minus the Earth's disc (even-odd fill).
  l.behindClip.attr('d', `M0,0H${w}V${h}H0Z M${cx - R},${cy}a${R},${R} 0 1,0 ${2 * R},0a${R},${R} 0 1,0 ${-2 * R},0Z`);
  l.graticule.attr('d', pathGen(d3.geoGraticule10()));
  if (land) land.attr('d', d => pathGen(d));
  // Night is the hemisphere centred on the point opposite the Sun.
  const [sunLon, sunLat] = subsolarPoint(f.date);
  l.night.attr('d', pathGen(d3.geoCircle().center([sunLon + 180, -sunLat]).radius(90)()));
}

// Orbit rings — only the parts not hidden behind the Earth disk. The selected one is emphasised and
// the rest faded; non-usable satellites get dashed rings.
function drawOrbits(l: Layers, f: Frame, orbits: Map<string, Vec3[]>) {
  const { selectedId } = f.state;
  l.orbitPaths.each(function (s) {
    const pts = (orbits.get(s.id) ?? []).map(p => viewOf(f.rotate, eciToLonLatR(p, f.gmst)));
    const d = visiblePath(pts, f.screen);
    const isSel = s.id === selectedId;
    d3.select(this)
      .attr('d', f.shown(s) && d ? d : null)
      .attr('stroke-width', isSel ? 2 : 1)
      .attr('stroke-dasharray', f.unusable(s) ? '4 5' : null)
      .attr('stroke-opacity', isSel ? 0.95 : f.tracing ? 0.05 : selectedId != null ? 0.12 : 0.35);
  });
}

// Satellite markers and labels. Returns where each one landed for the steps that follow.
function drawSatellites(l: Layers, f: Frame, hoverId: string | null): ScreenPositions {
  const { selectedId, showLabels } = f.state;
  const screenPos: ScreenPositions = {};
  for (const s of f.sats) {
    const p = f.pos[s.id];
    if (!p || !f.shown(s)) continue;
    const vp = viewOf(f.rotate, p);
    screenPos[s.id] = { xy: f.screen(vp), hidden: occluded(vp), behind: vp[2] < 0 };
  }
  const visibleAt = (s: Satellite) => (screenPos[s.id] && !screenPos[s.id].hidden ? screenPos[s.id] : null);

  l.satNodes
    .attr('transform', s => { const sp = screenPos[s.id]; return sp ? `translate(${sp.xy[0]},${sp.xy[1]})` : null; })
    .attr('display', s => (visibleAt(s) ? null : 'none'))
    .attr('opacity', s => (selectedId == null || s.id === selectedId ? 1 : f.tracing ? 0.25 : 0.55));
  // Satellites not usable for service are drawn hollow
  l.satNodes.select('.dot')
    .style('fill', s => (f.unusable(s) ? 'var(--gg-bg)' : s.color))
    .style('stroke', s => (f.unusable(s) ? s.color : 'var(--gg-bg)'));
  l.satNodes.select('.ring').attr('display', s => (s.id === selectedId || s.id === hoverId ? null : 'none'));
  // Over the Earth's disc only the dot itself is a target, so low satellites (LEO-PNT, which
  // sit almost on the surface) don't swallow taps meant for picking a place on a small globe.
  l.satNodes.select('.hit').attr('r', s => {
    const sp = screenPos[s.id];
    return sp && Math.hypot(sp.xy[0] - f.cx, sp.xy[1] - f.cy) < f.R ? SAT_HIT_R_OVER_EARTH : SAT_HIT_R;
  });
  l.labels
    .attr('x', s => (screenPos[s.id] ? screenPos[s.id].xy[0] + 9 : 0))
    .attr('y', s => (screenPos[s.id] ? screenPos[s.id].xy[1] - 7 : 0))
    .attr('clip-path', s => (screenPos[s.id]?.behind ? 'url(#gg-behind-clip)' : null))
    .attr('display', s => (visibleAt(s) && (showLabels || s.id === selectedId || s.id === hoverId) ? null : 'none'));
  return screenPos;
}

// Line from the selected satellite down to its sub-satellite point. When that point is on the far
// side, the line still shows up to the Earth's edge.
function drawNadirLine(l: Layers, f: Frame, screenPos: ScreenPositions) {
  const sp = f.selected && screenPos[f.selected.sat.id];
  if (!f.selected || !sp || sp.hidden) {
    l.nadirLine.attr('display', 'none');
    return;
  }
  const { sat, at } = f.selected;
  const ground = toView(f.rotate, at[0], at[1], 1);
  const pts = segment(viewOf(f.rotate, at), ground);
  l.nadirLine.attr('display', null).attr('d', visiblePath(pts, f.screen) || null).style('stroke', sat.color);
}

// The observer on the ground, and lines of sight to every satellite above its elevation mask.
function drawObserver(l: Layers, f: Frame) {
  const { observer: obs, mask, selectedId } = f.state;
  const vo = obs ? toView(f.rotate, obs.lon, obs.lat, 1) : null;
  if (vo && vo[2] >= 0) {
    const [ox, oy] = f.screen(vo);
    l.observerMarker.attr('display', null).attr('transform', `translate(${ox},${oy})`);
  } else {
    l.observerMarker.attr('display', 'none');
  }
  l.sightLines.each(function (s) {
    const p = f.pos[s.id];
    let d: string | null = null;
    // Lines are drawn even when the observer is on the far side: the visible parts still show
    // which way the satellites are.
    if (vo && obs && p && f.shown(s) && elevationDeg(obs, p) >= mask) {
      d = visiblePath(segment(vo, viewOf(f.rotate, p)), f.screen) || null;
    }
    const isSel = s.id === selectedId;
    d3.select(this)
      .attr('d', d)
      .attr('stroke-opacity', isSel ? 0.95 : 0.45)
      .attr('stroke-width', isSel ? 1.6 : 0.9);
  });
}
