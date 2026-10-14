import { json2satrec, propagate, gstime, type OMMJsonObject, type SatRec, type EciVec3 } from 'satellite.js';
import ORBIT_SOURCES from './sources.json';

export type Constellation = 'galileo' | 'leopnt';
export type LayerKey = 'galileo' | 'galileoElliptical' | 'leopnt';
export type StatusCategory = 'ok' | 'bad' | 'testing' | 'unknown';
export type LonLatR = [lon: number, lat: number, radiusKm: number];

export interface Satellite {
  id: string;
  constellation: Constellation;
  name: string;
  short: string;
  alias: string;
  satrec: SatRec;
  inclination: number;
  raan: number;
  eccentricity: number;
  periodMin: number;
  epoch: Date;
  plane: number;
  elliptical: boolean;
  color: string;
  layer: LayerKey;
}

export interface SourceMeta {
  file: string;
  url: string;
  fetchedAt: string;
  count?: number;
  warnings?: string[];
  error?: string;
}

export interface DataMeta {
  sources: Record<string, SourceMeta>;
}

export interface Nagu {
  id: string;
  type?: string;
  subject?: string;
  url?: string;
}

export interface GalileoStatusEntry {
  svid: string;
  clock?: string;
  status: string;
  nagu: Nagu | null;
}

export interface GalileoStatus {
  source: string;
  fetchedAt: string;
  satellites: Record<string, GalileoStatusEntry>;
}

export interface Eci {
  position: EciVec3<number>;
  velocity: EciVec3<number>;
}

export type Vec3 = [number, number, number];

export const EARTH_RADIUS_KM = 6371;

export const SOURCES: Record<string, { label: string; url: string; file: string }> = ORBIT_SOURCES;

// Group indices used for colouring and the side-panel sections.
export const GROUP_NAMES = ['Galileo plane 1', 'Galileo plane 2', 'Galileo plane 3', 'Galileo elliptical orbit', 'LEO-PNT (Celeste)'];

// Display layers that can be toggled independently. The two Galileo satellites stranded in
// an elliptical orbit are split from the nominal constellation.
export const LAYERS: { key: LayerKey; label: string; note?: string }[] = [
  { key: 'galileo', label: 'Galileo', note: 'excl. elliptical' },
  { key: 'galileoElliptical', label: 'Galileo elliptical' },
  { key: 'leopnt', label: 'LEO-PNT (Celeste)' },
];
export const GROUP_COLORS = ['var(--gg-p1)', 'var(--gg-p2)', 'var(--gg-p3)', 'var(--gg-p4)', 'var(--gg-p5)'];
const LEO_PNT_GROUP = 4;
const ECCENTRIC_GROUP = 3;

// All runtime data is served as static files from public/data/, refreshed by
// data_refresh/ (`npm run data:refresh`). `no-cache` makes the browser revalidate,
// so a long-open page picks up new data after the site is redeployed.
const DATA_URL = `${import.meta.env.BASE_URL}data/`;

