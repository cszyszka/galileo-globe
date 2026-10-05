import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { eciToGeodetic, eciToEcf, ecfToLookAngles } from 'satellite.js';
// Country outlines are bundled as a static asset (loaded after the globe first renders).
import countriesUrl from 'world-atlas/countries-110m.json?url';
import {
  EARTH_RADIUS_KM,
  SOURCES,
  LAYERS,
  GROUP_NAMES,
  GROUP_COLORS,
  loadTle,
  loadGalileoStatus,
  loadDataMeta,
  statusCategory,
  STATUS_COLORS,
  parseTle,
  sortSats,
  eciAt,
  sampleOrbit,
  eciToLonLatR,
  gstime,
  subsolarPoint,
  footprintRadiusDeg,
} from '../lib/satellites';
import type { Constellation, Satellite, StatusCategory, GalileoStatus, GalileoStatusEntry, LonLatR, Vec3, LayerKey } from '../lib/satellites';
import type { Topology, GeometryCollection } from 'topojson-specification';
import SkyPlot from './SkyPlot';
import { ErrorNotice, Legend, LoadingNotice, StaleBanner } from './StageNotices';
import TimeControls from './TimeControls';
import { readFlag, writeFlag } from '../lib/storage';
import './GalileoGlobe.css';

// Earth radius as a fraction of half the viewport — leaves room for the eccentric
// GSAT0201/0202 apogee (~5.1 Earth radii).
const FIT = 5.3;
const DEG = Math.PI / 180;
const ATMOSPHERE_KM = 100;
const ORBIT_STEPS = 240;
const ORBIT_RESAMPLE_MS = 30 * 60000;
const SPEEDS = [1, 60, 600, 3600];
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
// Auto-rotation, in degrees of longitude per frame.
const AUTO_ROTATE_STEP = 0.08 / 3;
// How often an open page re-reads the data files (they're refreshed on the server every ~2 h).
const DATA_RELOAD_MS = 30 * 60000;
// Show a warning when orbit data is older than this (the scheduled refresh has stopped working).
const STALE_DATA_MS = 12 * 3600000;
const ELEVATION_MASKS = [0, 5, 10, 15];
const SHOW_TIME_KEY = 'gg-show-time';
const SHEET_HALF = 0.52; // sheet heights as a share of the window height
const SHEET_FULL = 0.8;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

interface Observer { lon: number; lat: number }

interface Health {
  category: StatusCategory;
  label: string;
  note?: string;
  // The GSC row (Galileo only).
  info?: GalileoStatusEntry;
}

interface Look { el: number; az: number; range: number; rising: boolean }
interface SatReadout { lat: number; lon: number; alt: number; speed: number; look?: Look }

interface SourceState {
  ok: boolean;
  fetchedAt?: string | null;
  refreshError?: string | null;
  message?: string;
}

interface LoadMeta { status: 'loading' | 'ready' | 'error'; sources: Record<string, SourceState> }
interface StatusState { state: 'loading' | 'ready' | 'error'; data: GalileoStatus | null; message?: string }

interface UiState {
  selectedId: string | null;
  hoverId: string | null;
  showLabels: boolean;
  autoRotate: boolean;
  follow: boolean;
  visible: Record<string, boolean>;
  statusData: GalileoStatus | null;
  showUnusable: boolean;
  observer: Observer | null;
  mask: number;
}

interface ViewState {
  rot: Vec3;
  tgt: Vec3;
  zoom: number;
  dragging: boolean;
  wasDrag: boolean;
  down: [number, number] | null;
  lastXY: [number, number] | null;
}

type Country = GeoJSON.Feature<GeoJSON.Geometry, GeoJSON.GeoJsonProperties>;
type Rotate = (p: [number, number]) => [number, number];
type Screen = (p: Vec3) => [number, number];

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// Service status for a satellite; `info` is the GSC row (Galileo only).
function healthOf(sat: Satellite, statusData: GalileoStatus | null): Health {
  if (sat.constellation !== 'galileo') {
    return { category: 'unknown', label: 'Demonstrator', note: 'In-orbit demonstrator — no public service status' };
  }
  if (!statusData) return { category: 'unknown', label: 'Unknown', note: 'Service status unavailable' };
  const info = statusData.satellites[sat.short];
  if (!info) return { category: 'unknown', label: 'Not listed', note: 'Not listed by the GNSS Service Centre' };
  return { category: statusCategory(info.status), label: info.status, info };
}

// Rotated unit-sphere cartesian for a lon/lat, scaled by radius (in Earth radii).
function toView(rotate: Rotate, lon: number, lat: number, r: number): Vec3 {
  const [l, p] = rotate([lon, lat]);
  const cp = Math.cos(p * DEG);
  return [r * cp * Math.sin(l * DEG), r * Math.sin(p * DEG), r * cp * Math.cos(l * DEG)];
}

const occluded = ([x, y, z]: Vec3) => z < 0 && x * x + y * y < 1;
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Point on segment a→b where visibility flips (a and b have different visibility).
function limbCrossing(a: Vec3, b: Vec3): Vec3 {
  let lo = 0, hi = 1;
  const aHidden = occluded(a);
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    if (occluded(lerp3(a, b, mid)) === aHidden) lo = mid;
    else hi = mid;
  }
  return lerp3(a, b, (lo + hi) / 2);
}

// SVG path through view-space points, skipping the parts hidden behind the Earth disk.
function visiblePath(pts: Vec3[], screen: Screen): string {
  let d = '';
  let penDown = false;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const hidden = occluded(p);
    if (i > 0 && hidden !== occluded(pts[i - 1])) {
      const [x, y] = screen(limbCrossing(pts[i - 1], p));
      d += (penDown ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1);
      penDown = !hidden;
    }
    if (!hidden) {
      const [x, y] = screen(p);
      d += (penDown ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1);
      penDown = true;
    }
  }
  return d;
}

const ecef = (lon: number, lat: number, r = 1): Vec3 => {
  const cl = Math.cos(lat * DEG);
  return [r * cl * Math.cos(lon * DEG), r * cl * Math.sin(lon * DEG), r * Math.sin(lat * DEG)];
};

