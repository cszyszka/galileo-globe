import type { GroundTrackRepeat } from './satellites';

// Text formatting shared by the overlay and the panel.

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function formatUtc(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

// Minute precision is enough for a TLE epoch.
export function formatEpoch(d: Date): string {
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

export function formatLatLon(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
}

// "14 h 5 min" for Galileo, "95 min" for low orbits.
export function formatPeriod(periodMin: number): string {
  return `${periodMin >= 60 ? `${Math.floor(periodMin / 60)} h ` : ''}${Math.round(periodMin % 60)} min`;
}

export function formatRepeat(r: GroundTrackRepeat): string {
  return `every ${r.days === 1 ? 'sidereal day' : `${r.days} days`} (${r.orbits} orbits)`;
}

// Nearest of the eight compass points for an azimuth (deg, clockwise from north).
export function compassPoint(azDeg: number): string {
  return COMPASS[Math.round((((azDeg % 360) + 360) % 360) / 45) % 8];
}