async function fetchData(file: string): Promise<Response> {
  const res = await fetch(DATA_URL + file, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res;
}

// When each data file was fetched, and any error from the latest refresh attempt.
export async function loadDataMeta(): Promise<DataMeta> {
  try {
    return await (await fetchData('meta.json')).json();
  } catch {
    return { sources: {} };
  }
}

export async function loadOmm(sourceKey: string): Promise<string> {
  return (await fetchData(SOURCES[sourceKey].file)).text();
}

// Official Galileo per-satellite status from the European GNSS Service Centre.
export async function loadGalileoStatus(): Promise<GalileoStatus> {
  return (await fetchData('galileo-status.json')).json();
}

export const STATUS_COLORS: Record<StatusCategory, string> = { ok: 'var(--gg-good)', bad: 'var(--gg-bad)', testing: 'var(--gg-warn)', unknown: 'var(--gg-faint)' };

export function statusCategory(status?: string): StatusCategory {
  if (!status) return 'unknown';
  if (status === 'USABLE') return 'ok';
  if (status.startsWith('NOT ')) return 'bad';
  if (status === 'TESTING' || status.includes('COMMISSIONING')) return 'testing';
  return 'unknown';
}

// Service status of one satellite, as shown in the panel. `info` is the GSC row (Galileo only).
export interface Health {
  category: StatusCategory;
  label: string;
  note?: string;
  info?: GalileoStatusEntry;
}

export function healthOf(sat: Satellite, statusData: GalileoStatus | null): Health {
  if (sat.constellation !== 'galileo') {
    return { category: 'unknown', label: 'Demonstrator', note: 'In-orbit demonstrator — no public service status' };
  }
  if (!statusData) return { category: 'unknown', label: 'Unknown', note: 'Service status unavailable' };
  const info = statusData.satellites[sat.short];
  if (!info) return { category: 'unknown', label: 'Not listed', note: 'Not listed by the GNSS Service Centre' };
  return { category: statusCategory(info.status), label: info.status, info };
}

export type StatusCounts = Record<StatusCategory, number>;

// How many Galileo satellites are in each service category (demonstrators aren't counted).
export function countStatuses(sats: Satellite[], statusData: GalileoStatus | null): StatusCounts {
  const counts: StatusCounts = { ok: 0, bad: 0, testing: 0, unknown: 0 };
  for (const s of sats) if (s.constellation === 'galileo') counts[healthOf(s, statusData).category]++;
  return counts;
}

// What the person has chosen to show. The globe, the sky plot and the visible list all filter
// through isShown, so they always agree.
export interface Visibility {
  layers: Partial<Record<LayerKey, boolean>>;
  showUnusable: boolean;
  statusData: GalileoStatus | null;
}

export function isShown(sat: Satellite, { layers, showUnusable, statusData }: Visibility): boolean {
  return layers[sat.layer] !== false && (showUnusable || healthOf(sat, statusData).category !== 'bad');
}

// OMM (CelesTrak JSON) gives the epoch in UTC without a zone suffix.
function ommEpoch(record: OMMJsonObject): Date {
  return new Date(record.EPOCH.endsWith('Z') ? record.EPOCH : `${record.EPOCH}Z`);
}

// Builds a satellite from one OMM record, or null if the record is unusable.
function satelliteFromOmm(record: OMMJsonObject, constellation: Constellation): Satellite | null {
  try {
    const name = String(record.OBJECT_NAME).trim();
    const satrec = json2satrec(record);
    const epoch = ommEpoch(record);
    if (!name || satrec.error || Number.isNaN(epoch.getTime())) return null;
    const match = name.match(/^(\S+)\s*\((.+)\)$/);
    return {
      id: satrec.satnum,
      plane: 0,
      elliptical: false,
      color: '',
      layer: constellation,
      constellation,
      name,
      short: match ? match[1] : name,
      alias: match ? match[2] : '',
      satrec,
      inclination: (satrec.inclo * 180) / Math.PI,
      raan: (satrec.nodeo * 180) / Math.PI,
      eccentricity: satrec.ecco,
      periodMin: (2 * Math.PI) / satrec.no,
      epoch,
    };
  } catch {
    return null;
  }
}

// Parses a CelesTrak OMM JSON file. Anything that isn't a list of usable records is skipped.
export function parseOmm(text: string, constellation: Constellation): Satellite[] {
  let records: unknown;
  try {
    records = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(records)) return [];
  const sats = records.flatMap(r => {
    const sat = r && typeof r === 'object' ? satelliteFromOmm(r as OMMJsonObject, constellation) : null;
    return sat ? [sat] : [];
  });
  if (constellation === 'galileo') {
    assignPlanes(sats);
  } else {
    for (const s of sats) s.plane = LEO_PNT_GROUP;
  }
  for (const s of sats) {
    s.color = GROUP_COLORS[s.plane];
    s.layer = constellation === 'galileo' && s.elliptical ? 'galileoElliptical' : constellation;
  }
  return sats;
}

export function sortSats(sats: Satellite[]): Satellite[] {
  return [...sats].sort((a, b) => a.plane - b.plane || a.short.localeCompare(b.short));
}

// Galileo uses three orbital planes 120° apart in RAAN. The two satellites launched into
// the wrong (eccentric) orbit in 2014 are flagged separately.
function assignPlanes(sats: Satellite[]): void {
  const nominal = sats.filter(s => s.eccentricity < 0.05);
  // Pick the offset that best fits a 3-plane, 120°-spaced grid.
  let best = { offset: 0, err: Infinity };
  for (let offset = 0; offset < 120; offset += 0.5) {
    const err = nominal.reduce((sum, s) => {
      const d = ((s.raan - offset) % 120 + 120) % 120;
      return sum + Math.min(d, 120 - d) ** 2;
    }, 0);
    if (err < best.err) best = { offset, err };
  }
  for (const s of sats) {
    s.elliptical = s.eccentricity >= 0.05;
    const rel = ((s.raan - best.offset) % 360 + 360) % 360;
    s.plane = s.elliptical ? ECCENTRIC_GROUP : Math.round(rel / 120) % 3;
  }
}

// ECI position (km) at a given date, or null if SGP4 fails.
export function eciAt(sat: Satellite, date: Date): Eci | null {
  const pv = propagate(sat.satrec, date);
  if (!pv || !pv.position) return null;
  return { position: pv.position, velocity: pv.velocity };
}

export const SIDEREAL_DAY_MIN = 1436.0682;

export interface GroundTrackRepeat {
  days: number;
  orbits: number;
}

// How long until the ground track repeats: the smallest whole number of sidereal days that holds a
// whole number of orbits. Galileo is 17 orbits in 10 days; a GPS-style orbit is 2 orbits in a day.
// Returns null for orbits with no short repeat (a tight tolerance avoids false matches).
export function groundTrackRepeat(periodMin: number, maxDays = 12, tolerance = 0.0003): GroundTrackRepeat | null {
  for (let days = 1; days <= maxDays; days++) {
    const span = days * SIDEREAL_DAY_MIN;
    const orbits = Math.round(span / periodMin);
    if (orbits >= 1 && Math.abs(orbits * periodMin - span) / span < tolerance) return { days, orbits };
  }
  return null;
}

// One full revolution sampled in ECI (km), starting at `date`.
export function sampleOrbit(sat: Satellite, date: Date, steps = 180): Vec3[] {
  const pts: Vec3[] = [];
  const periodMs = sat.periodMin * 60000;
  for (let i = 0; i <= steps; i++) {
    const pv = eciAt(sat, new Date(date.getTime() + (i / steps) * periodMs));
    if (pv) pts.push([pv.position.x, pv.position.y, pv.position.z]);
  }
  return pts;
}

// Earth-fixed lon/lat (deg) and radius (km) at a given date, or null if SGP4 fails. Pass `gmst`
// when placing many satellites at the same instant, to compute it only once.
export function lonLatRAt(sat: Satellite, date: Date, gmst = gstime(date)): LonLatR | null {
  const pv = eciAt(sat, date);
  return pv ? eciToLonLatR([pv.position.x, pv.position.y, pv.position.z], gmst) : null;
}

// The satellite's path over `spanMs` from `startMs`, in Earth-fixed coordinates — i.e. with the
// Earth turning beneath it, unlike sampleOrbit. Used for the ground track and the 3D trace.
export function sampleEarthFixed(sat: Satellite, startMs: number, spanMs: number, steps: number): LonLatR[] {
  const pts: LonLatR[] = [];
  for (let i = 0; i <= steps; i++) {
    const p = lonLatRAt(sat, new Date(startMs + (i / steps) * spanMs));
    if (p) pts.push(p);
  }
  return pts;
}

// Rotate an ECI vector into Earth-fixed coordinates and return geocentric lon/lat (deg) + radius (km).
export function eciToLonLatR([x, y, z]: Vec3, gmst: number): LonLatR {
  const c = Math.cos(gmst), s = Math.sin(gmst);
  const X = x * c + y * s;
  const Y = -x * s + y * c;
  const r = Math.hypot(X, Y, z);
  return [(Math.atan2(Y, X) * 180) / Math.PI, (Math.asin(z / r) * 180) / Math.PI, r];
}

export { gstime };

// Sub-solar point (deg), low-precision solar ephemeris — plenty for a day/night shade.
export function subsolarPoint(date: Date): [lon: number, lat: number] {
  const n = date.getTime() / 86400000 - 10957.5; // days since J2000.0
  const rad = Math.PI / 180;
  const L = 280.46 + 0.9856474 * n;
  const g = (357.528 + 0.9856003 * n) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const eps = (23.439 - 0.0000004 * n) * rad;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  let lon = (ra - gstime(date)) / rad;
  lon = ((lon + 540) % 360) - 180;
  return [lon, dec / rad];
}

// Angular radius (deg) of the ground area that sees the satellite above `minElevDeg`.
export function footprintRadiusDeg(radiusKm: number, minElevDeg = 10): number {
  const e = (minElevDeg * Math.PI) / 180;
  return ((Math.acos((EARTH_RADIUS_KM * Math.cos(e)) / radiusKm) - e) * 180) / Math.PI;
}