// Elevation (deg) of a satellite at [lon, lat, radiusKm] above an observer's horizon
// (spherical Earth — close enough for drawing; the panel uses satellite.js look angles).
function elevationDeg(observer: Observer, [lon, lat, r]: LonLatR): number {
  const o = ecef(observer.lon, observer.lat);
  const sv = ecef(lon, lat, r / EARTH_RADIUS_KM);
  const d: Vec3 = [sv[0] - o[0], sv[1] - o[1], sv[2] - o[2]];
  return Math.asin((d[0] * o[0] + d[1] * o[1] + d[2] * o[2]) / Math.hypot(...d)) / DEG;
}

function formatUtc(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function formatLatLon(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
}

function SatDetails({ sat, health, readout, mask }: { sat: Satellite; health: Health; readout?: SatReadout; mask: number }) {
  return (
    <div className="gg-detail" style={{ borderColor: sat.color }}>
      <div className="gg-status-row">
        <span className="gg-badge" style={{ color: STATUS_COLORS[health.category], borderColor: STATUS_COLORS[health.category] }}>
          {health.label}
        </span>
        {health.note && <span className="gg-muted gg-small">{health.note}</span>}
      </div>
      {health.info?.nagu && (
        <p className="gg-small gg-nagu">
          NAGU {health.info.nagu.url
            ? <a href={health.info.nagu.url} target="_blank" rel="noreferrer">{health.info.nagu.id}</a>
            : health.info.nagu.id}
          {health.info.nagu.type && <span className="gg-muted"> · {health.info.nagu.type}</span>}
          {health.info.nagu.subject && <><br />{health.info.nagu.subject}</>}
        </p>
      )}
      <dl>
        {health.info && <><dt>SV ID</dt><dd>{health.info.svid}</dd></>}
        {health.info?.clock && <><dt>Clock</dt><dd>{health.info.clock}</dd></>}
        {readout && (
          <>
            <dt>Sub-point</dt><dd>{formatLatLon(readout.lat, readout.lon)}</dd>
            <dt>Altitude</dt><dd>{Math.round(readout.alt).toLocaleString()} km</dd>
            <dt>Velocity</dt><dd>{readout.speed.toFixed(3)} km/s</dd>
          </>
        )}
        <dt>Period</dt>
        <dd>
          {sat.periodMin >= 60 ? `${Math.floor(sat.periodMin / 60)} h ` : ''}
          {Math.round(sat.periodMin % 60)} min
        </dd>
        <dt>Inclination</dt><dd>{sat.inclination.toFixed(2)}°</dd>
        <dt>RAAN</dt><dd>{sat.raan.toFixed(1)}°</dd>
        <dt>Eccentricity</dt><dd>{sat.eccentricity.toFixed(4)}</dd>
        <dt>NORAD ID</dt><dd>{sat.id}</dd>
        <dt>TLE epoch</dt><dd>{sat.epoch.toISOString().slice(0, 16).replace('T', ' ')}</dd>
      </dl>
      <p className="gg-muted gg-small">Shaded area: ground that sees it above {mask}° elevation. Dashed line: ground track for the next orbit.</p>
    </div>
  );
}

export default function GalileoGlobe() {
  const stageRef = useRef<HTMLElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const reloadRef = useRef<(() => Promise<void>) | null>(null);

  const [sats, setSats] = useState<Satellite[]>([]);
  const [meta, setMeta] = useState<LoadMeta>({ status: 'loading', sources: {} });
  const [visible, setVisible] = useState<Record<LayerKey, boolean>>(() => Object.fromEntries(LAYERS.map(l => [l.key, true])) as Record<LayerKey, boolean>);
  const [status, setStatus] = useState<StatusState>({ state: 'loading', data: null });
  const [showUnusable, setShowUnusable] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [showLabels, setShowLabels] = useState(false);
  // People who ask for reduced motion start with the globe still.
  const [autoRotate, setAutoRotate] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [follow, setFollow] = useState(false);
  const [readout, setReadout] = useState<{ time: Date; bySat: Record<string, SatReadout> }>({ time: new Date(), bySat: {} });
  const [observer, setObserver] = useState<Observer | null>(null);
  const [mask, setMask] = useState(10);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [tab, setTab] = useState<'satellites' | 'settings'>('satellites');
  // The panel starts hidden; picking a satellite or a place reveals it.
  const [panelOpen, setPanelOpen] = useState(false);
  // On phones the panel is a bottom sheet with three heights; sheetDrag is its height (px) mid-drag.
  const [sheet, setSheet] = useState<'collapsed' | 'half' | 'full'>('collapsed');
  const [sheetDrag, setSheetDrag] = useState<number | null>(null);
  const [headH, setHeadH] = useState(160);
  const [showTime, setShowTimeState] = useState(() => readFlag(SHOW_TIME_KEY, true));
  const setShowTime = (on: boolean) => {
    setShowTimeState(on);
    writeFlag(SHOW_TIME_KEY, on);
  };
  const headRef = useRef<HTMLDivElement>(null);
  const grip = useRef<{ y: number; h: number; moved: boolean } | null>(null);

  const clock = useRef({ anchorReal: Date.now(), anchorSim: Date.now(), speed: 1 });
  const view = useRef<ViewState>({ rot: [-10, -25, 0], tgt: [-10, -25, 0], zoom: 1, dragging: false, wasDrag: false, down: null, lastXY: null });
  const ui = useRef<UiState>({ selectedId: null, hoverId: null, showLabels: false, autoRotate: true, follow: false, visible: {}, statusData: null, showUnusable: true, observer: null, mask: 10 });
  const positions = useRef<{ date?: Date; pos?: Record<string, LonLatR> }>({});

  useEffect(() => {
    Object.assign(ui.current, { selectedId, showLabels, autoRotate, follow, visible, statusData: status.data, showUnusable, observer, mask });
  }, [selectedId, showLabels, autoRotate, follow, visible, status, showUnusable, observer, mask]);

  const simNow = useCallback(() => {
    const c = clock.current;
    return c.anchorSim + (Date.now() - c.anchorReal) * c.speed;
  }, []);

  const changeSpeed = (s: number, resetToNow = false) => {
    const now = Date.now();
    clock.current = { anchorReal: now, anchorSim: resetToNow ? now : simNow(), speed: s };
    setSpeed(s);
  };

  // Load orbit data and service status, then re-check periodically. The scene is only rebuilt
  // when the orbit data actually changed.
  useEffect(() => {
    let cancelled = false;
    let lastTleKey: string | null = null;
    let lastCount = 0;
    const keys = Object.keys(SOURCES);

    const load = async () => {
      const [dataMeta, statusResult, ...tleResults] = await Promise.allSettled([
        loadDataMeta(),
        loadGalileoStatus(),
        ...keys.map(loadTle),
      ]);
      if (cancelled) return;
      const refresh = dataMeta.status === 'fulfilled' ? dataMeta.value.sources ?? {} : {};

      // Sources load independently, so one failing doesn't hide the other.
      const sources: Record<string, SourceState> = {};
      const texts: string[] = [];
      tleResults.forEach((r, i) => {
        const info = refresh[`tle-${keys[i]}`] ?? ({} as Partial<(typeof refresh)[string]>);
        if (r.status === 'fulfilled') {
          texts.push(r.value);
          sources[keys[i]] = { ok: true, fetchedAt: info.fetchedAt ?? null, refreshError: info.error ?? null };
        } else {
          texts.push('');
          sources[keys[i]] = { ok: false, message: errorMessage(r.reason) };
        }
      });
      const tleKey = texts.join('\n');
      if (tleKey !== lastTleKey) {
        lastTleKey = tleKey;
        const all = keys.flatMap((k, i) => (texts[i] ? parseTle(texts[i], k as Constellation) : []));
        lastCount = all.length;
        setSats(sortSats(all));
      }
      setMeta({ status: lastCount ? 'ready' : 'error', sources });

      if (statusResult.status === 'fulfilled') {
        setStatus({ state: 'ready', data: statusResult.value });
      } else {
        const message = errorMessage(statusResult.reason);
        setStatus(prev => (prev.data ? prev : { state: 'error', data: null, message }));
      }
    };

    reloadRef.current = load;
    load();
    const id = setInterval(load, DATA_RELOAD_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const retryLoad = () => {
    setMeta(prev => ({ ...prev, status: 'loading' }));
    setStatus(prev => (prev.data ? prev : { state: 'loading', data: null }));
    reloadRef.current?.();
  };

  // Scene
  useEffect(() => {
    if (!sats.length) return;
    let raf: number | null = null;
    let mounted = true;
    const v = view.current;
    const size = { w: 800, h: 800 };

    const svg = d3.select(svgRef.current!);
    svg.selectAll('*').remove();

    const defs = svg.append('defs');
    // Atmosphere: fades from the surface to ATMOSPHERE_KM altitude (stops are set per frame).
    const atmoGradient = defs.append('radialGradient').attr('id', 'gg-atmo').attr('gradientUnits', 'userSpaceOnUse');
    const atmoInner = atmoGradient.append('stop').attr('stop-color', '#7dd3fc').attr('stop-opacity', 0.55);
    atmoGradient.append('stop').attr('offset', 1).attr('stop-color', '#60a5fa').attr('stop-opacity', 0);

    const atmosphere = svg.append('circle').attr('fill', 'url(#gg-atmo)');
    const ocean = svg.append('circle').attr('fill', '#0d1f35');
    const earth = svg.append('g');
    const graticulePath = earth.append('path').attr('fill', 'none').attr('stroke', '#1a3a5c').attr('stroke-width', 0.4);
    const landGroup = earth.append('g');
    const nightPath = earth.append('path').attr('fill', 'rgba(0,0,0,0.42)');
    const footprintPath = earth.append('path').attr('fill-opacity', 0.12).attr('stroke-opacity', 0.6).attr('stroke-width', 1);
    const trackPath = earth.append('path').attr('fill', 'none').attr('stroke-width', 1.2).attr('stroke-dasharray', '3 3');

    const orbitGroup = svg.append('g').attr('fill', 'none');
    const nadirLine = svg.append('line').attr('stroke-width', 0.8).attr('stroke-dasharray', '2 3');
    const sightGroup = svg.append('g').attr('fill', 'none').attr('stroke-width', 1).attr('stroke-linecap', 'round');
    const observerMarker = svg.append('g').attr('class', 'gg-observer').attr('display', 'none');
    observerMarker.append('circle').attr('r', 9).attr('fill', 'none').attr('stroke', '#f8fafc').attr('stroke-opacity', 0.5);
    observerMarker.append('circle').attr('r', 3.5).attr('fill', '#f8fafc').attr('stroke', '#050e1a').attr('stroke-width', 1.5);
    const satGroup = svg.append('g');
    const labelGroup = svg.append('g').attr('font-size', 11).attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace');

    const orbitPaths = orbitGroup.selectAll<SVGPathElement, Satellite>('path').data(sats, d => d.id).enter().append('path')
      .attr('stroke', d => d.color).attr('stroke-linecap', 'round');
    const sightLines = sightGroup.selectAll<SVGPathElement, Satellite>('path').data(sats, d => d.id).enter().append('path')
      .attr('stroke', d => d.color);

    const satNodes = satGroup.selectAll<SVGGElement, Satellite>('g').data(sats, d => d.id).enter().append('g')
      .attr('class', 'gg-sat')
      .on('mouseenter', (_, d) => { ui.current.hoverId = d.id; })
      .on('mouseleave', () => { ui.current.hoverId = null; })
      .on('click', (e, d) => {
        e.stopPropagation();
        setSelectedId(id => (id === d.id ? null : d.id));
      });
    satNodes.append('circle').attr('class', 'hit').attr('r', 12).attr('fill', 'transparent');
    satNodes.append('circle').attr('class', 'ring').attr('r', 10).attr('fill', 'none').attr('stroke', d => d.color).attr('stroke-width', 1.2);
    satNodes.append('circle').attr('class', 'dot').attr('r', 4.5).attr('fill', d => d.color).attr('stroke', '#050e1a').attr('stroke-width', 1.5);

    const labels = labelGroup.selectAll<SVGTextElement, Satellite>('text').data(sats, d => d.id).enter().append('text')
      .attr('fill', d => d.color).attr('paint-order', 'stroke').attr('stroke', '#050e1a').attr('stroke-width', 3)
      .text(d => d.short);

    const proj = d3.geoOrthographic();
    const pathGen = d3.geoPath(proj);
    const graticule = d3.geoGraticule10();
    let land: d3.Selection<SVGPathElement, Country, SVGGElement, unknown> | null = null;

    fetch(countriesUrl)
      .then(r => r.json())
      .then((world: Topology) => {
        if (!mounted) return;
        const countries = topojson.feature(world, world.objects.countries as GeometryCollection);
        land = landGroup.selectAll<SVGPathElement, Country>('path')
          .data(countries.features as Country[])
          .enter().append('path')
          .attr('fill', '#163355').attr('stroke', '#3a7aa0').attr('stroke-width', 0.5);
      })
      .catch(() => { /* coastlines are decorative */ });

    // Orbit rings are sampled once in inertial space and rotated by GMST each frame.
    let orbits: Map<string, Vec3[]> | null = null;
    let orbitsSampledAt = -Infinity;
    let track: GeoJSON.LineString | null = null;
    let trackKey = '';
    let trackUpdatedAt = 0;
    let geom: { cx: number; cy: number; R: number } | null = null;

    const resize = () => {
      const el = stageRef.current;
      if (!el) return;
      size.w = el.clientWidth;
      size.h = el.clientHeight;
      svg.attr('viewBox', `0 0 ${size.w} ${size.h}`);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(stageRef.current!);

    const frame = () => {
      if (!mounted) return;
      const { w, h } = size;
      const cx = w / 2, cy = h / 2;
      const R = (Math.min(w, h) / 2 / FIT) * v.zoom;
      const now = simNow();
      const date = new Date(now);
      const gmst = gstime(date);
      const u = ui.current;
      const unusable = (s: Satellite) => healthOf(s, u.statusData).category === 'bad';
      const shown = (s: Satellite) => u.visible[s.layer] !== false && (u.showUnusable || !unusable(s));

      if (Math.abs(now - orbitsSampledAt) > ORBIT_RESAMPLE_MS) {
        orbits = new Map(sats.map(s => [s.id, sampleOrbit(s, date, ORBIT_STEPS)]));
        orbitsSampledAt = now;
      }

      // Current satellite positions (Earth-fixed lon/lat/radius)
      const pos: Record<string, LonLatR> = {};
      for (const s of sats) {
        const pv = eciAt(s, date);
        if (pv) pos[s.id] = eciToLonLatR([pv.position.x, pv.position.y, pv.position.z], gmst);
      }
      positions.current = { date, pos };

      // Camera
      const selSat = sats.find(s => s.id === u.selectedId && shown(s));
      const sel = selSat ? pos[selSat.id] : null;
      if (u.follow && sel && !v.dragging) {
        v.tgt[0] = -sel[0];
        v.tgt[1] = -sel[1];
      } else if (u.autoRotate && !v.dragging) {
        v.tgt[0] += AUTO_ROTATE_STEP;
      }
      // take the short way round
      v.tgt[0] = v.rot[0] + ((((v.tgt[0] - v.rot[0]) % 360) + 540) % 360) - 180;
      v.rot[0] += (v.tgt[0] - v.rot[0]) * 0.08;
      v.rot[1] += (v.tgt[1] - v.rot[1]) * 0.08;

      proj.scale(R).translate([cx, cy]).rotate(v.rot);
      geom = { cx, cy, R };
      const rotate = d3.geoRotation(v.rot);
      const screen: Screen = p => [cx + R * p[0], cy - R * p[1]];

      // Earth
      const atmoR = R * (1 + ATMOSPHERE_KM / EARTH_RADIUS_KM);
      atmoGradient.attr('cx', cx).attr('cy', cy).attr('r', atmoR);
      atmoInner.attr('offset', R / atmoR);
      atmosphere.attr('cx', cx).attr('cy', cy).attr('r', atmoR);
      ocean.attr('cx', cx).attr('cy', cy).attr('r', R);
      graticulePath.attr('d', pathGen(graticule));
      if (land) land.attr('d', d => pathGen(d));
      const [sunLon, sunLat] = subsolarPoint(date);
      nightPath.attr('d', pathGen(d3.geoCircle().center([sunLon + 180, -sunLat]).radius(90)()));

      // Selected satellite: coverage footprint + ground track
      if (selSat && sel) {
        footprintPath.attr('d', pathGen(d3.geoCircle().center([sel[0], sel[1]]).radius(footprintRadiusDeg(sel[2], u.mask))()))
          .attr('fill', selSat.color).attr('stroke', selSat.color);
        if (trackKey !== selSat.id || Math.abs(performance.now() - trackUpdatedAt) > 500) {
          const coords: [number, number][] = [];
          const steps = 200;
          for (let i = 0; i <= steps; i++) {
            const t = new Date(now + (i / steps) * selSat.periodMin * 60000);
            const pv = eciAt(selSat, t);
            if (pv) {
              const [lon, lat] = eciToLonLatR([pv.position.x, pv.position.y, pv.position.z], gstime(t));
              coords.push([lon, lat]);
            }
          }
          track = { type: 'LineString', coordinates: coords };
          trackKey = selSat.id;
          trackUpdatedAt = performance.now();
        }
        trackPath.attr('d', track ? pathGen(track) : null).attr('stroke', selSat.color);
      } else {
        footprintPath.attr('d', null);
        trackPath.attr('d', null);
      }

      // Orbits — only the parts not hidden behind the Earth disk
      orbitPaths.each(function (s) {
        const pts = (orbits?.get(s.id) ?? []).map(p => {
          const [lon, lat, r] = eciToLonLatR(p, gmst);
          return toView(rotate, lon, lat, r / EARTH_RADIUS_KM);
        });
        const d = visiblePath(pts, screen);
        const isSel = s.id === u.selectedId;
        d3.select(this)
          .attr('d', shown(s) && d ? d : null)
          .attr('stroke-width', isSel ? 2 : 1)
          .attr('stroke-dasharray', unusable(s) ? '4 5' : null)
          .attr('stroke-opacity', isSel ? 0.95 : u.selectedId != null ? 0.12 : 0.35);
      });

      // Satellites & labels
      const screenPos: Record<string, { xy: [number, number]; hidden: boolean; behind: boolean }> = {};
      for (const s of sats) {
        const p = pos[s.id];
        if (!p || !shown(s)) continue;
        const vp = toView(rotate, p[0], p[1], p[2] / EARTH_RADIUS_KM);
        screenPos[s.id] = { xy: screen(vp), hidden: occluded(vp), behind: vp[2] < 0 };
      }
      satNodes
        .attr('transform', s => { const sp = screenPos[s.id]; return sp ? `translate(${sp.xy[0]},${sp.xy[1]})` : null; })
        .attr('display', s => (screenPos[s.id] && !screenPos[s.id].hidden ? null : 'none'))
        .attr('opacity', s => (u.selectedId == null || s.id === u.selectedId ? 1 : 0.55));
      // Satellites not usable for service are drawn hollow
      satNodes.select('.dot')
        .attr('fill', s => (unusable(s) ? '#050e1a' : s.color))
        .attr('stroke', s => (unusable(s) ? s.color : '#050e1a'));
      satNodes.select('.ring').attr('display', s => (s.id === u.selectedId || s.id === u.hoverId ? null : 'none'));
      labels
        .attr('x', s => (screenPos[s.id] ? screenPos[s.id].xy[0] + 9 : 0))
        .attr('y', s => (screenPos[s.id] ? screenPos[s.id].xy[1] - 7 : 0))
        .attr('display', s => {
          const sp = screenPos[s.id];
          if (!sp || sp.hidden) return 'none';
          return u.showLabels || s.id === u.selectedId || s.id === u.hoverId ? null : 'none';
        });

      // Line from selected satellite down to its sub-satellite point
      if (selSat && sel && screenPos[selSat.id] && !screenPos[selSat.id].hidden) {
        const ground = toView(rotate, sel[0], sel[1], 1);
        const [gx, gy] = screen(ground);
        const [sx, sy] = screenPos[selSat.id].xy;
        nadirLine.attr('display', ground[2] >= 0 ? null : 'none')
          .attr('x1', sx).attr('y1', sy).attr('x2', gx).attr('y2', gy).attr('stroke', selSat.color);
      } else {
        nadirLine.attr('display', 'none');
      }

      // Observer on the ground and lines of sight to every satellite above its elevation mask
      const obs = u.observer;
      const vo = obs ? toView(rotate, obs.lon, obs.lat, 1) : null;
      if (vo && vo[2] >= 0) {
        const [ox, oy] = screen(vo);
        observerMarker.attr('display', null).attr('transform', `translate(${ox},${oy})`);
      } else {
        observerMarker.attr('display', 'none');
      }
      sightLines.each(function (s) {
        const p = pos[s.id];
        let d: string | null = null;
        if (vo && obs && p && shown(s) && elevationDeg(obs, p) >= u.mask) {
          const vs = toView(rotate, p[0], p[1], p[2] / EARTH_RADIUS_KM);
          const pts = d3.range(17).map(i => lerp3(vo, vs, i / 16));
          d = visiblePath(pts, screen) || null;
        }
        const isSel = s.id === u.selectedId;
        d3.select(this)
          .attr('d', d)
          .attr('stroke-opacity', isSel ? 0.95 : 0.45)
          .attr('stroke-width', isSel ? 1.6 : 0.9);
      });

      raf = requestAnimationFrame(frame);
    };
    frame();

    // Click on the Earth picks an observer location; click on empty space deselects.
    svg.on('click', e => {
      if (v.wasDrag || !geom) return;
      const [x, y] = d3.pointer(e, svg.node());
      if (Math.hypot(x - geom.cx, y - geom.cy) <= geom.R) {
        const inv = proj.invert?.([x, y]);
        if (inv) setObserver({ lon: inv[0], lat: inv[1] });
      } else {
        setSelectedId(null);
      }
    });

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      v.zoom = clampZoom(v.zoom * Math.exp(-e.deltaY * 0.0015));
    };
    const el = svgRef.current!;
    el.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      mounted = false;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
    };
  }, [sats, simNow]);

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
  }, []);

  // Panel readout (a few times a second is plenty for text)
  useEffect(() => {
    if (!sats.length) return;
    const tick = () => {
      const date = new Date(simNow());
      const gmst = gstime(date);
      const bySat: Record<string, SatReadout> = {};
      const site = observer && { latitude: observer.lat * DEG, longitude: observer.lon * DEG, height: 0 };
      const later = new Date(date.getTime() + 60000);
      const gmstLater = gstime(later);
      for (const s of sats) {
        const pv = eciAt(s, date);
        if (!pv) continue;
        const geo = eciToGeodetic(pv.position, gmst);
        bySat[s.id] = {
          lat: geo.latitude / DEG,
          lon: geo.longitude / DEG,
          alt: geo.height,
          speed: Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z),
        };
        if (site) {
          const look = ecfToLookAngles(site, eciToEcf(pv.position, gmst));
          const pvLater = eciAt(s, later);
          const elLater = pvLater ? ecfToLookAngles(site, eciToEcf(pvLater.position, gmstLater)).elevation : look.elevation;
          bySat[s.id].look = {
            el: look.elevation / DEG,
            az: ((look.azimuth / DEG) + 360) % 360,
            range: look.rangeSat,
            rising: elLater > look.elevation,
          };
        }
      }
      setReadout({ time: date, bySat });
    };
    tick();
    const id = setInterval(tick, 400);
    return () => clearInterval(id);
  }, [sats, simNow, observer]);

  // One pointer drags to rotate; two pointers pinch to zoom. Pointer capture starts only once
  // the pointer actually moves, so clicks on satellites still reach them.
  const pointers = useRef(new Map<number, [number, number]>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const pinchDist = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const v = view.current;
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
    const v = view.current;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch.current && pointers.current.size >= 2) {
      v.zoom = clampZoom(pinch.current.zoom * (pinchDist() / pinch.current.dist));
      return;
    }
    if (!v.down) return;
    if (!v.lastXY) return;
    if (!v.dragging) {
      if (Math.hypot(e.clientX - v.down[0], e.clientY - v.down[1]) < 4) return;
      v.dragging = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      setFollow(false);
    }
    const k = 0.5 / v.zoom;
    v.tgt[0] += (e.clientX - v.lastXY[0]) * k;
    v.tgt[1] = Math.max(-85, Math.min(85, v.tgt[1] - (e.clientY - v.lastXY[1]) * k));
    v.lastXY = [e.clientX, e.clientY];
  };
  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const v = view.current;
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

  const pickTab = (t: 'satellites' | 'settings') => {
    setTab(t);
    setSheet(prev => (prev === 'collapsed' ? 'half' : prev));
  };

  // Drag the grip to resize the sheet; a plain tap toggles it open or closed.
  const sheetPx = (which: 'collapsed' | 'half' | 'full') =>
    which === 'collapsed' ? headH : which === 'half' ? Math.max(headH, window.innerHeight * SHEET_HALF) : window.innerHeight * SHEET_FULL;
  const onGripDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    grip.current = { y: e.clientY, h: panelRef.current?.getBoundingClientRect().height ?? headH, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  };
  const onGripMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const g = grip.current;
    if (!g) return;
    if (!g.moved && Math.abs(e.clientY - g.y) < 6) return;
    g.moved = true;
    setSheetDrag(Math.min(sheetPx('full'), Math.max(headH, g.h + g.y - e.clientY)));
  };
  const onGripUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const g = grip.current;
    grip.current = null;
    if (!g) return;
    if (!g.moved) {
      setSheet(prev => (prev === 'collapsed' ? 'half' : 'collapsed'));
    } else {
      const h = Math.min(sheetPx('full'), Math.max(headH, g.h + g.y - e.clientY));
      const sizes = (['collapsed', 'half', 'full'] as const).map(k => [k, Math.abs(sheetPx(k) - h)] as const);
      setSheet(sizes.reduce((best, cur) => (cur[1] < best[1] ? cur : best))[0]);
    }
    setSheetDrag(null);
  };
  const sheetHeight = sheetDrag != null
    ? `${sheetDrag}px`
    : sheet === 'collapsed' ? `${headH}px` : sheet === 'half' ? `max(${headH}px, ${SHEET_HALF * 100}dvh)` : `${SHEET_FULL * 100}dvh`;

  const focusOn = (id: string) => {
    setSelectedId(id);
    const p = positions.current.pos?.[id];
    if (p) {
      view.current.tgt[0] = -p[0];
      view.current.tgt[1] = -p[1];
    }
    setAutoRotate(false);
  };

  const groups = useMemo(() => {
    const g: Satellite[][] = GROUP_NAMES.map(() => []);
    for (const s of sats) g[s.plane].push(s);
    return g;
  }, [sats]);

  const selected = sats.find(s => s.id === selectedId);
  const layerCounts = useMemo(() => d3.rollup(sats, v => v.length, s => s.layer), [sats]);
  const selHealth = selected ? healthOf(selected, status.data) : null;
  const statusCounts = useMemo(() => {
    const counts = { ok: 0, bad: 0, testing: 0, unknown: 0 };
    for (const s of sats) if (s.constellation === 'galileo') counts[healthOf(s, status.data).category]++;
    return counts;
  }, [sats, status.data]);

  // Keep the previously selected row's details mounted while it slides shut.
  const [prevSelectedId, setPrevSelectedId] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [prevObserver, setPrevObserver] = useState<Observer | null>(null);
  const reveal = () => {
    setPanelOpen(true);
    setTab('satellites');
    setSheet(prev => (prev === 'collapsed' ? 'half' : prev));
  };
  if (prevSelectedId !== selectedId) {
    setPrevSelectedId(selectedId);
    setClosingId(prevSelectedId);
    if (selectedId != null) {
      reveal();
      if (observer) setObserver(null); // a satellite or a place, not both
    }
  }
  if (prevObserver !== observer) {
    setPrevObserver(observer);
    if (observer) {
      reveal();
      if (selectedId != null) setSelectedId(null);
    }
  }

  // Bring the opened row into view once it has expanded (also when picked on the globe).
  useEffect(() => {
    if (selectedId == null) return;
    const id = setTimeout(() => {
      panelRef.current?.querySelector(`[data-sat-id="${selectedId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 320);
    return () => clearTimeout(id);
  }, [selectedId]);
  const staleSources = [
    ...Object.entries(meta.sources).flatMap(([key, src]) => (src.ok && src.fetchedAt ? [{ label: `${SOURCES[key].label} orbit data`, at: src.fetchedAt }] : [])),
    ...(status.data ? [{ label: 'Galileo service status', at: status.data.fetchedAt }] : []),
  ]
    .map(x => ({ label: x.label, ageMs: Date.now() - Date.parse(x.at) }))
    .filter(x => x.ageMs > STALE_DATA_MS);
  const live = speed === 1 && Math.abs(readout.time.getTime() - Date.now()) < 2000;

  // Satellites above the observer's elevation mask, highest first
  const inView = observer
    ? sats
      .flatMap(s => {
        const look = readout.bySat[s.id]?.look;
        const health = healthOf(s, status.data);
        return look && look.el >= mask && visible[s.layer] && (showUnusable || health.category !== 'bad')
          ? [{ s, look, health }]
          : [];
      })
      .sort((a, b) => b.look.el - a.look.el)
    : [];
  const usableGalileoInView = inView.filter(x => x.s.constellation === 'galileo' && x.health.category === 'ok').length;

  const useMyLocation = () => {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError('Geolocation isn’t available in this browser');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setObserver({ lat: coords.latitude, lon: coords.longitude });
        view.current.tgt[0] = -coords.longitude;
        view.current.tgt[1] = -coords.latitude;
        setAutoRotate(false);
        setFollow(false);
      },
      err => setGeoError(err.message || 'Couldn’t get your location'),
    );
  };

  return (
    <div className={`gg-root${panelOpen ? ' panel-open' : ''}`} style={{ '--gg-sheet-h': panelOpen ? sheetHeight : '0px' } as CSSProperties}>
      <main className="gg-stage" ref={stageRef}>
        <svg
          ref={svgRef}
          role="img"
          aria-label="Interactive 3D globe of the Galileo and LEO-PNT satellites. The satellite list in the side panel can be used with a keyboard."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        <div className="gg-overlay">
          <h1>Galileo Constellation</h1>
          <div className="gg-clock">
            {formatUtc(readout.time)}
            {live ? <span className="gg-live">LIVE</span> : <span className="gg-sim">×{speed}</span>}
          </div>
          {Object.entries(meta.sources).map(([key, src]) =>
            src.ok ? null : (
              <div key={key} className="gg-note gg-error">Couldn’t load {SOURCES[key].label} orbit data ({src.message})</div>
            ))}
        </div>
        {meta.status === 'loading' && <LoadingNotice />}
        {meta.status === 'error' && <ErrorNotice onRetry={retryLoad} />}
        <StaleBanner stale={staleSources} />
        <Legend />
        <button
          className="gg-menu-btn"
          aria-label={panelOpen ? 'Hide panel' : 'Show panel'}
          aria-expanded={panelOpen}
          aria-controls="gg-panel"
          onClick={() => setPanelOpen(open => !open)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M2 4h12M2 8h12M2 12h12" />
          </svg>
        </button>
        {showTime && (
          <div className="gg-timebar">
            <span className="gg-muted">Time</span>
            <TimeControls speeds={SPEEDS} speed={speed} live={live} onSpeed={s => changeSpeed(s)} onNow={() => changeSpeed(1, true)} />
          </div>
        )}
        <div className="gg-hint">Drag to rotate · scroll to zoom · click a satellite, or the Earth to pick a location</div>
      </main>

      <aside id="gg-panel" className={`gg-panel gg-sheet-${sheet}${sheetDrag != null ? ' dragging' : ''}`} ref={panelRef}>
        <div className="gg-sheet-head" ref={headRef}>
          <button
            className="gg-grip"
            aria-label="Resize panel"
            aria-expanded={sheet !== 'collapsed'}
            onPointerDown={onGripDown}
            onPointerMove={onGripMove}
            onPointerUp={onGripUp}
            onPointerCancel={onGripUp}
            onKeyDown={e => {
              if (e.key === 'ArrowUp') setSheet(sheet === 'collapsed' ? 'half' : 'full');
              if (e.key === 'ArrowDown') setSheet(sheet === 'full' ? 'half' : 'collapsed');
            }}
          />
          <div className="gg-tabs" role="tablist" aria-label="Panel">
            <button role="tab" id="gg-tab-satellites" aria-selected={tab === 'satellites'} aria-controls="gg-tabpanel" onClick={() => pickTab('satellites')}>Satellites</button>
            <button role="tab" id="gg-tab-settings" aria-selected={tab === 'settings'} aria-controls="gg-tabpanel" onClick={() => pickTab('settings')}>Settings</button>
          </div>
          {showTime && (
            <div className="gg-sheet-time">
              <TimeControls speeds={SPEEDS} speed={speed} live={live} onSpeed={s => changeSpeed(s)} onNow={() => changeSpeed(1, true)} />
            </div>
          )}
          <div className="gg-peek">
            {observer ? (
              <>
                <strong>{inView.length}</strong> in view
                {visible.galileo && status.data && (
                  <>
                    {' · '}<strong>{usableGalileoInView}</strong> usable Galileo
                    <span className={usableGalileoInView >= 4 ? 'gg-fix-ok' : 'gg-fix-no'}>
                      {usableGalileoInView >= 4 ? ' — enough for a Galileo-only fix' : ' — fewer than 4, no fix'}
                    </span>
                  </>
                )}
              </>
            ) : status.data ? (
              <>
                <span><span className="gg-dot" style={{ background: STATUS_COLORS.ok }} /> {statusCounts.ok} usable</span>
                {statusCounts.bad > 0 && (
                  <span><span className="gg-dot gg-hollow" style={{ borderColor: STATUS_COLORS.bad }} /> {statusCounts.bad} not usable</span>
                )}
              </>
            ) : null}
          </div>
        </div>

        <div className="gg-sheet-body" role="tabpanel" id="gg-tabpanel" aria-labelledby={`gg-tab-${tab}`}>
        {tab === 'satellites' && (
          <>
        <section>
          <h2>
            Visible from
            <span className="gg-observer-coords">{observer ? formatLatLon(observer.lat, observer.lon) : '…'}</span>
          </h2>
          {!observer ? (
            <p className="gg-muted gg-small gg-observer-hint">
              Click anywhere on the Earth to see which satellites are above the horizon there.
            </p>
          ) : (
            <>
              <div className="gg-mask">
                <span className="gg-muted">Elevation mask</span>
                <div className="gg-buttons">
                  {ELEVATION_MASKS.map(m => (
                    <button key={m} className={m === mask ? 'active' : ''} aria-pressed={m === mask} onClick={() => setMask(m)}>{m}°</button>
                  ))}
                </div>
              </div>
              <p className="gg-visible-summary">
                <strong>{inView.length}</strong> in view
                {visible.galileo && !status.data && (
                  <span className="gg-muted">
                    {status.state === 'loading' ? ' · checking Galileo service status…' : ' · Galileo service status unavailable'}
                  </span>
                )}
                {visible.galileo && status.data && (
                  <>
                    {' · '}<strong>{usableGalileoInView}</strong> usable Galileo
                    <span className={usableGalileoInView >= 4 ? 'gg-fix-ok' : 'gg-fix-no'}>
                      {usableGalileoInView >= 4 ? ' — enough for a Galileo-only fix' : ' — fewer than 4, no Galileo-only fix'}
                    </span>
                  </>
                )}
              </p>
              <SkyPlot
                mask={mask}
                selectedId={selectedId}
                onSelect={focusOn}
                items={inView.map(({ s, look, health }) => ({
                  id: s.id,
                  name: s.short,
                  label: health.info?.svid ?? s.alias ?? s.short,
                  az: look.az,
                  el: look.el,
                  color: s.color,
                  hollow: health.category === 'bad',
                }))}
              />
              {inView.length > 0 ? (
                <ul className="gg-list gg-visible-list">
                  <li className="gg-visible-head gg-muted">
                    <span />
                    <span>Satellite</span>
                    <span>Elev</span>
                    <span>Azim</span>
                    <span>Range</span>
                  </li>
                  {inView.map(({ s, look, health }) => (
                    <li key={s.id}>
                      <button className={s.id === selectedId ? 'active' : ''} aria-pressed={s.id === selectedId} onClick={() => focusOn(s.id)}>
                        <span
                          className={`gg-dot${health.category === 'bad' ? ' gg-hollow' : ''}`}
                          style={health.category === 'bad' ? { borderColor: s.color } : { background: s.color }}
                          title={health.note ?? health.label}
                        />
                        <span className="gg-name">{s.short}</span>
                        <span className="gg-pos">
                          {look.el.toFixed(1)}°
                          <span className={look.rising ? 'gg-rising' : 'gg-setting'} title={look.rising ? 'Rising' : 'Setting'}>
                            {look.rising ? '↑' : '↓'}
                          </span>
                        </span>
                        <span className="gg-pos">{look.az.toFixed(0)}° {COMPASS[Math.round(look.az / 45) % 8]}</span>
                        <span className="gg-pos">{Math.round(look.range).toLocaleString()} km</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="gg-muted gg-small">No satellites above {mask}° right now.</p>
              )}
            </>
          )}
          <div className="gg-buttons gg-observer-actions">
            <button onClick={useMyLocation}>Use my location</button>
            {observer && <button onClick={() => setObserver(null)}>Clear</button>}
          </div>
          {geoError && <p className="gg-error gg-small" role="alert">{geoError}</p>}
        </section>

        <section>
          <h2>Galileo service status</h2>
          {status.state === 'loading' && <p className="gg-muted">Loading…</p>}
          {status.state === 'error' && <p className="gg-error">Couldn’t load status: {status.message}</p>}
          {status.data && (
            <>
              <div className="gg-status-summary">
                <span><span className="gg-dot" style={{ background: STATUS_COLORS.ok }} /> {statusCounts.ok} usable</span>
                {statusCounts.bad > 0 && (
                  <span><span className="gg-dot gg-hollow" style={{ borderColor: STATUS_COLORS.bad }} /> {statusCounts.bad} not usable</span>
                )}
                {statusCounts.testing > 0 && (
                  <span><span className="gg-dot" style={{ background: STATUS_COLORS.testing }} /> {statusCounts.testing} testing</span>
                )}
                {statusCounts.unknown > 0 && (
                  <span><span className="gg-dot" style={{ background: STATUS_COLORS.unknown }} /> {statusCounts.unknown} unlisted</span>
                )}
              </div>
              <p className="gg-muted gg-small">
                Source: <a href={status.data.source} target="_blank" rel="noreferrer">European GNSS Service Centre</a>
, updated {formatUtc(new Date(status.data.fetchedAt))}. Hollow markers and dashed orbits are not usable.
              </p>
            </>
          )}
        </section>

        {groups.map((list, plane) => list.length > 0 && visible[list[0].layer] && (
          <section key={plane}>
            <h2>
              <span className="gg-dot" style={{ background: GROUP_COLORS[plane] }} />
              {GROUP_NAMES[plane]}
              <span className="gg-muted"> · {list.length} sats{plane < 3 ? ` · RAAN ≈ ${Math.round(d3.mean(list, s => s.raan) ?? 0)}°` : ''}</span>
            </h2>
            <ul className="gg-list">
              {list.map(s => {
                const r = readout.bySat[s.id];
                const health = healthOf(s, status.data);
                if (health.category === 'bad' && !showUnusable) return null;
                const open = s.id === selectedId;
                return (
                  <li key={s.id} data-sat-id={s.id}>
                    <button
                      className={open ? 'active' : ''}
                      aria-expanded={open}
                      onClick={() => (open ? setSelectedId(null) : focusOn(s.id))}
                    >
                      <span
                        className={`gg-dot${health.category === 'bad' ? ' gg-hollow' : ''}`}
                        style={health.category === 'bad'
                          ? { borderColor: STATUS_COLORS.bad }
                          : { background: STATUS_COLORS[health.category] }}
                        title={health.note ?? health.label}
                      />
                      <span className="gg-name">{s.short}</span>
                      <span className="gg-muted">{s.alias}</span>
                      <span className="gg-pos">{r ? formatLatLon(r.lat, r.lon) : '—'}</span>
                    </button>
                    <div
                      className={`gg-expand${open ? ' open' : ''}`}
                      onTransitionEnd={e => {
                        if (e.target === e.currentTarget && !open && s.id === closingId) setClosingId(null);
                      }}
                    >
                      <div className="gg-expand-inner">
                        {(open || s.id === closingId) && <SatDetails sat={s} health={health} readout={r} mask={mask} />}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {meta.status === 'ready' && (
          <p className="gg-muted gg-small">
            Orbital elements from <a href="https://celestrak.org" target="_blank" rel="noopener noreferrer">CelesTrak</a> (the “galileo” group and objects named LPNTSAT — ESA’s Celeste
            LEO-PNT demonstrators), propagated with SGP4 in your browser.
            {meta.sources.galileo?.fetchedAt && ` Updated ${formatUtc(new Date(meta.sources.galileo.fetchedAt))}.`}
            {' '}Inclusion here doesn’t mean a satellite is currently healthy or in service.
          </p>
        )}

          </>
        )}

        {tab === 'settings' && (
          <>
        <section>
          <h2>Constellations</h2>
          {LAYERS.map(({ key, label, note }) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={visible[key]}
                onChange={e => {
                  const on = e.target.checked;
                  setVisible(vis => ({ ...vis, [key]: on }));
                  if (!on && selected?.layer === key) setSelectedId(null);
                }}
              />
              {label}
              {note && <span className="gg-muted">({note})</span>}
              <span className="gg-muted gg-layer-count">{layerCounts.get(key) ?? 0} sats</span>
            </label>
          ))}
        </section>

        {status.data && (
          <section>
            <h2>Galileo service status</h2>
            <label>
              <input type="checkbox" checked={showUnusable} onChange={e => {
                const on = e.target.checked;
                setShowUnusable(on);
                if (!on && selHealth?.category === 'bad') setSelectedId(null);
              }} /> Show non-usable satellites
            </label>
          </section>
        )}

        <section>
          <h2>View</h2>
          <label><input type="checkbox" checked={showTime} onChange={e => setShowTime(e.target.checked)} /> Show time controls</label>
          <label><input type="checkbox" checked={autoRotate} onChange={e => setAutoRotate(e.target.checked)} /> Auto-rotate</label>
          <label><input type="checkbox" checked={showLabels} onChange={e => setShowLabels(e.target.checked)} /> Show all labels</label>
          <label>
            <input type="checkbox" checked={follow} disabled={!selected} onChange={e => setFollow(e.target.checked)} /> Follow selected
          </label>
        </section>

        <p className="gg-muted gg-small gg-footer">
          © 2026 Cezary Szyszka · <a href="/about/">About &amp; credits</a>
        </p>
          </>
        )}
        </div>
      </aside>
    </div>
  );
}
