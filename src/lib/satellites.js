import { twoline2satrec, propagate, gstime } from 'satellite.js';
import { TLE_SOURCES } from './sources.js';

export const EARTH_RADIUS_KM = 6371;

export const SOURCES = TLE_SOURCES;

// Group indices used for colouring and the side-panel sections.
export const GROUP_NAMES = ['Galileo plane 1', 'Galileo plane 2', 'Galileo plane 3', 'Galileo elliptical orbit', 'LEO-PNT (Celeste)'];

// Display layers that can be toggled independently. The two Galileo satellites stranded in
// an elliptical orbit are split from the nominal constellation.
export const LAYERS = [
  { key: 'galileo', label: 'Galileo', note: 'excl. elliptical' },
  { key: 'galileoElliptical', label: 'Galileo elliptical' },
  { key: 'leopnt', label: 'LEO-PNT (Celeste)' },
];
export const GROUP_COLORS = ['#60a5fa', '#f59e0b', '#34d399', '#c084fc', '#f87171'];
const LEO_PNT_GROUP = 4;
const ECCENTRIC_GROUP = 3;

// All runtime data is served as static files from public/data/, refreshed by
// scripts/refresh-data.js (`npm run data:refresh`). `no-cache` makes the browser revalidate,
// so a long-open page picks up new data after the site is redeployed.
const DATA_URL = `${import.meta.env.BASE_URL}data/`;

async function fetchData(file) {
  const res = await fetch(DATA_URL + file, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res;
}

// When each data file was fetched, and any error from the latest refresh attempt.
export async function loadDataMeta() {
  try {
    return await (await fetchData('meta.json')).json();
  } catch {
    return { sources: {} };
  }
}

export async function loadTle(sourceKey) {
  return (await fetchData(SOURCES[sourceKey].file)).text();
}

// Official Galileo per-satellite status from the European GNSS Service Centre.
export async function loadGalileoStatus() {
  return (await fetchData('galileo-status.json')).json();
}

export const STATUS_COLORS = { ok: '#34d399', bad: '#f87171', testing: '#fbbf24', unknown: '#64748b' };

export function statusCategory(status) {
  if (!status) return 'unknown';
  if (status === 'USABLE') return 'ok';
  if (status.startsWith('NOT ')) return 'bad';
  if (status === 'TESTING' || status.includes('COMMISSIONING')) return 'testing';
  return 'unknown';
}

export function parseTle(text, constellation) {
  const lines = text.split(/\r?\n/).map(l => l.trimEnd()).filter(Boolean);
  const sats = [];
  for (let i = 0; i + 2 < lines.length; i++) {
    const [name, l1, l2] = [lines[i].trim(), lines[i + 1], lines[i + 2]];
    if (!l1.startsWith('1 ') || !l2.startsWith('2 ')) continue;
    i += 2;
    const satrec = twoline2satrec(l1, l2);
    const match = name.match(/^(\S+)\s*\((.+)\)$/);
    sats.push({
      id: satrec.satnum,
      constellation,
      name,
      short: match ? match[1] : name,
      alias: match ? match[2] : '',
      satrec,
      inclination: (satrec.inclo * 180) / Math.PI,
      raan: (satrec.nodeo * 180) / Math.PI,
      eccentricity: satrec.ecco,
      periodMin: (2 * Math.PI) / satrec.no,
      epoch: epochToDate(satrec),
    });
  }
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

export function sortSats(sats) {
  return [...sats].sort((a, b) => a.plane - b.plane || a.short.localeCompare(b.short));
}

function epochToDate(satrec) {
  const year = satrec.epochyr < 57 ? 2000 + satrec.epochyr : 1900 + satrec.epochyr;
  return new Date(Date.UTC(year, 0, 1) + (satrec.epochdays - 1) * 86400000);
}

// Galileo uses three orbital planes 120° apart in RAAN. The two satellites launched into
// the wrong (eccentric) orbit in 2014 are flagged separately.
function assignPlanes(sats) {
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
export function eciAt(sat, date) {
  const pv = propagate(sat.satrec, date);
  if (!pv || !pv.position) return null;
  return { position: pv.position, velocity: pv.velocity };
}

// One full revolution sampled in ECI (km), starting at `date`.
export function sampleOrbit(sat, date, steps = 180) {
  const pts = [];
  const periodMs = sat.periodMin * 60000;
  for (let i = 0; i <= steps; i++) {
    const pv = eciAt(sat, new Date(date.getTime() + (i / steps) * periodMs));
    if (pv) pts.push([pv.position.x, pv.position.y, pv.position.z]);
  }
  return pts;
}

// Rotate an ECI vector into Earth-fixed coordinates and return geocentric lon/lat (deg) + radius (km).
export function eciToLonLatR([x, y, z], gmst) {
  const c = Math.cos(gmst), s = Math.sin(gmst);
  const X = x * c + y * s;
  const Y = -x * s + y * c;
  const r = Math.hypot(X, Y, z);
  return [(Math.atan2(Y, X) * 180) / Math.PI, (Math.asin(z / r) * 180) / Math.PI, r];
}

export { gstime };

// Sub-solar point (deg), low-precision solar ephemeris — plenty for a day/night shade.
export function subsolarPoint(date) {
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
export function footprintRadiusDeg(radiusKm, minElevDeg = 10) {
  const e = (minElevDeg * Math.PI) / 180;
  return ((Math.acos((EARTH_RADIUS_KM * Math.cos(e)) / radiusKm) - e) * 180) / Math.PI;
}
